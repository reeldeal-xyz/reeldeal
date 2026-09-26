// Links a farmer's in-app wallet to their LINE session once World ID verification succeeds (issue #15), so
// the keeper can push Paid/Held notifications to them (lib/payout-directory.ts). The actual World ID proof
// verification and HumanRegistry bind/upgrade write already happened in POST /api/world/verify (issue #12)
// -- this route only records the wallet<->LINE mapping, and only for the caller's own session userId (never
// a client-supplied one). Called by the client right after WorldVerify's `onComplete` reports success.
//
// Thin Next.js adapter -- logic lives in lib/liff/world-bind.ts so it can be unit tested without a real
// Request/Response (see that file's header comment for why bindWalletToLineUser is dependency-injected there).
import { NextResponse, type NextRequest } from 'next/server';
import { handleWorldBind } from '@/lib/liff/world-bind';
import { readSessionFromRequest } from '@/lib/session';

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const { status, body } = handleWorldBind(raw, session.userId);
  return NextResponse.json(body, { status });
}
