// Framework-agnostic core of POST /api/wallet-auth/verify (wallet-only sign-in, no LINE account): verifies a
// Sign-In With Ethereum message + signature (lib/siwe.ts) and, on success, returns the session payload
// route.ts should mint a cookie for. Kept separate from route.ts (matches lib/liff/world-bind.ts's pattern)
// so it's unit-testable without a real Request/Response.
import { isHex, type Hex } from 'viem';
import { CHAIN_ID } from '@repo/shared';
import { verifySiweMessage, walletSessionUserId } from './siwe';
import type { SessionPayload } from './session';

export interface WalletAuthVerifyResult {
  status: number;
  body: Record<string, unknown>;
  /** Present only on success -- route.ts signs this into the session cookie. */
  session?: SessionPayload;
}

const STATUS_BY_ERROR: Record<string, number> = {
  malformed_message: 400,
  wrong_domain: 401,
  wrong_chain: 401,
  expired: 401,
  invalid_nonce: 401,
  invalid_signature: 401,
};

/** `expectedDomain` always comes from the request's own Host header (route.ts), never the request body --
 *  otherwise a client could claim any domain and defeat the whole point of checking it. */
export async function handleWalletAuthVerify(
  raw: unknown,
  expectedDomain: string,
  now: () => number = Date.now,
): Promise<WalletAuthVerifyResult> {
  const b = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const message = b.message;
  const signature = b.signature;

  if (typeof message !== 'string' || message.length === 0) {
    return { status: 400, body: { error: 'invalid_request' } };
  }
  if (typeof signature !== 'string' || !isHex(signature)) {
    return { status: 400, body: { error: 'invalid_request' } };
  }

  const result = await verifySiweMessage({
    message,
    signature: signature as Hex,
    expectedDomain,
    expectedChainId: CHAIN_ID,
    now,
  });

  if (!result.ok) {
    return { status: STATUS_BY_ERROR[result.error] ?? 400, body: { error: result.error } };
  }

  const session: SessionPayload = {
    userId: walletSessionUserId(result.address),
    kind: 'wallet',
    iat: Math.floor(now() / 1000),
  };
  return { status: 200, body: { ok: true, wallet: result.address }, session };
}
