'use client';

// TODO(#15): swaps to whatever the real LIFF request API returns once it ships — see lib/slot-request-store.ts.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SlotRequest, SlotRequestStatus } from '@/lib/slot-request-store';

const QUERY_KEY = ['slot-requests'];

async function fetchRequests(): Promise<SlotRequest[]> {
  const res = await fetch('/api/holder/requests');
  if (!res.ok) throw new Error('failed to load slot requests');
  const data = (await res.json()) as { requests: SlotRequest[] };
  return data.requests;
}

export function useSlotRequests() {
  return useQuery({ queryKey: QUERY_KEY, queryFn: fetchRequests, refetchInterval: 20_000 });
}

export function useUpdateSlotRequestStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: SlotRequestStatus }) => {
      const res = await fetch(`/api/holder/requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('failed to update slot request');
      return (await res.json()) as { request: SlotRequest };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
