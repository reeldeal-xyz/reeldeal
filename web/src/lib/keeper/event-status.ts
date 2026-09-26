// Read model for the co-op event console: where each reference event is in its lifecycle
// (not fired -> awaiting co-op -> anchored -> settled) and what happened to every enrolled plot.
// Chain state is authoritative; escalated keeper runs (web/src/lib/keeper-runs.ts) only add the
// "awaiting co-op" state, which exists off-chain until the co-op accepts.
import { getAbiItem, hexToString, type Address, type Hex } from 'viem';
import { ReliefPoolAbi, eventIdOf, idOf } from '@repo/shared';
import type { EscalatedRun } from '@/lib/keeper-runs';
import type { KeeperPublicClient } from './chain-clients';
import { listEnrolledPlots } from './plots';
import { REFERENCE_EVENTS, type ReferenceEvent } from './reference-events';

export type EventStage = 'not_fired' | 'awaiting_coop' | 'anchored' | 'settled';
export type PlotState = 'Unsettled' | 'Paid' | 'Held' | 'Claimed' | 'Swept';

const PLOT_STATES: readonly PlotState[] = ['Unsettled', 'Paid', 'Held', 'Claimed', 'Swept'];

export interface EventPlotRow {
  plotLabel: string;
  state: PlotState;
  /** Held reason label, e.g. "UNVERIFIED". */
  reason?: string;
  /** JPYC in wei, as a decimal string (Paid / Claimed). */
  amount?: string;
  farmer?: Address;
  txHash?: Hex;
}

export interface EventStatus {
  id: string;
  eventId: Hex;
  species: ReferenceEvent['species'];
  peril: ReferenceEvent['peril'];
  tier: 1 | 2;
  dataSeason: string;
  firedOn: string;
  stage: EventStage;
  escalation?: { jevDecision: string | null; jevConfidence: number | null; jevReason: string | null; createdAt: string };
  attestation?: {
    txHash?: Hex;
    dataHash?: Hex;
    signers?: Address[];
    eligibleUnits: number;
    perUnit: string;
    attestedAt: number;
    claimDeadline: number;
  };
  plots: EventPlotRow[];
}

const ATTESTED = getAbiItem({ abi: ReliefPoolAbi, name: 'Attested' });
const PAID = getAbiItem({ abi: ReliefPoolAbi, name: 'Paid' });
const HELD = getAbiItem({ abi: ReliefPoolAbi, name: 'Held' });
const CLAIMED = getAbiItem({ abi: ReliefPoolAbi, name: 'Claimed' });

function bytes32ToLabel(hex: Hex): string {
  return hexToString(hex).replace(/\u0000+$/, '');
}

export interface EventStatusDeps {
  publicClient: KeeperPublicClient;
  poolAddress: Address;
  fromBlock: bigint;
  escalatedRuns: () => Promise<EscalatedRun[]>;
}

type AnyLog = { eventName?: string; transactionHash: Hex | null; args: Record<string, unknown> };

