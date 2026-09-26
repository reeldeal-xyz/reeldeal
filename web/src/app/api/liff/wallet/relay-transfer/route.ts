// POST /api/liff/wallet/relay-transfer -- thin Next.js adapter (LIFF wallet management). Logic lives in
// lib/liff/wallet-relay.ts so it can be unit tested with mocked viem clients. Session-gated: `lineUserId`
// always comes from the caller's own cookie, never the request body -- see handleRelayTransfer's doc comment
// for why that's what makes this safe to relay on the farmer's behalf.
import { NextResponse, type NextRequest } from 'next/server';
import { handleRelayTransfer } from '@/lib/liff/wallet-relay';
import { readSessionFromRequest } from '@/lib/session';

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const { status, body } = await handleRelayTransfer(raw, session.userId);
  return NextResponse.json(body, { status });
}
