'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EscalatedRun } from '@/lib/keeper-runs';

export function useEscalatedRuns() {
  return useQuery({
    queryKey: ['escalated-runs'],
    refetchInterval: 15_000,
    queryFn: async (): Promise<EscalatedRun[]> => {
      const res = await fetch('/api/coop/escalated-runs');
      if (!res.ok) throw new Error(`escalated runs query failed: HTTP ${res.status}`);
      const json = (await res.json()) as { runs: EscalatedRun[] };
      return json.runs;
    },
  });
}

export function useInvalidateEscalatedRuns() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['escalated-runs'] });
}
