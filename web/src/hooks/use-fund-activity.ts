'use client';

// Client-side fetch for the /donate "Fund activity" panel (sponsor-polish task, Curvegrid MultiBaas
// track). GET /api/multibaas/events does the actual source selection (MultiBaas vs. direct viem log
// fallback) server-side -- this hook just polls it, matching useReliefPoolLedger's refetch cadence.
import { useQuery } from '@tanstack/react-query';
import type { FundActivityResult } from '@/lib/fund-activity';

export function useFundActivity() {
  return useQuery({
    queryKey: ['fund-activity'],
    refetchInterval: 15_000,
    queryFn: async (): Promise<FundActivityResult> => {
      const res = await fetch('/api/multibaas/events');
      if (!res.ok) throw new Error(`fund activity query failed: HTTP ${res.status}`);
      return (await res.json()) as FundActivityResult;
    },
  });
}
