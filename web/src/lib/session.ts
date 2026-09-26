// Signed, httpOnly session cookie for the farmer app (issue #13, extended for wallet-only sign-in). No DB:
// the cookie itself is the session record. Two session kinds share this one cookie shape:
//
//   'line'   -- `userId` is the LINE `sub` claim from a server-verified ID token (lib/line-auth.ts). The
//                farmer's wallet is looked up server-side via lib/payout-directory.ts's pinned-wallet map.
//   'wallet' -- no LINE account at all (Reown AppKit + SIWE, lib/siwe.ts). `userId` is
//                `wallet:<lowercased address>` and *is* the wallet -- there's no separate lookup, the
//                connecting party proved control of that address by signing the SIWE message.
//
// `kind` is optional on the payload (defaults to 'line' via `sessionKind()` below) so old cookies minted
// before this field existed, and every existing call site that builds a payload without it, keep working.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Address } from 'viem';
import type { NextRequest } from 'next/server';
import { env } from './env';
import { walletForLineUser } from './payout-directory';
import { walletFromSessionUserId } from './siwe';

export const SESSION_COOKIE_NAME = 'umi_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type SessionKind = 'line' | 'wallet';

export interface SessionPayload {
  userId: string; // LINE `sub`, or `wallet:<address>` for a wallet session (lib/siwe.ts)
  kind?: SessionKind; // absent === 'line', see header comment
  displayName?: string;
  pictureUrl?: string;
  iat: number; // unix seconds, set at issuance
}

/** Normalizes the optional `kind` field -- absent (old cookies, LINE call sites that never set it) reads as 'line'. */
export function sessionKind(session: Pick<SessionPayload, 'kind'>): SessionKind {
  return session.kind === 'wallet' ? 'wallet' : 'line';
}

/** Derives the wallet this session acts as, the same way for every route that needs one (issue: Reown
 *  wallet login): a LINE session's wallet is whatever's pinned to that LINE user
 *  (lib/payout-directory.ts); a wallet session *is* the wallet, decoded straight from `userId` -- no DB
 *  lookup, no indirection, since the farmer just proved they hold that address's key via SIWE. */
export async function resolveSessionWallet(session: Pick<SessionPayload, 'userId' | 'kind'>): Promise<Address | null> {
  if (sessionKind(session) === 'wallet') {
    return walletFromSessionUserId(session.userId);
  }
  return (await walletForLineUser(session.userId)) as Address | null;
}

function sign(data: string): string {
  return createHmac('sha256', env.sessionSecret()).update(data).digest('base64url');
}

/** Encodes payload + HMAC signature as `<base64url payload>.<base64url signature>`. */
export function createSessionCookie(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${data}.${sign(data)}`;
}

/** Verifies signature and expiry; returns null on any failure (never throws). */
export function verifySessionCookie(cookieValue: string | undefined | null): SessionPayload | null {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf('.');
  if (dot < 0) return null;
  const data = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  if (!data || !signature) return null;

  const expected = sign(data);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof payload.userId !== 'string' || typeof payload.iat !== 'number') return null;
    if (Math.floor(Date.now() / 1000) - payload.iat > SESSION_MAX_AGE_SECONDS) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Reads and verifies the session cookie off an incoming Route Handler request. */
export function readSessionFromRequest(req: NextRequest): SessionPayload | null {
  return verifySessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value);
}
