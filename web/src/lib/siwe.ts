// Sign-In With Ethereum (EIP-4361) for the wallet-login path (Reown AppKit connects the wallet; this proves
// the connecting party actually controls it before minting a session cookie). Hand-rolled rather than
// `@reown/appkit-siwe`: Reown's own docs steer away from that package's `verifySignature` helper ("not
// working with social logins and non-deployed smart accounts") and recommend verifying with viem directly,
// which is what this file does -- `verifyMessage` recovers the signer via ecrecover, no RPC call needed for
// a plain EOA signature (the only wallet kind this repo's farmer flow supports; a smart-contract wallet
// would need ERC-1271, out of scope for this hackathon build).
//
// Never import from './session' here -- session.ts imports *this* module (resolveSessionWallet), so the
// reverse import would be circular.
import { isAddress, verifyMessage, type Address, type Hex } from 'viem';

// --- Wallet <-> session identity -----------------------------------------------------------------------
// A wallet session's `userId` (lib/session.ts's `SessionPayload.userId`) is the wallet itself, prefixed so
// it can never collide with a LINE `sub` claim (LINE's sub claims are opaque non-address strings).

export const WALLET_USER_ID_PREFIX = 'wallet:';

export function walletSessionUserId(address: string): string {
  return `${WALLET_USER_ID_PREFIX}${address.toLowerCase()}`;
}

/** Decodes a wallet session's `userId` back to the address, or null if `userId` isn't a wallet session's
 *  (e.g. it's a LINE `sub`) or the encoded value isn't a valid address. */
export function walletFromSessionUserId(userId: string): Address | null {
  if (!userId.startsWith(WALLET_USER_ID_PREFIX)) return null;
  const addr = userId.slice(WALLET_USER_ID_PREFIX.length);
  return isAddress(addr) ? (addr as Address) : null;
}

// --- Nonce store -----------------------------------------------------------------------------------------
// In-memory only, like lib/liff/wallet-relay.ts's rate limiter and lib/line.ts's push-quota counter --
// resets on deploy/restart, which just means an in-flight sign-in has to restart. Good enough for a
// hackathon single-instance deploy; a real multi-instance deploy would need this in Redis/Postgres instead.

const NONCE_TTL_MS = 5 * 60 * 1000;
const NONCE_BYTES = 16;

const nonces = new Map<string, { expiresAt: number }>();

function randomNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function pruneExpiredNonces(now: number): void {
  for (const [nonce, rec] of nonces) {
    if (rec.expiresAt <= now) nonces.delete(nonce);
  }
}

/** Mints a fresh, single-use nonce (GET /api/wallet-auth/nonce) and remembers it until consumeNonce() or
 *  NONCE_TTL_MS elapses, whichever comes first. */
export function issueNonce(now: () => number = Date.now): string {
  pruneExpiredNonces(now());
  const nonce = randomNonce();
  nonces.set(nonce, { expiresAt: now() + NONCE_TTL_MS });
  return nonce;
}

/** True (and consumes it) the first time a known, unexpired nonce is presented; false for an unknown,
 *  already-used, or expired one. Always deletes on the way out -- single-use regardless of the outcome, so
 *  a replay attempt can never succeed even if it races a legitimate verify. */
export function consumeNonce(nonce: string, now: () => number = Date.now): boolean {
  const rec = nonces.get(nonce);
  if (!rec) return false;
  nonces.delete(nonce);
  return rec.expiresAt > now();
}

/** Test-only: drop all in-memory nonces so a test run starts clean. */
export function _resetSiweNoncesForTests(): void {
  nonces.clear();
}

// --- Message format (EIP-4361) --------------------------------------------------------------------------
// https://eips.ethereum.org/EIPS/eip-4361#message-format -- the client builds this exact template (see
// components/app/wallet-app.tsx) and the wallet signs it as a plain personal_sign message.

export interface SiweMessageFields {
  domain: string;
  address: Address;
  statement?: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
}

/** Parses an EIP-4361 message back into its fields. Returns null if the message doesn't match the standard
 *  template closely enough to trust (missing/garbled required fields, or an invalid address). */
