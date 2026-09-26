// POST /api/liff/claim -- thin Next.js adapter (issue #15). Logic lives in lib/liff/claim.ts so it can be
// unit tested with mocked viem clients. Requires a valid LIFF session: `claimHeld` pays the plot's on-chain
// slot owner, never the caller, so this is safe to expose to any logged-in farmer without checking they
// specifically own the plot -- the session gate just keeps the endpoint off the open internet, since every
// call spends the keeper relayer's own Sepolia gas.
import { NextResponse, type NextRequest } from 'next/server';
import { handleClaim } from '@/lib/liff/claim';
import { readSessionFromRequest } from '@/lib/session';

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const { status, body } = await handleClaim(raw);
  return NextResponse.json(body, { status });
}
