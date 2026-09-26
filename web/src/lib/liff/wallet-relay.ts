// Framework-agnostic core of POST /api/liff/wallet/relay-transfer (LIFF wallet management): a gasless JPYC
// send. The farmer's in-app wallet signs an EIP-3009 `transferWithAuthorization` off-chain
// (lib/liff/wallet-authorization.ts); this relays it on-chain with the keeper's own relayer key, exactly like
// lib/liff/claim.ts relays `claimHeld` -- the farmer's zero-ETH wallet never needs gas.
//
// Trust chain (why this is safe to expose to any logged-in farmer): the route is session-gated, then the
// signer recovered from the signature must equal *that session's own pinned wallet*
// (lib/payout-directory.ts's `walletForLineUser`) -- never an arbitrary "from" the client claims in the body
// -- so one farmer's session can never move another farmer's JPYC, and a device whose local key isn't the
// pinned wallet can't produce a signature that passes this check (see lib/wallet.ts's read-only-mode note).
//
// Kept separate from route.ts (like lib/liff/claim.ts) so it can be unit tested with mocked viem clients.
import {
  BaseError,
  ContractFunctionRevertedError,
  isAddress,
  isHex,
  parseSignature,
  recoverTypedDataAddress,
  zeroAddress,
  type Account,
  type Address,
  type Hex,
} from 'viem';
import { CHAIN_ID, JPYC, JPYC_EIP712_DOMAIN, JpycAbi } from '@repo/shared';
import { walletForLineUser as defaultWalletForLineUser } from '@/lib/payout-directory';
import { walletFromSessionUserId } from '@/lib/siwe';
import { getKeeperChainClients, type KeeperPublicClient, type KeeperWalletClient } from '@/lib/keeper/chain-clients';
import { TRANSFER_WITH_AUTHORIZATION_TYPES } from './wallet-authorization';

/** Resolves the wallet for whatever `lineUserId` (really: `session.userId`, see route.ts) the caller passes
 *  in -- a wallet session's id (`wallet:<address>`, lib/siwe.ts) decodes straight to the address it *is*,
 *  no lookup needed; anything else is treated as a real LINE `sub` and goes through the usual pinned-wallet
 *  directory (lib/payout-directory.ts). This is what makes the gasless relay work for both session kinds
 *  without either one needing to know about the other. */
export function defaultGetPinnedWallet(userId: string): Promise<string | null> | string | null {
  const walletSession = walletFromSessionUserId(userId);
  if (walletSession) return walletSession;
  return defaultWalletForLineUser(userId);
}

/** Server-side ceiling on the client-signed window (lib/liff/wallet-authorization.ts signs for 10 minutes) --
 *  a little slack for relay latency/clock skew, but nowhere near "indefinitely replayable". */
const MAX_VALID_WINDOW_SECONDS = 15 * 60;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_WINDOW = 5;

// --- Rate limiting (per LINE user) --------------------------------------------------------------
// In-memory only, like lib/line.ts's push-quota counter -- resets on deploy/restart. Good enough to stop a
// buggy client (or a farmer mashing "send") from hammering the keeper's relayer key during the demo.

export interface RateLimiter {
  /** Returns true if this call is allowed (and records it), false if the caller is over quota. */
  consume(key: string): boolean;
}

class InMemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly windowMs: number,
    private readonly max: number,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  reset(): void {
    this.hits.clear();
  }
}

const defaultRateLimiter = new InMemoryRateLimiter(RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_PER_WINDOW);

/** Test-only: drop the in-memory rate-limit state so a test run starts clean. */
export function _resetWalletRelayRateLimiterForTests(): void {
  defaultRateLimiter.reset();
}

// --- Request parsing -----------------------------------------------------------------------------
// bigints don't survive JSON, so value/validAfter/validBefore arrive as decimal strings.

export interface RelayTransferRequestBody {
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
  signature: Hex;
}

