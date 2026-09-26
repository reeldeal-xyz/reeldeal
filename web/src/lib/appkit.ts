'use client';

// Reown AppKit + its wagmi adapter for the wallet-login path (/app, no LINE account needed). Kept separate
// from lib/wagmi.ts's plain injected-only config -- that one still backs /donate /coop /holder unmodified;
// this one is only ever mounted inside components/app/wallet-providers.tsx, nested under the root layout's
// plain WagmiProvider and scoped to just the /app route's subtree, since AppKit's WalletConnect relay/social
// connectors are more than those simpler screens need for a hackathon demo.
//
// Version note (docs.reown.com, verified 2026-09-26, not from memory): the stable @reown/appkit-adapter-wagmi
// line only declares `wagmi >=2.19.5` as a peer -- that predates wagmi's v3 line and was never re-tested
// against it. Reown separately publishes a dedicated `2.0.0-wagmi-v3.0` dist-tag across @reown/appkit,
// @reown/appkit-adapter-wagmi and every internal @reown/appkit-* package in lockstep, with
// `wagmi >=3.0.0` / `@wagmi/core >=3.0.0` peers -- that exact tag is what's pinned in package.json to match
// this repo's wagmi ^3.7.7 / viem ^2.56.9. It isn't tagged `latest` (still 1.8.24 there as of this writing),
// so treat it as newer and less road-tested than the mainstream release -- verified to install and build
// cleanly here, but worth re-checking against `npm view @reown/appkit dist-tags` before it's promoted.
import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { sepolia } from '@reown/appkit/networks';
import type { Config } from 'wagmi';

export interface AppKitInitParams {
  projectId: string;
  /** The request origin (e.g. `https://app.reeldeal.example`) -- metadata.url, never hardcoded, so local
   *  dev/preview deploys/production all report their own real origin to connecting wallets. */
  appUrl: string;
}

let cached: { projectId: string; wagmiConfig: Config } | null = null;

/** Idempotent per `projectId`: `createAppKit` registers global custom elements (`<appkit-button>` etc.) and
 *  must only run once per page load. Safe to call on every render of the provider that owns it -- see
 *  components/app/wallet-providers.tsx, the only caller. */
export function getOrCreateAppKit({ projectId, appUrl }: AppKitInitParams): Config {
  if (cached && cached.projectId === projectId) return cached.wagmiConfig;

  const wagmiAdapter = new WagmiAdapter({
    networks: [sepolia],
    projectId,
    ssr: true,
  });

  createAppKit({
    adapters: [wagmiAdapter],
    networks: [sepolia],
    defaultNetwork: sepolia,
    projectId,
    metadata: {
      name: 'Reel Deal',
      description: 'Relief payouts for aquaculture farmers (Kesennuma) -- sign in with LINE or a wallet.',
      url: appUrl,
      icons: [`${appUrl}/favicon.ico`],
    },
    features: { email: false, socials: false, swaps: false, onramp: false },
  });

  cached = { projectId, wagmiConfig: wagmiAdapter.wagmiConfig };
  return cached.wagmiConfig;
}
