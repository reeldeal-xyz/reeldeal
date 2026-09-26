// Calls HumanRegistry.bind / HumanRegistry.upgrade as the binder key, on Sepolia.
//
// bind() is for a wallet that has never bound an identity: it accepts a level 1 (schema 11) or
// level 2 (schema 1/9303/9310) proof. upgrade() moves an *already-bound* wallet to a level 2
// schema; it requires the wallet's currently-recorded nullifier (not the new proof's nullifier --
// bind and upgrade normally run under different World ID actions, so they have different
// nullifiers for the same person) as a compare-and-swap guard, so we always read humanOf(wallet)
// first to decide which function to call and what nullifier to pass.
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  pad,
  stringToHex,
  zeroHash,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { HumanRegistryAbi } from '@repo/shared';
import { env } from '@/lib/env';

export interface BinderClients {
  publicClient: Pick<PublicClient, 'simulateContract' | 'waitForTransactionReceipt' | 'readContract'>;
  walletClient: Pick<WalletClient, 'writeContract'>;
  account: Account;
}

let cachedClients: BinderClients | null = null;

/** Lazily builds the real Sepolia clients from env. Cached across calls within one server instance. */
export function getBinderClients(): BinderClients {
  if (cachedClients) return cachedClients;
  const account = privateKeyToAccount(env.binderKey() as Hex);
  const transport = http(env.sepoliaRpc());
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const walletClient = createWalletClient({ account, chain: sepolia, transport });
  cachedClients = { publicClient, walletClient, account };
  return cachedClients;
}

export type BindErrorCode =
  | 'nullifier_already_bound'
  | 'wallet_already_bound'
  | 'wallet_nullifier_mismatch'
  | 'sybil_score_too_low'
  | 'unknown_schema'
  | 'unexpected';

/** User-facing message per contract revert, per the task's ask to surface NullifierAlreadyBound clearly. */
const CONTRACT_ERROR_MESSAGES: Record<string, { code: BindErrorCode; message: string }> = {
  NullifierAlreadyBound: {
    code: 'nullifier_already_bound',
    message: 'This World ID is already linked to a different wallet.',
  },
  WalletAlreadyBound: {
    code: 'wallet_already_bound',
    message: 'This wallet is already verified with World ID.',
  },
  WalletNullifierMismatch: {
    code: 'wallet_nullifier_mismatch',
    message: 'Verify level 1 before upgrading to level 2.',
  },
  SybilScoreTooLow: {
    code: 'sybil_score_too_low',
    message: "This proof's confidence score did not meet the minimum required.",
  },
  UnknownSchema: {
    code: 'unknown_schema',
    message: 'Unsupported World ID credential type.',
  },
};

export class WorldBindError extends Error {
  constructor(
    public readonly code: BindErrorCode,
    public readonly userMessage: string,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = 'WorldBindError';
  }
}

function toWorldBindError(err: unknown): WorldBindError {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      const mapped = name ? CONTRACT_ERROR_MESSAGES[name] : undefined;
      if (mapped) return new WorldBindError(mapped.code, mapped.message, { cause: err });
    }
  }
  return new WorldBindError('unexpected', 'Could not record verification on-chain.', { cause: err });
}

/** Normalizes an IDKit nullifier hex string to a bytes32 value for the contract call. */
export function toNullifierBytes32(nullifierHex: string): Hex {
  const hex = (nullifierHex.startsWith('0x') ? nullifierHex : `0x${nullifierHex}`) as Hex;
  return pad(hex, { size: 32 });
}

/** Opaque, non-PII receipt hash: an audit pointer to this specific verification, not the proof itself. */
export function computeReceiptHash(record: {
  wallet: Address;
  nullifier: Hex;
  schemaId: number;
  action: string;
  verifiedAt: number;
}): Hex {
  return keccak256(stringToHex(JSON.stringify(record)));
}

export interface BindOrUpgradeParams {
  wallet: Address;
  nullifier: Hex;
  schemaId: number;
  sybilScoreBps: number;
  verifiedAt: number;
  receiptHash: Hex;
}

export interface BindOrUpgradeResult {
  txHash: Hex;
  call: 'bind' | 'upgrade';
}

export async function bindOrUpgradeOnChain(
  params: BindOrUpgradeParams,
  clients: BinderClients = getBinderClients(),
): Promise<BindOrUpgradeResult> {
  const address = env.humanRegistryAddress() as Address;
  const { publicClient, walletClient, account } = clients;

  const existing = await publicClient.readContract({
    address,
    abi: HumanRegistryAbi,
    functionName: 'humanOf',
    args: [params.wallet],
  });

  const isBound = existing.nullifier !== zeroHash;
  const call: 'bind' | 'upgrade' = isBound ? 'upgrade' : 'bind';

  try {
    if (call === 'bind') {
      const { request } = await publicClient.simulateContract({
        address,
        abi: HumanRegistryAbi,
        functionName: 'bind',
        args: [params.wallet, params.nullifier, params.schemaId, params.sybilScoreBps, BigInt(params.verifiedAt), params.receiptHash],
        account,
      });
      const txHash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      return { txHash, call };
    }

    // Upgrade must be called with the wallet's *already-bound* nullifier (see module docstring),
    // not the fresh level-2 proof's nullifier.
    const { request } = await publicClient.simulateContract({
      address,
      abi: HumanRegistryAbi,
      functionName: 'upgrade',
      args: [params.wallet, existing.nullifier, params.schemaId, params.receiptHash],
      account,
    });
    const txHash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return { txHash, call };
  } catch (err) {
    throw toWorldBindError(err);
  }
}
