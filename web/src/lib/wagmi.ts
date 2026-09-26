// wagmi config shared by the holder/co-op/donate screens (issues #19/#20/#21). Sepolia only, injected
// browser wallets only (MetaMask) — no WalletConnect project id to manage for a hackathon demo.
import { http, createConfig } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

/** Falls back to a public RPC when NEXT_PUBLIC_SEPOLIA_RPC_URL is unset; pass the resolved value in. */
export const createWagmiConfig = (rpcUrl?: string) =>
  createConfig({
    chains: [sepolia],
    connectors: [injected()],
    transports: { [sepolia.id]: http(rpcUrl) },
    ssr: true,
  });

export const wagmiConfig = createWagmiConfig();
