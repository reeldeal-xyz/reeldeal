'use client';

// Wagmi + TanStack Query providers for the browser-wallet screens (issues #19/#20/#21). This is the one change
// made to the root layout for this work — everything else (LIFF, World ID, verify) is unaffected by wrapping in
// a provider that only activates when a component calls a wagmi hook.
import { useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { createWagmiConfig } from '@/lib/wagmi';

export function Providers({ rpcUrl, children }: { rpcUrl?: string; children: ReactNode }) {
  const config = useMemo(() => createWagmiConfig(rpcUrl), [rpcUrl]);
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } }));

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
