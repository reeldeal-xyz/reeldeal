// Protected test route for issue #14: sends a real Paid or Held push to the signed-in farmer's own
// LINE account, so the flow can be checked on a real phone without wiring up a full trigger event.
// Protected by the LIFF session cookie from #13 — you must have logged in via /liff first.
import { NextResponse, type NextRequest } from 'next/server';
import { readSessionFromRequest } from '@/lib/session';
import { pushHeld, pushPaid } from '@/lib/line';

const SAMPLE = { plotCode: 'p1213-017', zoneLabel: '唐桑東' };

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'sign in at /liff first' }, { status: 401 });
  }

  let kind: 'paid' | 'held' = 'paid';
  try {
    const body = (await req.json()) as { kind?: unknown };
    if (body.kind === 'held') kind = 'held';
  } catch {
    // no/invalid body: default to a Paid test message
  }

  try {
    if (kind === 'held') {
      await pushHeld(session.userId, {
        ...SAMPLE,
        reasonJa: '本人確認をすると受け取れます',
        reasonEn: 'Verify your identity to receive the payout.',
      });
    } else {
      await pushPaid(session.userId, { ...SAMPLE, amountWei: 20000n * 10n ** 18n });
    }
  } catch (err) {
    console.error('[line/test-push] push failed', err);
    return NextResponse.json({ error: 'push failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, kind, sentTo: session.userId });
}