export function parseSiweMessage(message: string): SiweMessageFields | null {
  const lines = message.split('\n');
  const header = lines[0]?.match(/^(.+) wants you to sign in with your Ethereum account:$/);
  const address = lines[1]?.trim();
  if (!header || !address || !isAddress(address)) return null;

  // Lines 2+ : blank, then an optional free-text statement, then a blank line, then the "URI: ..." block.
  // The statement line is optional in EIP-4361, so scan for it rather than assuming a fixed offset.
  let idx = 2;
  let statement: string | undefined;
  if (lines[idx] === '') {
    idx += 1;
    const candidate = lines[idx];
    if (candidate !== undefined && candidate !== '' && !candidate.startsWith('URI:')) {
      statement = candidate;
      idx += 1;
      if (lines[idx] === '') idx += 1;
    }
  }

  const rest = lines.slice(idx).join('\n');
  const uri = rest.match(/^URI: (.+)$/m)?.[1];
  const version = rest.match(/^Version: (.+)$/m)?.[1];
  const chainIdStr = rest.match(/^Chain ID: (.+)$/m)?.[1];
  const nonce = rest.match(/^Nonce: (.+)$/m)?.[1];
  const issuedAt = rest.match(/^Issued At: (.+)$/m)?.[1];
  const expirationTime = rest.match(/^Expiration Time: (.+)$/m)?.[1];

  if (!uri || !version || !chainIdStr || !nonce || !issuedAt) return null;
  const chainId = Number(chainIdStr);
  if (!Number.isFinite(chainId)) return null;

  return {
    domain: header[1]!,
    address: address as Address,
    statement,
    uri,
    version,
    chainId,
    nonce,
    issuedAt,
    expirationTime,
  };
}

/** Builds the exact EIP-4361 message the client should sign (kept here, not just in the client component, so
 *  tests can construct a real message/signature pair with viem's `signMessage` and this file's own parser
 *  round-trip on it). */
export function buildSiweMessage(fields: SiweMessageFields): string {
  const lines = [
    `${fields.domain} wants you to sign in with your Ethereum account:`,
    fields.address,
    '',
  ];
  if (fields.statement) lines.push(fields.statement, '');
  lines.push(
    `URI: ${fields.uri}`,
    `Version: ${fields.version}`,
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
  );
  if (fields.expirationTime) lines.push(`Expiration Time: ${fields.expirationTime}`);
  return lines.join('\n');
}

// --- Verification ----------------------------------------------------------------------------------------

export interface VerifySiweParams {
  message: string;
  signature: Hex;
  /** Expected `domain` field (the request's own Host header -- never client-supplied) -- see
   *  app/api/wallet-auth/verify/route.ts. */
  expectedDomain: string;
  /** Expected `Chain ID` field. Sepolia only for this app (packages/shared's CHAIN_ID). */
  expectedChainId: number;
  now?: () => number;
}

export type VerifySiweResult =
  | { ok: true; address: Address }
  | {
      ok: false;
      error: 'malformed_message' | 'wrong_domain' | 'wrong_chain' | 'expired' | 'invalid_nonce' | 'invalid_signature';
    };

export async function verifySiweMessage(params: VerifySiweParams): Promise<VerifySiweResult> {
  const fields = parseSiweMessage(params.message);
  if (!fields) return { ok: false, error: 'malformed_message' };

  if (fields.domain !== params.expectedDomain) return { ok: false, error: 'wrong_domain' };
  if (fields.chainId !== params.expectedChainId) return { ok: false, error: 'wrong_chain' };

  const now = params.now ?? Date.now;
  if (fields.expirationTime) {
    const expiry = Date.parse(fields.expirationTime);
    if (Number.isNaN(expiry) || expiry <= now()) return { ok: false, error: 'expired' };
  }

  // Verify the signature before touching nonce state: a bad/tampered signature shouldn't burn a nonce the
  // farmer's wallet might still legitimately retry with.
  const validSignature = await verifyMessage({
    address: fields.address,
    message: params.message,
    signature: params.signature,
  }).catch(() => false);
  if (!validSignature) return { ok: false, error: 'invalid_signature' };

  // Single-use, checked last: a replay of a previously-accepted (message, signature) pair -- or an unknown
  // nonce outright -- is rejected here even though the signature itself still checks out.
  if (!consumeNonce(fields.nonce, now)) return { ok: false, error: 'invalid_nonce' };

  return { ok: true, address: fields.address };
}
