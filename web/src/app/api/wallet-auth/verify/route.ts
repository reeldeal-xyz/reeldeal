// POST /api/wallet-auth/verify -- thin Next.js adapter. All logic lives in lib/wallet-auth.ts so it can be
// unit tested without a real Request/Response. On success this mints the same signed httpOnly session
// cookie the LIFF flow uses (lib/session.ts), just with `kind: 'wallet'` -- every route that reads the
// session already works for either kind (see lib/session.ts's `resolveSessionWallet`).
import { NextResponse, type NextRequest } from 'next/server';
import { handleWalletAuthVerify } from '@/lib/wallet-auth';
import { createSessionCookie, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '@/lib/session';

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  // The Host header, never a client-supplied "domain" field -- otherwise a phishing page could ask a wallet
  // to sign a message that *claims* to be this app's domain and replay the result here.
  const expectedDomain = req.nextUrl.host;
  const { status, body, session } = await handleWalletAuthVerify(raw, expectedDomain);

  const res = NextResponse.json(body, { status });
  if (session) {
    res.cookies.set(SESSION_COOKIE_NAME, createSessionCookie(session), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  }
  return res;
}
