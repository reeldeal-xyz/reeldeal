// wagmi config shared by the holder/co-op/donate screens (issues #19/#20/#21). Sepolia only, injected
// browser wallets only (MetaMask) — no WalletConnect project id to manage for a hackathon demo.
import { fallback, http, createConfig } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

/** NEXT_PUBLIC_SEPOLIA_RPC_URL may list several comma-separated RPCs; fail over across them. Falls back to
 *  the chain's public RPC when unset. */
export const sepoliaClientTransport = (rpcUrl?: string) => {
  const urls = (rpcUrl ?? '').split(',').map((u) => u.trim()).filter(Boolean);
  return urls.length > 1 ? fallback(urls.map((u) => http(u, { retryCount: 1 }))) : http(urls[0]);
};

export const createWagmiConfig = (rpcUrl?: string) =>
  createConfig({
    chains: [sepolia],
    connectors: [injected()],
    transports: { [sepolia.id]: sepoliaClientTransport(rpcUrl) },
    ssr: true,
  });

export const wagmiConfig = createWagmiConfig();
