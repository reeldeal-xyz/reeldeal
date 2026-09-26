// Sepolia clients for the keeper (issue #17), built lazily from env so `--dry-run` and pure-planning
// paths never need KEEPER_PRIVATE_KEY / SEPOLIA_RPC_URL to be set. Mirrors web/src/lib/world/binder.ts's
// injectable-clients pattern so tests (and the anvil integration test, which points these at a local
// chain instead) never touch a real network.
import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { env } from '@/lib/env';

export type KeeperPublicClient = Pick<
  PublicClient,
  'readContract' | 'simulateContract' | 'waitForTransactionReceipt' | 'getLogs' | 'getTransactionReceipt'
>;
export type KeeperWalletClient = Pick<WalletClient, 'writeContract'>;

export interface KeeperChainClients {
  publicClient: KeeperPublicClient;
  walletClient: KeeperWalletClient;
  account: Account;
  chain: Chain;
}

let cachedPublicClient: KeeperPublicClient | null = null;
let cached: KeeperChainClients | null = null;

/** Lazily builds a read-only Sepolia client from env (only needs SEPOLIA_RPC_URL) -- safe to call in
 *  `--dry-run` paths that never send a transaction. */
export function getKeeperPublicClient(): KeeperPublicClient {
  if (cachedPublicClient) return cachedPublicClient;
  cachedPublicClient = createPublicClient({ chain: sepolia, transport: http(env.sepoliaRpc()) });
  return cachedPublicClient;
}

/** Lazily builds the real Sepolia clients from env, using KEEPER_PRIVATE_KEY. Cached per server instance.
 *  Only call this on a path that will actually broadcast -- it's the thing `--dry-run` must avoid needing. */
export function getKeeperChainClients(): KeeperChainClients {
  if (cached) return cached;
  const account = privateKeyToAccount(env.keeperPrivateKey() as Hex);
  const transport = http(env.sepoliaRpc());
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const walletClient = createWalletClient({ account, chain: sepolia, transport });
  cached = { publicClient, walletClient, account, chain: sepolia };
  return cached;
}

/** Test-only: drop the cached clients so a test run rebuilds them from a (possibly patched) env. */
export function _resetKeeperChainClientsForTests(): void {
  cached = null;
  cachedPublicClient = null;
}

/** A local signing-only account for the fallback path (pipeline/co-op/science keys). Never touches the
 *  network -- just produces `account.signTypedData(...)`. */
export function fallbackSignerAccount(privateKey: Hex): PrivateKeyAccount {
  return privateKeyToAccount(privateKey);
}
