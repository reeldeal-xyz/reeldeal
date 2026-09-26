// Signed, httpOnly session cookie for the LIFF app (issue #13). No DB: the cookie itself is the
// session record. `userId` is the LINE `sub` claim from a server-verified ID token (lib/line-auth.ts).
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { env } from './env';

export const SESSION_COOKIE_NAME = 'umi_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  userId: string; // LINE `sub`
  displayName?: string;
  pictureUrl?: string;
  iat: number; // unix seconds, set at issuance
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
