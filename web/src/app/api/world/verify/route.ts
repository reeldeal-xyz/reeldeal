// POST /api/world/verify -- thin Next.js adapter. All logic lives in lib/world/verify-handler.ts
// so it can be unit tested without a real Request/Response or network/chain access.
import { bindWalletToLineUser } from '@/lib/payout-directory';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/session';
import { handleWorldVerify } from '@/lib/world/verify-handler';

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const { status, body } = await handleWorldVerify(raw);
  // Link wallet <-> LINE here, server-side: the LIFF page often reloads on the way back from World App and
  // drops this response, so a follow-up client call to /api/liff/world-bind can't be relied on.
  const cookie = (req.headers.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  const session = verifySessionCookie(cookie?.slice(SESSION_COOKIE_NAME.length + 1));
  const wallet = (raw as { wallet?: unknown } | null)?.wallet;
  if (status === 200 && session && typeof wallet === 'string') bindWalletToLineUser(wallet, session.userId);
  return Response.json(body, { status });
}