function parseBigintString(v: unknown): bigint | null {
  if (typeof v !== 'string' || !/^[0-9]+$/.test(v)) return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

function parseBody(raw: unknown): RelayTransferRequestBody | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const b = raw as Record<string, unknown>;

  const to = b.to;
  if (typeof to !== 'string' || !isAddress(to)) return null;

  const value = parseBigintString(b.value);
  const validAfter = parseBigintString(b.validAfter);
  const validBefore = parseBigintString(b.validBefore);
  if (value === null || validAfter === null || validBefore === null) return null;

  const nonce = b.nonce;
  if (typeof nonce !== 'string' || !isHex(nonce) || nonce.length !== 66) return null;

  const signature = b.signature;
  if (typeof signature !== 'string' || !isHex(signature) || signature.length !== 132) return null;

  return { to: to as Address, value, validAfter, validBefore, nonce: nonce as Hex, signature: signature as Hex };
}

// --- Handler ---------------------------------------------------------------------------------------

/** User-facing message per contract revert (EIP3009's own require-string messages, surfaced as `.reason` on
 *  ContractFunctionRevertedError). Only 'EIP3009: invalid signature' was confirmed live against the deployed
 *  Sepolia proxy (see JPYC_EIP712_DOMAIN in packages/shared/src/addresses.ts); the others are the standard
 *  Centre EIP-3009 reference strings this contract's surface matches -- if JPYC's wording differs, an
 *  unmatched reason still falls back to the generic message below, so this is UX-only, never load-bearing. */
const CONTRACT_ERROR_MESSAGES: Record<string, string> = {
  'EIP3009: invalid signature': 'Could not verify your wallet signature. Please try again.',
  'EIP3009: authorization is used or canceled': 'This transfer was already submitted.',
  'EIP3009: authorization is not yet valid': 'This transfer request is not valid yet.',
  'EIP3009: authorization is expired': 'This transfer request has expired. Please try again.',
};

export interface HandleRelayTransferDeps {
  getChainClients: () => {
    publicClient: Pick<KeeperPublicClient, 'readContract' | 'simulateContract' | 'waitForTransactionReceipt'>;
    walletClient: KeeperWalletClient;
    account: Account;
  };
  jpycAddress: Address;
  /** The session's wallet -- LINE's pinned wallet (lib/payout-directory.ts), or decoded straight out of a
   *  wallet session's own id (see `defaultGetPinnedWallet` below) -- or null if none is pinned yet. */
  getPinnedWallet: (lineUserId: string) => Promise<string | null> | string | null;
  /** Unix seconds. Injectable so tests can control the validAfter/validBefore window without real timers. */
  now: () => number;
  rateLimiter: RateLimiter;
}

export function defaultRelayTransferDeps(): HandleRelayTransferDeps {
  return {
    getChainClients: getKeeperChainClients,
    jpycAddress: JPYC as Address,
    getPinnedWallet: defaultGetPinnedWallet,
    now: () => Math.floor(Date.now() / 1000),
    rateLimiter: defaultRateLimiter,
  };
}

export interface RelayTransferResponse {
  status: number;
  body: Record<string, unknown>;
}

