// Browser-only injected-wallet helper for the Donate and Checkout islands. Deliberately minimal: a plain
// EIP-1193 `window.ethereum` via viem's `custom` transport, no WalletConnect/Reown/AppKit. Never imported
// from a `.server.ts` module or an Astro frontmatter -- it touches `window` at call time.
import { createWalletClient, custom, type Address, type EIP1193Provider, type WalletClient } from 'viem';
import { sepolia } from 'viem/chains';

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export class WalletUnavailableError extends Error {
  constructor() { super('No wallet found. Install MetaMask or another browser wallet extension.'); }
}

export interface ConnectedWallet {
  client: WalletClient;
  address: Address;
}

async function ensureSepolia(client: WalletClient): Promise<void> {
  const chainId = await client.getChainId();
  if (chainId === sepolia.id) return;
  try {
    await client.switchChain({ id: sepolia.id });
  } catch {
    // Chain not yet added to the wallet (EIP-3326 error 4902, or a wallet that just throws) -- add then retry.
    await client.addChain({ chain: sepolia });
    await client.switchChain({ id: sepolia.id });
  }
}

/** Connects the injected wallet, switches (or adds) it to Sepolia, and returns a viem WalletClient bound
 *  to the connected account. Every call re-resolves the address so a wallet account switch is picked up. */
export async function connectWallet(): Promise<ConnectedWallet> {
  if (typeof window === 'undefined' || !window.ethereum) throw new WalletUnavailableError();
  const client = createWalletClient({ chain: sepolia, transport: custom(window.ethereum) });
  const [address] = await client.requestAddresses();
  if (!address) throw new WalletUnavailableError();
  await ensureSepolia(client);
  return { client, address };
}

export function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function sepoliaTxUrl(txHash: string): string {
  return `https://sepolia.etherscan.io/tx/${txHash}`;
}
