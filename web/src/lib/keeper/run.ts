// The keeper (issue #17): fetch or self-sign a Trigger, attest it, settle enrolled plots in batches, and
// push LINE on every Paid/Held. Idempotent -- re-running the same reference event skips an already-attested
// eventId and never re-settles a plot that's already Paid/Held/Claimed/Swept.
//
// Framework-agnostic core (like web/src/lib/world/verify-handler.ts): both the Next route
// (app/api/keeper/replay/route.ts) and the CLI (src/scripts/keeper-cli.ts) call `runKeeper` with the same
// default deps, built lazily from env so `--dry-run` never needs KEEPER_PRIVATE_KEY.
import {
  BaseError,
  ContractFunctionRevertedError,
  hexToString,
  parseEventLogs,
  zeroAddress,
  type Account,
  type Address,
  type Hex,
} from 'viem';
import { ReliefPoolAbi, idOf, eventIdOf, triggerEventId, type Trigger } from '@repo/shared';
import { env } from '@/lib/env';
import { zoneLabelFor, heldReasonText } from '@/lib/held-reasons';
import { pushHeld, pushPaid, type HeldPushParams, type PaidPushParams } from '@/lib/line';
import { claimNotification } from '@/lib/notification-log';
import { recordEscalatedRun } from '@/lib/keeper-runs';
import { decideAttest as decideAttestGate, type AttestGateResult, type AttestGateState } from '@/lib/jev-gate';
import { payoutDirectory, recordPlotWallet } from '@/lib/payout-directory';
import {
  getKeeperChainClients,
  getKeeperPublicClient,
  type KeeperPublicClient,
  type KeeperWalletClient,
} from './chain-clients';
import { batchPlots, listEnrolledPlots } from './plots';
import { getReferenceEvent, type ReferenceEvent } from './reference-events';
import { resolveSignedTrigger, type FallbackKeys, type TriggerSource } from './signing';

const SECONDS_PER_DAY = 86_400;

/**
 * Builds the Jev attest-gate state from a resolved trigger (docs/JEV.md). daysOfData is a proxy -- the
 * season window from windowStart to firedAt -- since the keeper doesn't fetch buoy ground-truth or the
 * pipeline's per-day series alongside the trigger yet; buoyOffset is null until that's wired up.
 * TODO: replace both once the keeper reads the buoy vsSatellite offset / the pipeline's per-day SST series here.
 */
function buildAttestGateState(trigger: Trigger, ref: ReferenceEvent): AttestGateState {
  const daysOfData = Math.max(0, Math.round(Number(trigger.firedAt - trigger.windowStart) / SECONDS_PER_DAY));
  return {
    trigger: {
      zone: ref.zone,
      species: ref.species,
      peril: ref.peril,
      tier: trigger.tier,
      index: trigger.index,
      threshold: trigger.threshold,
      tempC: trigger.tempC,
      firedAt: new Date(Number(trigger.firedAt) * 1000).toISOString(),
    },
    buoyOffset: null,
    daysOfData,
    sourceHashes: [trigger.dataHash],
  };
}

const PLOT_STATUS_NAMES = ['Unsettled', 'Paid', 'Held', 'Claimed', 'Swept'] as const;

function bytes32ToLabel(hex: Hex): string {
  return hexToString(hex).replace(/\u0000+$/, '');
}

function isAlreadyAttestedError(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError && revert.data?.errorName === 'AlreadyAttested';
}

export interface KeeperRunDeps {
  publicClient: KeeperPublicClient;
  /** Lazy: only invoked when a keeper run actually needs to broadcast a transaction. */
  getSigningClient: () => { walletClient: KeeperWalletClient; account: Account };
  poolAddress: Address;
  feedUrl: string;
  fallbackKeys: FallbackKeys;
  fetchFn: typeof fetch;
  fromBlock: bigint;
  batchSize: number;
  now: () => number;
  pushPaid: (userId: string, params: PaidPushParams) => Promise<void>;
  pushHeld: (userId: string, params: HeldPushParams) => Promise<void>;
  lineUserIdForWallet: (wallet: string) => Promise<string | null>;
  lineUserIdForPlot: (plotLabel: string) => Promise<string | null>;
  recordPlotWallet: (plotLabel: string, wallet: string) => void | Promise<void>;
  /** Jev data-quality gate (docs/JEV.md), asked right before attest. Injectable so tests never hit the network. */
  decideAttest: (state: AttestGateState) => Promise<AttestGateResult>;
  /** Durable push de-dup (sponsor-polish task, web/src/lib/notification-log.ts). Returns true exactly
   *  once per chain event id -- false means some other run/webhook delivery already pushed it. */
  claimNotification: (txHash: Hex, logIndex: number, kind: 'Paid' | 'Held') => Promise<boolean>;
  /** Persists an escalated run for the co-op screen's "Needs co-op review" card (web/src/lib/keeper-runs.ts). */
  recordEscalatedRun: (result: KeeperRunResult) => void | Promise<void>;
}

