import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { sepolia as appKitSepolia } from '@reown/appkit/networks';
import { createConfig, http, injected, type Config } from 'wagmi';
import { sepolia } from 'wagmi/chains';

let cached: { projectId: string; config: Config } | undefined;

/** Both wallet controls and checkout use this one wagmi store. AppKit registers global elements once. */
export function getOrCreateWalletConfig(projectId: string | undefined, appUrl: string): Config {
  const id = projectId?.trim() ?? '';
  if (cached) return cached.config;

  if (!id) {
    const config = createConfig({
      chains: [sepolia],
      connectors: [injected()],
      transports: { [sepolia.id]: http() },
      ssr: true,
    });
    cached = { projectId: '', config };
    return config;
  }

  const adapter = new WagmiAdapter({ networks: [appKitSepolia], projectId: id, ssr: true });
  createAppKit({
    adapters: [adapter],
    networks: [appKitSepolia],
    defaultNetwork: appKitSepolia,
    projectId: id,
    metadata: {
      name: 'Reel Deal',
      description: 'Miyagi coastal map and fish market',
      url: appUrl,
      icons: [`${appUrl}/favicon.ico`],
    },
    features: { email: false, socials: false, swaps: false, onramp: false },
  });
  cached = { projectId: id, config: adapter.wagmiConfig };
  return cached.config;
}

export function currentWalletConfig(): Config | undefined {
  return cached?.config;
}
