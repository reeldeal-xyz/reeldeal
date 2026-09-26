'use client';

// Batched on-chain reads for the co-op screen's 15-plot table (issue #20): holder (branch registry
// `findOwner`), current slot owner + level (ReliefPool.payoutTarget + HumanRegistry.levelOf — both already
// real, merged interfaces; see #8/#11 on payoutTarget's ISlotResolver backing). Each read group is its own
// multicall batch (async-parallel: independent reads run together; levelOf depends on farmers resolving
// first, so it's the one sequential step).
import { useMemo } from 'react';
import { useReadContracts } from 'wagmi';
import type { Address } from 'viem';
import { DEMO_PLOTS, SEASON_LABEL, type DemoPlot } from '@/lib/plots';
import { ReliefPoolAbi, HumanRegistryAbi } from '@/lib/contracts';
import { EnsRegistryReadAbi } from '@/lib/ens-adapter';

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

export interface PlotRow extends DemoPlot {
  holder?: Address;
  farmer?: Address;
  slotExpiry?: bigint;
  level?: number;
}

export function usePlotTable(opts: {
  reliefPool?: Address;
  humanRegistry?: Address;
  parentRegistry?: Address;
  seasonLabel?: string;
}) {
  const { reliefPool, humanRegistry, parentRegistry, seasonLabel = SEASON_LABEL } = opts;

  const payoutTargetQuery = useReadContracts({
    contracts: DEMO_PLOTS.map((p) => ({
      address: reliefPool ?? ZERO_ADDRESS,
      abi: ReliefPoolAbi,
      functionName: 'payoutTarget' as const,
      args: [p.plotLabel, seasonLabel] as const,
    })),
    allowFailure: true,
    query: { enabled: Boolean(reliefPool), staleTime: 15_000, refetchInterval: 20_000 },
  });

  const holderQuery = useReadContracts({
    contracts: DEMO_PLOTS.map((p) => ({
      address: parentRegistry ?? ZERO_ADDRESS,
      abi: EnsRegistryReadAbi,
      functionName: 'findOwner' as const,
      args: [p.plotLabel] as const,
    })),
    allowFailure: true,
    query: { enabled: Boolean(parentRegistry), staleTime: 15_000, refetchInterval: 20_000 },
  });

  const farmers = useMemo<Address[]>(() => {
    if (!payoutTargetQuery.data) return DEMO_PLOTS.map(() => ZERO_ADDRESS);
    return payoutTargetQuery.data.map((entry) => {
      if (entry.status !== 'success') return ZERO_ADDRESS;
      const [farmer] = entry.result as readonly [Address, Address, bigint];
      return farmer;
    });
  }, [payoutTargetQuery.data]);

  const levelQuery = useReadContracts({
    contracts: farmers.map((farmer) => ({
      address: humanRegistry ?? ZERO_ADDRESS,
      abi: HumanRegistryAbi,
      functionName: 'levelOf' as const,
      args: [farmer] as const,
    })),
    allowFailure: true,
    query: { enabled: Boolean(humanRegistry) && Boolean(payoutTargetQuery.data), staleTime: 15_000 },
  });

  const rows: PlotRow[] = DEMO_PLOTS.map((plot, i) => {
    const payout = payoutTargetQuery.data?.[i];
    const holder = holderQuery.data?.[i];
    const level = levelQuery.data?.[i];

    let farmer: Address | undefined;
    let slotExpiry: bigint | undefined;
    if (payout?.status === 'success') {
      const [f, , expiry] = payout.result as readonly [Address, Address, bigint];
      farmer = f !== ZERO_ADDRESS ? f : undefined;
      slotExpiry = expiry > 0n ? expiry : undefined;
    }

    return {
      ...plot,
      holder: holder?.status === 'success' && holder.result !== ZERO_ADDRESS ? (holder.result as Address) : undefined,
      farmer,
      slotExpiry,
      level: level?.status === 'success' ? Number(level.result) : undefined,
    };
  });

  return {
    rows,
    isLoading: payoutTargetQuery.isLoading || holderQuery.isLoading,
    refetch: () => {
      payoutTargetQuery.refetch();
      holderQuery.refetch();
      levelQuery.refetch();
    },
  };
}
