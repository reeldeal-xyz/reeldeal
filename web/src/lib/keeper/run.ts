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
import { payoutDirectory, recordPlotWallet } from '@/lib/payout-directory';
import {
  getKeeperChainClients,
  getKeeperPublicClient,
  type KeeperPublicClient,
  type KeeperWalletClient,
} from './chain-clients';
import { batchPlots, listEnrolledPlots } from './plots';
import { getReferenceEvent } from './reference-events';
import { resolveSignedTrigger, type FallbackKeys, type TriggerSource } from './signing';

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
  recordPlotWallet: (plotLabel: string, wallet: string) => void;
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
  };
}

export interface KeeperRunOptions {
  referenceEventId: string;
  dryRun?: boolean;
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
}

export async function runKeeper(options: KeeperRunOptions, deps: KeeperRunDeps = defaultKeeperRunDeps()): Promise<KeeperRunResult> {
  const dryRun = options.dryRun ?? false;
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

  let trigger: Trigger | undefined;
  let triggerSource: TriggerSource | 'already-attested' = alreadyAttested ? 'already-attested' : 'feed';
  let attestTxHash: Hex | undefined;

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

  if (!dryRun && unsettledPlots.length > 0) {
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
          deps.recordPlotWallet(plotLabel, farmer);

          const lineUserId = await deps.lineUserIdForWallet(farmer);
          let sent = false;
          if (lineUserId) {
            await deps.pushPaid(lineUserId, { plotCode: plotLabel, zoneLabel: zoneLabelFor(plotLabel), amountWei: amount, txHash });
            sent = true;
          } else {
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
            if (farmer && farmer !== zeroAddress) deps.recordPlotWallet(plotLabel, farmer);
          } catch (err) {
            console.warn(`[keeper] Held ${plotLabel}: payoutTarget lookup failed (non-fatal)`, err);
          }

          const lineUserId = await deps.lineUserIdForPlot(plotLabel);
          let sent = false;
          if (lineUserId) {
            const text = heldReasonText(reasonLabel);
            await deps.pushHeld(lineUserId, { plotCode: plotLabel, zoneLabel: zoneLabelFor(plotLabel), ...text });
            sent = true;
          } else {
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
  };
}

function missingPool(): never {
  throw new Error('missing env RELIEF_POOL_ADDRESS (deploy ReliefPool first, issue #16)');
}
