// On-chain status reader for the LIFF status screen (issue #15). Resolves which of four farmer-facing
// paths applies for a given (plotLabel, wallet): no slot yet, held until verified, held for another reason,
// or verified & paid. Pure functions over an injectable viem-shaped client (mirrors lib/world/binder.ts's
// injectable-clients pattern) so tests never touch a real RPC.
//
// Paid/Held only index `eventId` (plus `farmer`/`nullifier` on Paid) -- neither indexes `plotLabel` -- so,
// like lib/keeper/plots.ts's `listEnrolledPlots`, this fetches the event log and filters by the decoded
// (non-indexed) `plotLabel` field client-side rather than via a topic filter.
import { getAbiItem, hexToString, zeroAddress, type Address, type Hex, type PublicClient } from 'viem';
import { HumanRegistryAbi, ReliefPoolAbi } from '@repo/shared';

/** Mirrors lib/keeper/chain-clients.ts's `KeeperPublicClient` -- pick the real viem methods rather than
 *  hand-rolling a shape, so a real `createPublicClient(...)` result is assignable without casts, and a test
 *  mock only needs to satisfy these two methods (cast with `as never` like lib/world/binder.test.ts does). */
export type LiffStatusClient = Pick<PublicClient, 'readContract' | 'getLogs'>;

const PAID_EVENT = getAbiItem({ abi: ReliefPoolAbi, name: 'Paid' });
const HELD_EVENT = getAbiItem({ abi: ReliefPoolAbi, name: 'Held' });

/** Decodes a bytes32 ASCII hold reason (e.g. ReliefPool.REASON_UNVERIFIED) back to its short string.
 *  Mirrors lib/keeper/run.ts's local `bytes32ToLabel` (not exported there) and lib/format.ts's
 *  `decodeReason` (same behavior, viem's `hexToString` variant). */
function bytes32ToLabel(hex: Hex): string {
  return hexToString(hex).replace(/\u0000+$/, '');
}

export type StatusPath =
  /** Path 1: nobody (or someone else) currently holds this plot's season slot -- covers "never requested",
   *  "requested but not yet issued", and "issued to a different wallet". */
  | { kind: 'no_slot'; currentFarmer: Address | null }
  /** Path 2: the latest settlement for this plot is Held with reason UNVERIFIED -- claimable via
   *  POST /api/liff/claim once the wallet's World ID level is > 0. */
  | { kind: 'held_unverified'; eventId: Hex; plotLabel: string }
  /** Path 4: Held for any other reason (NO_FARMER, PLOT_EXPIRED, CAP, ZONE_MISMATCH), or the claim window
   *  elapsed and the reserve was swept -- nothing the farmer can do from this screen. */
  | { kind: 'held_other'; reason: string }
  /** Path 3: paid, either directly by `settle` or (after verifying) via `claimHeld`. */
  | { kind: 'paid'; amountWei: bigint; txHash: Hex };

export interface FetchLiffStatusParams {
  client: LiffStatusClient;
  reliefPoolAddress: Address;
  plotLabel: string;
  seasonLabel: string;
  wallet: Address;
  /** Bounds the Paid/Held log scan (NEXT_PUBLIC_RELIEF_POOL_DEPLOY_BLOCK). Defaults to 0n (genesis). */
  fromBlock?: bigint;
}

function latestByBlock<T extends { blockNumber: bigint | null }>(logs: readonly T[]): T | undefined {
  return [...logs].sort((a, b) => Number((b.blockNumber ?? 0n) - (a.blockNumber ?? 0n)))[0];
}

/** Reads the wallet's current World ID level (0 = unverified). Separate from `fetchLiffStatus` because the
 *  World ID bind card needs it even before a plot is selected. */
export async function fetchWorldLevel(
  client: Pick<LiffStatusClient, 'readContract'>,
  humanRegistryAddress: Address,
  wallet: Address,
): Promise<number> {
  const level = await client.readContract({
    address: humanRegistryAddress,
    abi: HumanRegistryAbi,
    functionName: 'levelOf',
    args: [wallet],
  });
  return Number(level);
}

