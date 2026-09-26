// Browser-only wallet helper for the Donate and Checkout islands. It uses the HMI's
// shared Wagmi connection when present and an injected wallet on standalone pages.
import { createWalletClient, custom, type Address, type EIP1193Provider, type WalletClient } from 'viem';
import { sepolia } from 'viem/chains';
import { connect, getAccount, getWalletClient, switchChain } from 'wagmi/actions';
import { currentWalletConfig } from './appkit.client';

const injectedProvider = () => (window as Window & { ethereum?: EIP1193Provider }).ethereum;

export class WalletUnavailableError extends Error {
  constructor(message = 'No wallet found. Install MetaMask or another browser wallet extension.') { super(message); }
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
  if (typeof window === 'undefined') throw new WalletUnavailableError();
  const config = currentWalletConfig();
  if (config) {
    let account = getAccount(config);
    if (!account.address) {
      const injectedConnector = injectedProvider() && config.connectors.find((item) => item.type === 'injected');
      if (!injectedConnector) throw new WalletUnavailableError('Connect a wallet from the top right before checkout.');
      await connect(config, { connector: injectedConnector, chainId: sepolia.id });
      account = getAccount(config);
    }
    if (!account.address) throw new WalletUnavailableError('Connect a wallet from the top right before checkout.');
    if (account.chainId !== sepolia.id) await switchChain(config, { chainId: sepolia.id });
    const client = await getWalletClient(config, { chainId: sepolia.id });
    return { client, address: account.address };
  }
  const provider = injectedProvider();
  if (!provider) throw new WalletUnavailableError();
  const client = createWalletClient({ chain: sepolia, transport: custom(provider) });
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
