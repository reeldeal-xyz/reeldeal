// LIFF login → session (issue #13). Client posts liff.getIDToken(); we verify it with LINE and
// hand back a signed httpOnly cookie. No DB — the cookie is the whole session record.
import { NextResponse, type NextRequest } from 'next/server';
import { LineIdTokenError, verifyLineIdToken } from '@/lib/line-auth';
import { createSessionCookie, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '@/lib/session';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const idToken = typeof body === 'object' && body !== null && 'idToken' in body ? (body as { idToken?: unknown }).idToken : undefined;
  if (typeof idToken !== 'string' || idToken.length === 0) {
    return NextResponse.json({ error: 'missing idToken' }, { status: 400 });
  }

  let claims;
  try {
    claims = await verifyLineIdToken(idToken);
  } catch (err) {
    const status = err instanceof LineIdTokenError && err.status === 400 ? 401 : 502;
    console.error('[liff/session] id token verification failed', err);
    return NextResponse.json({ error: 'id token verification failed' }, { status });
  }

  const user = {
    id: claims.sub,
    displayName: claims.name ?? null,
    pictureUrl: claims.picture ?? null,
  };

  const cookieValue = createSessionCookie({
    userId: claims.sub,
    displayName: claims.name,
    pictureUrl: claims.picture,
    iat: Math.floor(Date.now() / 1000),
  });

  const res = NextResponse.json({ ok: true, user });
  res.cookies.set(SESSION_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