export function defaultKeeperRunDeps(): KeeperRunDeps {
  return {
    publicClient: getKeeperPublicClient(),
    getSigningClient: () => {
      const clients = getKeeperChainClients();
      return { walletClient: clients.walletClient, account: clients.account };
    },
    poolAddress: (env.reliefPoolAddress() ?? missingPool()) as Address,
    feedUrl: env.pipelineFeedUrl(),
    fallbackKeys: {
      pipeline: env.pipelineSignerPrivateKey() as Hex | undefined,
      coop: env.coopSignerPrivateKey() as Hex | undefined,
      science: env.scienceKeyPrivateKey() as Hex | undefined,
    },
    fetchFn: fetch,
    fromBlock: env.reliefPoolDeployBlock(),
    batchSize: 5,
    now: () => Date.now(),
    pushPaid,
    pushHeld,
    lineUserIdForWallet: payoutDirectory.lineUserIdForWallet,
    lineUserIdForPlot: payoutDirectory.lineUserIdForPlot,
    recordPlotWallet,
    decideAttest: (state) => decideAttestGate(state),
    claimNotification,
    recordEscalatedRun,
  };
}

export interface KeeperRunOptions {
  referenceEventId: string;
  dryRun?: boolean;
  /** Skips the Jev attest gate entirely and proceeds straight to attest, for live-demo overrides. */
  force?: boolean;
  /** Which half of the run to do (the co-op event console): 'attest' anchors the Trigger and stops before
   *  settle; 'settle' requires the event to be attested already and only settles. Default 'all'. */
  stage?: KeeperStage;
}

export type KeeperStage = 'all' | 'attest' | 'settle';

/** Thrown by a `stage: 'settle'` run when the event hasn't been attested yet. */
export class NotAttestedError extends Error {
  constructor(referenceEventId: string) {
    super(`${referenceEventId} has not been anchored (attested) yet -- run the attest stage first`);
    this.name = 'NotAttestedError';
  }
}

export interface PlotSettlementOutcome {
  plotLabel: string;
  status: 'Paid' | 'Held' | 'skipped';
  /** Held reason (decoded ASCII label, e.g. "UNVERIFIED"), or the prior status name when skipped. */
  reason?: string;
  farmer?: Address;
  amount?: bigint;
  txHash?: Hex;
}

export interface LinePushOutcome {
  plotLabel: string;
  kind: 'Paid' | 'Held';
  lineUserId?: string;
  sent: boolean;
}

export interface KeeperRunResult {
  referenceEventId: string;
  eventId: Hex;
  trigger?: Trigger;
  /** 'already-attested' when the event was attested before this run started (no trigger was resolved). */
  triggerSource: TriggerSource | 'already-attested';
  dryRun: boolean;
  alreadyAttested: boolean;
  attestTxHash?: Hex;
  /** Plots currently enrolled for this event's zone/species (before filtering by settlement status). */
  eligiblePlots: string[];
  /** Subset of `eligiblePlots` that were Unsettled and so were (or, in --dry-run, would be) submitted to `settle`. */
  unsettledPlots: string[];
  settleTxHashes: Hex[];
  plotOutcomes: PlotSettlementOutcome[];
  pushes: LinePushOutcome[];
  /** 'escalated' when the Jev attest gate held this run for co-op review -- attest/settle never ran. */
  status: 'ok' | 'escalated';
  /** Set whenever the gate was actually asked (i.e. not already-attested and not --force). */
  jevGate?: AttestGateResult;
}

