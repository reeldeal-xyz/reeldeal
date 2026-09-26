'use client';

// Nests a second WagmiProvider (Reown AppKit's config, with WalletConnect/injected/Coinbase connectors)
// scoped to just the /app route's subtree -- the root layout's own Providers (components/providers.tsx)
// keeps backing /donate /coop /holder with its plain injected-only config untouched. React context nesting
// means this inner config simply shadows the outer one for anything under /app; /liff never renders inside
// this provider at all, so it's unaffected either way.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { getOrCreateAppKit } from '@/lib/appkit';

const ReownConfiguredContext = createContext(false);

/** True once NEXT_PUBLIC_REOWN_PROJECT_ID is set and AppKit/wagmi are wired up. components/app/wallet-app.tsx
 *  reads this to explain "wallet sign-in isn't configured yet" instead of rendering a connect button that
 *  can never work. */
export function useReownConfigured(): boolean {
  return useContext(ReownConfiguredContext);
}

interface WalletProvidersProps {
  /** NEXT_PUBLIC_REOWN_PROJECT_ID (lib/env.ts's publicEnv) -- undefined means "not configured yet". */
  projectId?: string;
  /** The request origin, resolved server-side (app/app/layout.tsx reads the Host header) so AppKit's
   *  metadata.url is correct even during the first server-rendered paint. */
  appUrl: string;
  children: ReactNode;
}

export function WalletProviders({ projectId, appUrl, children }: WalletProvidersProps) {
  if (!projectId) {
    return <ReownConfiguredContext.Provider value={false}>{children}</ReownConfiguredContext.Provider>;
  }
  return (
    <ConfiguredWalletProviders projectId={projectId} appUrl={appUrl}>
      {children}
    </ConfiguredWalletProviders>
  );
}

/** Split out so the `useMemo`/`useState` below are never called conditionally (Rules of Hooks) -- this
 *  component only mounts once `projectId` is known to be set. */
function ConfiguredWalletProviders({ projectId, appUrl, children }: { projectId: string; appUrl: string; children: ReactNode }) {
  const wagmiConfig = useMemo(() => getOrCreateAppKit({ projectId, appUrl }), [projectId, appUrl]);
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } }));

  return (
    <ReownConfiguredContext.Provider value={true}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    </ReownConfiguredContext.Provider>
  );
}