export async function listEventStatuses(deps: EventStatusDeps, events: readonly ReferenceEvent[] = REFERENCE_EVENTS): Promise<EventStatus[]> {
  const escalated = (await deps.escalatedRuns().catch(() => [])).filter((r) => r.status === 'escalated');
  const plotsBySpecies = new Map<string, Promise<string[]>>();
  const plotsFor = (ref: ReferenceEvent) => {
    const key = `${ref.zone}:${ref.species}`;
    let found = plotsBySpecies.get(key);
    if (!found) {
      found = withRetry(() => listEnrolledPlots({
        publicClient: deps.publicClient,
        poolAddress: deps.poolAddress,
        zoneId: idOf(ref.zone),
        speciesId: idOf(ref.species),
        fromBlock: deps.fromBlock,
      }));
      plotsBySpecies.set(key, found);
    }
    return found;
  };

  // Sequential on purpose: public Sepolia RPCs reject bursts of parallel eth_getLogs ("exceeds defined limit").
  const out: EventStatus[] = [];
  for (const ref of events) out.push(await statusFor(ref));
  return out;

  async function statusFor(ref: ReferenceEvent): Promise<EventStatus> {
      const eventId = eventIdOf(ref.zone, ref.species, ref.peril, ref.tier, ref.payoutSeasonLabel);
      const base = {
        id: ref.id,
        eventId,
        species: ref.species,
        peril: ref.peril,
        tier: ref.tier,
        dataSeason: ref.dataSeason,
        firedOn: ref.firedOn,
      };
      const a = await deps.publicClient.readContract({
        address: deps.poolAddress,
        abi: ReliefPoolAbi,
        functionName: 'attestations',
        args: [eventId],
      });
      const attestedAt = Number(a[6]);

      if (attestedAt === 0) {
        const run = escalated.find((r) => r.referenceEventId === ref.id);
        return {
          ...base,
          stage: run ? 'awaiting_coop' : 'not_fired',
          escalation: run
            ? { jevDecision: run.jevDecision, jevConfidence: run.jevConfidence, jevReason: run.jevReason, createdAt: run.createdAt }
            : undefined,
          plots: [],
        };
      }

      const labels = await plotsFor(ref);
      const [logs] = await Promise.all([
        (async () => {
          const found: AnyLog[] = [];
          for (const event of [ATTESTED, PAID, HELD, CLAIMED]) {
            const logs = await withRetry(() =>
              deps.publicClient.getLogs({
                address: deps.poolAddress,
                event,
                args: { eventId },
                fromBlock: deps.fromBlock,
                toBlock: 'latest',
              } as Parameters<KeeperPublicClient['getLogs']>[0]),
            );
            found.push(...(logs as unknown as AnyLog[]));
          }
          return found;
        })(),
      ]);

      const attestedLog = logs.find((l) => l.eventName === 'Attested');
      const trigger = attestedLog?.args.t as { dataHash?: Hex } | undefined;
      const byPlot = new Map<string, AnyLog[]>();
      for (const log of logs) {
        const label = log.args.plotLabel;
        if (typeof label === 'string') byPlot.set(label, [...(byPlot.get(label) ?? []), log]);
      }

      const plots: EventPlotRow[] = [];
      for (const plotLabel of labels) {
        plots.push(await (async (): Promise<EventPlotRow> => {
          const [status, holdReason] = await deps.publicClient.readContract({
            address: deps.poolAddress,
            abi: ReliefPoolAbi,
            functionName: 'plotSettlements',
            args: [eventId, plotLabel],
          });
          const state = PLOT_STATES[status] ?? 'Unsettled';
          const plotLogs = byPlot.get(plotLabel) ?? [];
          const last = (name: string) => [...plotLogs].reverse().find((l) => l.eventName === name);
          const row: EventPlotRow = { plotLabel, state };
          if (state === 'Held' || state === 'Swept') row.reason = bytes32ToLabel(holdReason as Hex);
          const source = state === 'Paid' ? last('Paid') : state === 'Claimed' ? last('Claimed') : last('Held');
          if (source) {
            row.txHash = source.transactionHash ?? undefined;
            if (typeof source.args.amount === 'bigint') row.amount = source.args.amount.toString();
            if (typeof source.args.farmer === 'string') row.farmer = source.args.farmer as Address;
          }
          return row;
        })());
      }

      return {
        ...base,
        stage: plots.length > 0 && plots.every((p) => p.state !== 'Unsettled') ? 'settled' : 'anchored',
        attestation: {
          txHash: attestedLog?.transactionHash ?? undefined,
          dataHash: trigger?.dataHash,
          signers: attestedLog?.args.signers as Address[] | undefined,
          eligibleUnits: Number(a[3]),
          perUnit: a[4].toString(),
          attestedAt,
          claimDeadline: Number(a[7]),
        },
        plots,
      };
  }
}


async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
}