/** Reads which World ID schema last verified this wallet (0 if never verified) -- lets the wallet tab show
 *  "verified via My Number Card / passport / World ID (Orb)" without re-running IDKit. `humanOf` returns the
 *  zero struct (schemaId 0) for a wallet that's never bound; see contracts/src/HumanRegistry.sol. */
export async function fetchWorldSchema(
  client: Pick<LiffStatusClient, 'readContract'>,
  humanRegistryAddress: Address,
  wallet: Address,
): Promise<number> {
  const human = (await client.readContract({
    address: humanRegistryAddress,
    abi: HumanRegistryAbi,
    functionName: 'humanOf',
    args: [wallet],
  })) as { schemaId: number };
  return Number(human.schemaId);
}

export async function fetchLiffStatus(params: FetchLiffStatusParams): Promise<StatusPath> {
  const { client, reliefPoolAddress, plotLabel, seasonLabel, wallet, fromBlock = 0n } = params;

  const [paidLogs, heldLogs] = await Promise.all([
    client.getLogs({
      address: reliefPoolAddress,
      event: PAID_EVENT,
      args: { farmer: wallet },
      fromBlock,
      toBlock: 'latest',
    }),
    client.getLogs({
      address: reliefPoolAddress,
      event: HELD_EVENT,
      fromBlock,
      toBlock: 'latest',
    }),
  ]);

  const paidForPlot = latestByBlock(paidLogs.filter((log) => (log.args as { plotLabel?: string }).plotLabel === plotLabel));
  if (paidForPlot) {
    const { amount } = paidForPlot.args as { amount: bigint };
    return { kind: 'paid', amountWei: amount, txHash: (paidForPlot.transactionHash ?? '0x') as Hex };
  }

  const heldForPlot = latestByBlock(heldLogs.filter((log) => (log.args as { plotLabel?: string }).plotLabel === plotLabel));
  if (heldForPlot) {
    const { eventId, reason } = heldForPlot.args as { eventId: Hex; reason: Hex };

    // The Held log is a point-in-time record; re-read the live settlement in case a later claimHeld/sweep
    // already moved it on (PlotStatus: 0 Unsettled, 1 Paid, 2 Held, 3 Claimed, 4 Swept).
    const settlement = (await client.readContract({
      address: reliefPoolAddress,
      abi: ReliefPoolAbi,
      functionName: 'plotSettlements',
      args: [eventId, plotLabel],
    })) as readonly [number, Hex];
    const [status] = settlement;

    if (status === 3) {
      // Claimed since -- `Claimed` doesn't carry the per-unit amount as cleanly as `Attestation.perUnit`
      // does, so read it from the attestation this Held event belongs to instead of re-scanning Claimed logs.
      const attestation = (await client.readContract({
        address: reliefPoolAddress,
        abi: ReliefPoolAbi,
        functionName: 'attestations',
        args: [eventId],
      })) as readonly [Hex, Hex, string, number, bigint, bigint, bigint, bigint];
      return { kind: 'paid', amountWei: attestation[4], txHash: (heldForPlot.transactionHash ?? '0x') as Hex };
    }

    if (status === 4) {
      return { kind: 'held_other', reason: 'CLAIM_WINDOW_ELAPSED' };
    }

    if (status === 2) {
      const label = bytes32ToLabel(reason);
      if (label === 'UNVERIFIED') {
        return { kind: 'held_unverified', eventId, plotLabel };
      }
      return { kind: 'held_other', reason: label };
    }
    // status === 1 (Paid) shouldn't reach here (paidForPlot would have matched above via the farmer filter
    // unless this wallet isn't the current farmer anymore) or 0 (Unsettled, shouldn't happen once Held was
    // ever emitted) -- fall through to the payoutTarget check below rather than guessing.
  }

  const target = (await client.readContract({
    address: reliefPoolAddress,
    abi: ReliefPoolAbi,
    functionName: 'payoutTarget',
    args: [plotLabel, seasonLabel],
  })) as readonly [Address, Address, bigint];
  const currentFarmer = target[0];

  return { kind: 'no_slot', currentFarmer: currentFarmer === zeroAddress ? null : currentFarmer };
}
