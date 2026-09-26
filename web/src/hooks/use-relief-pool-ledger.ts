'use client';

// Shared ledger reader for the donor screen (issue #21: "ledger from events (Donated, Attested, Paid, Held)")
// and the co-op screen's "last payout" column (issue #20). Reads whichever of Donated/Enrolled/Attested/
// Paid/Held/Claimed/Swept exist on the connected ABI — ReliefPool core (#5) always has Donated/Enrolled/
// Attested; Paid/Held/Claimed/Swept were added by #8 and are present in packages/shared's ABI as of that merge,
// but this stays defensive (via getAbiItem) rather than assuming, in case a differently-versioned pool is ever
// pointed at.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useConfig } from 'wagmi';
import { getPublicClient } from 'wagmi/actions';
import { getAbiItem, type AbiEvent, type Address } from 'viem';
import { ReliefPoolAbi } from '@/lib/contracts';

const LEDGER_EVENT_NAMES = ['Donated', 'Enrolled', 'Attested', 'Paid', 'Held', 'Claimed', 'Swept'] as const;
export type LedgerEventName = (typeof LEDGER_EVENT_NAMES)[number];

export interface LedgerEntry {
  type: LedgerEventName;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  logIndex: number;
  args: Record<string, unknown>;
}

const availableLedgerEvents = (): AbiEvent[] =>
  LEDGER_EVENT_NAMES.map((name) => {
    try {
      return getAbiItem({ abi: ReliefPoolAbi, name }) as AbiEvent | undefined;
    } catch {
      return undefined;
    }
  }).filter((event): event is AbiEvent => Boolean(event));

export function useReliefPoolLedger(address: Address | undefined, fromBlock: bigint) {
  const config = useConfig();
  const events = useMemo(availableLedgerEvents, []);

  const query = useQuery({
    queryKey: ['relief-pool-ledger', address, fromBlock.toString()],
    enabled: Boolean(address),
    refetchInterval: 15_000,
    queryFn: async (): Promise<LedgerEntry[]> => {
      if (!address) return [];
      const client = getPublicClient(config);
      if (!client) return [];
      const logs = await client.getLogs({ address, events, fromBlock, toBlock: 'latest' });
      return logs
        .map((log) => ({
          type: log.eventName as LedgerEventName,
          blockNumber: log.blockNumber ?? 0n,
          transactionHash: log.transactionHash ?? '0x',
          logIndex: log.logIndex ?? 0,
          args: (log.args ?? {}) as Record<string, unknown>,
        }))
        .sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : Number(b.blockNumber - a.blockNumber)));
    },
  });

  return query;
}

/** Most recent Paid entry per plot, for the co-op screen's "last payout" column. */
export function lastPaidByPlot(entries: LedgerEntry[]): Map<string, LedgerEntry> {
  const byPlot = new Map<string, LedgerEntry>();
  for (const entry of entries) {
    if (entry.type !== 'Paid') continue;
    const plotLabel = entry.args.plotLabel as string | undefined;
    if (!plotLabel) continue;
    const existing = byPlot.get(plotLabel);
    if (!existing || entry.blockNumber > existing.blockNumber) byPlot.set(plotLabel, entry);
  }
  return byPlot;
}
