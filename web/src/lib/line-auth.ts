// Server-side LINE Login ID token verification (issue #13).
// https://developers.line.biz/en/docs/line-login/verify-id-token/
import { env } from './env';

const VERIFY_ENDPOINT = 'https://api.line.me/oauth2/v2.1/verify';

export interface LineIdTokenClaims {
  iss: string;
  sub: string; // stable per-user id for this channel; safe to store, not personal data
  aud: string;
  exp: number;
  iat: number;
  auth_time?: number;
  nonce?: string;
  amr?: string[];
  name?: string;
  picture?: string;
  email?: string;
}

export class LineIdTokenError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'LineIdTokenError';
  }
}

/**
 * Verifies a LIFF `liff.getIDToken()` value against LINE's servers and returns the decoded claims.
 * Never trust an ID token that hasn't round-tripped through this call.
 */
export async function verifyLineIdToken(idToken: string): Promise<LineIdTokenClaims> {
  if (!idToken) throw new LineIdTokenError('missing id token');

  const body = new URLSearchParams({
    id_token: idToken,
    client_id: env.lineLoginChannelId(),
  });

  const res = await fetch(VERIFY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LineIdTokenError(`LINE ID token verification failed (${res.status}): ${text}`, res.status);
  }

  return (await res.json()) as LineIdTokenClaims;
}
