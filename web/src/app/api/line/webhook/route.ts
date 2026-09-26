import { validateSignature, type WebhookRequestBody } from '@line/bot-sdk';
import { env } from '@/lib/env';

// LINE Messaging API webhook. Verifies x-line-signature against the raw body, then acks with 200.
// For now it only logs sources so we can learn user IDs (e.g. for test pushes); replies come in #14.
export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('x-line-signature') ?? '';
  if (!validateSignature(body, env.lineChannelSecret(), signature)) {
    return Response.json({ error: 'bad signature' }, { status: 401 });
  }
  const { events } = JSON.parse(body) as WebhookRequestBody;
  for (const e of events) {
    console.log('[line] event', e.type, 'from', e.source.type, e.source.userId ?? '');
  }
  return Response.json({ ok: true });
}