export async function handleRelayTransfer(
  raw: unknown,
  lineUserId: string,
  deps: HandleRelayTransferDeps = defaultRelayTransferDeps(),
): Promise<RelayTransferResponse> {
  const parsed = parseBody(raw);
  if (!parsed) {
    return { status: 400, body: { error: 'invalid_request' } };
  }

  if (!deps.rateLimiter.consume(lineUserId)) {
    return {
      status: 429,
      body: { error: 'rate_limited', message: 'Too many transfer attempts. Please wait a moment and try again.' },
    };
  }

  const pinned = await deps.getPinnedWallet(lineUserId);
  if (!pinned) {
    return {
      status: 409,
      body: { error: 'no_pinned_wallet', message: 'No wallet is linked to your LINE account yet.' },
    };
  }
  const pinnedAddress = pinned as Address;

  if (parsed.to === zeroAddress) {
    return { status: 400, body: { error: 'invalid_recipient', message: 'Enter a valid recipient address.' } };
  }
  if (parsed.to.toLowerCase() === pinnedAddress.toLowerCase()) {
    return { status: 400, body: { error: 'self_transfer', message: 'You cannot send JPYC to your own wallet.' } };
  }
  if (parsed.value <= 0n) {
    return { status: 400, body: { error: 'invalid_amount', message: 'Enter an amount greater than zero.' } };
  }

  const nowSeconds = BigInt(deps.now());
  if (parsed.validAfter > nowSeconds) {
    return { status: 400, body: { error: 'not_yet_valid', message: 'This transfer request is not valid yet.' } };
  }
  if (parsed.validBefore <= nowSeconds) {
    return { status: 400, body: { error: 'expired', message: 'This transfer request has expired. Please try again.' } };
  }
  if (parsed.validBefore - nowSeconds > BigInt(MAX_VALID_WINDOW_SECONDS)) {
    return { status: 400, body: { error: 'window_too_long', message: 'This transfer request window is too long.' } };
  }

  const domain = { ...JPYC_EIP712_DOMAIN, chainId: CHAIN_ID, verifyingContract: deps.jpycAddress };
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({
      domain,
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: {
        from: pinnedAddress,
        to: parsed.to,
        value: parsed.value,
        validAfter: parsed.validAfter,
        validBefore: parsed.validBefore,
        nonce: parsed.nonce,
      },
      signature: parsed.signature,
    });
  } catch {
    return { status: 400, body: { error: 'invalid_signature', message: 'Could not verify your wallet signature.' } };
  }

  // The core safety check: the signature must have come from this session's own pinned wallet, never an
  // arbitrary address the request body claims. This is what makes it safe to relay on the farmer's behalf.
  if (signer.toLowerCase() !== pinnedAddress.toLowerCase()) {
    return {
      status: 403,
      body: { error: 'signer_mismatch', message: 'This device cannot sign for the linked wallet.' },
    };
  }

  const { publicClient, walletClient, account } = deps.getChainClients();

  const balance = (await publicClient.readContract({
    address: deps.jpycAddress,
    abi: JpycAbi,
    functionName: 'balanceOf',
    args: [pinnedAddress],
  })) as bigint;
  if (parsed.value > balance) {
    return { status: 400, body: { error: 'insufficient_balance', message: 'Amount exceeds your JPYC balance.' } };
  }

  const parsedSig = parseSignature(parsed.signature);
  if (typeof parsedSig.v === 'undefined') {
    return { status: 400, body: { error: 'invalid_signature', message: 'Could not verify your wallet signature.' } };
  }

  try {
    const { request } = await publicClient.simulateContract({
      address: deps.jpycAddress,
      abi: JpycAbi,
      functionName: 'transferWithAuthorization',
      args: [
        pinnedAddress,
        parsed.to,
        parsed.value,
        parsed.validAfter,
        parsed.validBefore,
        parsed.nonce,
        Number(parsedSig.v),
        parsedSig.r,
        parsedSig.s,
      ],
      account,
    });
    const txHash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return { status: 200, body: { ok: true, txHash } };
  } catch (err) {
    if (err instanceof BaseError) {
      const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (revert instanceof ContractFunctionRevertedError) {
        // JPYC's EIP3009/ERC20 reverts are plain `require(cond, "...")` strings (Error(string)), not custom
        // Solidity errors -- viem decodes those into `.reason`, not `.data.errorName` (see
        // ContractFunctionRevertedError in viem/errors/contract.ts).
        const reason = revert.reason;
        const message = (reason && CONTRACT_ERROR_MESSAGES[reason]) ?? 'Could not send JPYC. Please try again.';
        return { status: 409, body: { error: 'transfer_reverted', message } };
      }
    }
    console.error('[liff/wallet-relay] transferWithAuthorization failed', err);
    return { status: 502, body: { error: 'relay_failed', message: 'Could not send JPYC. Please try again.' } };
  }
}