export async function runKeeper(options: KeeperRunOptions, deps: KeeperRunDeps = defaultKeeperRunDeps()): Promise<KeeperRunResult> {
  const dryRun = options.dryRun ?? false;
  const stage = options.stage ?? 'all';
  const ref = getReferenceEvent(options.referenceEventId);
  const zoneId = idOf(ref.zone);
  const speciesId = idOf(ref.species);
  const eventId = eventIdOf(ref.zone, ref.species, ref.peril, ref.tier, ref.payoutSeasonLabel);

  const attestation = await deps.publicClient.readContract({
    address: deps.poolAddress,
    abi: ReliefPoolAbi,
    functionName: 'attestations',
    args: [eventId],
  });
  let alreadyAttested = attestation[6] !== 0n; // [zoneId, speciesId, seasonLabel, eligibleUnits, perUnit, reservedAmount, attestedAt, claimDeadline]
  if (stage === 'settle' && !alreadyAttested) throw new NotAttestedError(ref.id);

  let trigger: Trigger | undefined;
  let triggerSource: TriggerSource | 'already-attested' = alreadyAttested ? 'already-attested' : 'feed';
  let attestTxHash: Hex | undefined;
  let jevGate: AttestGateResult | undefined;

  const signing = dryRun ? null : deps.getSigningClient();

  if (alreadyAttested) {
    console.log(`[keeper] ${ref.id}: eventId ${eventId} already attested -- skipping straight to settle`);
  } else {
    const threshold = await deps.publicClient.readContract({
      address: deps.poolAddress,
      abi: ReliefPoolAbi,
      functionName: 'signerThreshold',
    });
    if (threshold === 0n) {
      throw new Error(`ReliefPool at ${deps.poolAddress} has no signer threshold set (issue #16 setSigners) -- cannot attest`);
    }

    const resolved = await resolveSignedTrigger({
      referenceEventId: ref.id,
      zone: ref.zone,
      dataSeason: ref.dataSeason,
      species: ref.species,
      tier: ref.tier,
      poolAddress: deps.poolAddress,
      feedUrl: deps.feedUrl,
      threshold: Number(threshold),
      isRegisteredSigner: (address) =>
        deps.publicClient.readContract({
          address: deps.poolAddress,
          abi: ReliefPoolAbi,
          functionName: 'isSigner',
          args: [address],
        }),
      fallbackKeys: deps.fallbackKeys,
      fetchFn: deps.fetchFn,
      now: deps.now,
    });

    trigger = resolved.trigger;
    triggerSource = resolved.source;

    const resolvedEventId = triggerEventId(trigger);
    if (resolvedEventId !== eventId) {
      throw new Error(
        `[keeper] ${ref.id}: resolved trigger's eventId ${resolvedEventId} does not match the expected ${eventId} -- refusing to attest`,
      );
    }

    if (options.force) {
      console.log(`[keeper] ${ref.id}: --force set -- skipping the Jev attest gate`);
    } else {
      jevGate = await deps.decideAttest(buildAttestGateState(trigger, ref));
      console.log(
        JSON.stringify({
          scope: 'jev',
          kind: 'attest_gate_decision',
          refId: ref.id,
          eventId,
          decision: jevGate.decision,
          confidence: jevGate.confidence,
          probabilities: jevGate.probabilities,
          reason: jevGate.reason,
        }),
      );
      if (jevGate.decision === 'co_op_review') {
        console.log(`[keeper] ${ref.id}: Jev gate held this event for co-op review -- not attesting (pass force:true to override)`);
        const escalated: KeeperRunResult = {
          referenceEventId: ref.id,
          eventId,
          trigger,
          triggerSource,
          dryRun,
          alreadyAttested,
          eligiblePlots: [],
          unsettledPlots: [],
          settleTxHashes: [],
          plotOutcomes: [],
          pushes: [],
          status: 'escalated',
          jevGate,
        };
        try {
          await deps.recordEscalatedRun(escalated);
        } catch (err) {
          console.warn(`[keeper] ${ref.id}: failed to persist escalated run (non-fatal)`, err);
        }
        return escalated;
      }
    }

    if (dryRun) {
      console.log(`[keeper] ${ref.id}: --dry-run, would attest eventId ${eventId} with ${resolved.signatures.length} signature(s) (source: ${triggerSource})`);
    } else {
      const { walletClient, account } = signing!;
      try {
        const { request } = await deps.publicClient.simulateContract({
          address: deps.poolAddress,
          abi: ReliefPoolAbi,
          functionName: 'attest',
          args: [trigger, resolved.signatures.map((s) => s.signature)],
          account,
        });
        attestTxHash = await walletClient.writeContract(request);
        await deps.publicClient.waitForTransactionReceipt({ hash: attestTxHash });
        console.log(`[keeper] ${ref.id}: attested eventId ${eventId} in tx ${attestTxHash} (source: ${triggerSource})`);
      } catch (err) {
        if (isAlreadyAttestedError(err)) {
          console.warn(`[keeper] ${ref.id}: attest reverted AlreadyAttested (race with another keeper run?) -- proceeding to settle`);
          alreadyAttested = true;
        } else {
          throw err;
        }
      }
    }
  }

  const eligiblePlots = await listEnrolledPlots({
    publicClient: deps.publicClient,
    poolAddress: deps.poolAddress,
    zoneId,
    speciesId,
    fromBlock: deps.fromBlock,
  });

  const plotOutcomes: PlotSettlementOutcome[] = [];
  const unsettledPlots: string[] = [];
  for (const plotLabel of eligiblePlots) {
    const [status] = await deps.publicClient.readContract({
      address: deps.poolAddress,
      abi: ReliefPoolAbi,
      functionName: 'plotSettlements',
      args: [eventId, plotLabel],
    });
    if (status === 0) {
      unsettledPlots.push(plotLabel);
    } else {
      plotOutcomes.push({ plotLabel, status: 'skipped', reason: PLOT_STATUS_NAMES[status] });
    }
  }

  const settleTxHashes: Hex[] = [];
  const pushes: LinePushOutcome[] = [];

  if (stage === 'attest') {
    console.log(`[keeper] ${ref.id}: attest stage only -- leaving ${unsettledPlots.length} plot(s) unsettled`);
  } else if (!dryRun && unsettledPlots.length > 0) {
    const { walletClient, account } = signing!;
    for (const batch of batchPlots(unsettledPlots, deps.batchSize)) {
      const { request } = await deps.publicClient.simulateContract({
        address: deps.poolAddress,
        abi: ReliefPoolAbi,
        functionName: 'settle',
        args: [eventId, batch],
        account,
      });
      const txHash = await walletClient.writeContract(request);
      const receipt = await deps.publicClient.waitForTransactionReceipt({ hash: txHash });
      settleTxHashes.push(txHash);
      console.log(`[keeper] ${ref.id}: settled batch [${batch.join(', ')}] in tx ${txHash}`);

      const decoded = parseEventLogs({ abi: ReliefPoolAbi, logs: receipt.logs, eventName: ['Paid', 'Held'] });
      for (const log of decoded) {
        if (log.eventName === 'Paid') {
          const { plotLabel, farmer, amount } = log.args;
          await deps.recordPlotWallet(plotLabel, farmer);

          const lineUserId = await deps.lineUserIdForWallet(farmer);
          let sent = false;
          if (lineUserId && (await deps.claimNotification(txHash, log.logIndex ?? 0, 'Paid'))) {
            await deps.pushPaid(lineUserId, { plotCode: plotLabel, zoneLabel: zoneLabelFor(plotLabel), amountWei: amount, txHash });
            sent = true;
          } else if (!lineUserId) {
            console.warn(`[keeper] Paid ${plotLabel}: no LINE mapping yet for wallet ${farmer} (see issue #15)`);
          }
          plotOutcomes.push({ plotLabel, status: 'Paid', farmer, amount, txHash });
          pushes.push({ plotLabel, kind: 'Paid', lineUserId: lineUserId ?? undefined, sent });
        } else if (log.eventName === 'Held') {
          const { plotLabel, reason } = log.args;
          const reasonLabel = bytes32ToLabel(reason);

          // Best-effort bookkeeping: payoutTarget doesn't check verification/cap, so a Held plot's farmer
          // wallet (unless the hold is NO_FARMER/ZONE_MISMATCH) is still worth recording for #15.
          try {
            const [farmer] = await deps.publicClient.readContract({
              address: deps.poolAddress,
              abi: ReliefPoolAbi,
              functionName: 'payoutTarget',
              args: [plotLabel, ref.payoutSeasonLabel],
            });
            if (farmer && farmer !== zeroAddress) await deps.recordPlotWallet(plotLabel, farmer);
          } catch (err) {
            console.warn(`[keeper] Held ${plotLabel}: payoutTarget lookup failed (non-fatal)`, err);
          }

          const lineUserId = await deps.lineUserIdForPlot(plotLabel);
          let sent = false;
          if (lineUserId && (await deps.claimNotification(txHash, log.logIndex ?? 0, 'Held'))) {
            const text = heldReasonText(reasonLabel);
            await deps.pushHeld(lineUserId, { plotCode: plotLabel, zoneLabel: zoneLabelFor(plotLabel), ...text });
            sent = true;
          } else if (!lineUserId) {
            console.warn(`[keeper] Held ${plotLabel} (${reasonLabel}): no LINE mapping yet for plot (see issue #15)`);
          }
          plotOutcomes.push({ plotLabel, status: 'Held', reason: reasonLabel, txHash });
          pushes.push({ plotLabel, kind: 'Held', lineUserId: lineUserId ?? undefined, sent });
        }
      }
    }
  } else if (dryRun && unsettledPlots.length > 0) {
    console.log(`[keeper] ${ref.id}: --dry-run, would settle ${unsettledPlots.length} plot(s) in ${batchPlots(unsettledPlots, deps.batchSize).length} batch(es): [${unsettledPlots.join(', ')}]`);
  }

  return {
    referenceEventId: ref.id,
    eventId,
    trigger,
    triggerSource,
    dryRun,
    alreadyAttested,
    attestTxHash,
    eligiblePlots,
    unsettledPlots,
    settleTxHashes,
    plotOutcomes,
    pushes,
    status: 'ok',
    jevGate,
  };
}

function missingPool(): never {
  throw new Error('missing env RELIEF_POOL_ADDRESS (deploy ReliefPool first, issue #16)');
}
