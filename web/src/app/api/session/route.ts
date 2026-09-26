// GET /api/session -- lightweight "who am I" check shared by both entry points (/app's wallet-or-LINE
// chooser uses it to skip straight to the farmer UI on a return visit; /liff doesn't need it since LIFF
// itself is the source of truth there). Never leaks anything session-derivation doesn't already expose.
//
// DELETE /api/session -- signs the farmer out of either session kind by clearing the cookie. Wagmi's own
// `disconnect()` (called client-side alongside this) is what actually drops the wallet connection --
// this only ends the server-side session.
import { NextResponse, type NextRequest } from 'next/server';
import { readSessionFromRequest, resolveSessionWallet, sessionKind, SESSION_COOKIE_NAME } from '@/lib/session';

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const wallet = await resolveSessionWallet(session);
  return NextResponse.json({
    ok: true,
    kind: sessionKind(session),
    wallet,
    displayName: session.displayName ?? null,
    pictureUrl: session.pictureUrl ?? null,
  });
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
