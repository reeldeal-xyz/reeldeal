// "Request this season's slot" (issue #15). Thin Next.js adapter -- logic lives in lib/liff/slot-request.ts
// so it can be unit tested without a real Request/Response or the shared payout-directory/slot-request-store
// singletons (see that file's header comment for why the store and bindWalletToLineUser are
// dependency-injected there).
import { NextResponse, type NextRequest } from 'next/server';
import { handleCreateSlotRequest, handleListMyRequests } from '@/lib/liff/slot-request';
import { readSessionFromRequest } from '@/lib/session';

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { status, body } = await handleListMyRequests(session.userId);
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const { status, body } = await handleCreateSlotRequest(raw, session.userId, session.displayName);
  return NextResponse.json(body, { status });
}
