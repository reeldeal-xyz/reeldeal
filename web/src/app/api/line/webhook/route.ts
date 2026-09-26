import { validateSignature, type WebhookRequestBody } from '@line/bot-sdk';
import { env } from '@/lib/env';
import { askChoice } from '@/lib/jev';
import { replyMessage } from '@/lib/line';
import { escalationTemplate, intentTemplate, type Intent } from '@/lib/jev-templates';

// LINE Messaging API webhook. Verifies x-line-signature against the raw body, then acks with 200.
// Text messages are routed through Jev (System One decisions, docs/JEV.md) for intent classification and
// answered with a fixed bilingual template above a confidence threshold; everything else just logs its
// source, as before. Jev only ever picks which canned template to send -- it never generates the reply
// text itself and never touches money.
export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('x-line-signature') ?? '';
  if (!validateSignature(body, env.lineChannelSecret(), signature)) {
    return Response.json({ error: 'bad signature' }, { status: 401 });
  }
  const { events } = JSON.parse(body) as WebhookRequestBody;
  for (const e of events) {
    console.log('[line] event', e.type, 'from', e.source.type, e.source.userId ?? '');
    if (e.type === 'message' && e.message.type === 'text') {
      await routeTextMessage(e.replyToken, e.message.text);
    }
  }
  return Response.json({ ok: true });
}

const INTENT_INSTRUCTIONS =
  "Classify the farmer's LINE message into the single best-matching intent for the UMI relief-payout bot.";

const INTENT_CRITERIA: Record<Intent, string> = {
  payout_status: 'Asking whether or when a relief payout has arrived, or its current status.',
  why_held: 'Asking why a payout is being held or delayed.',
  verify_identity: 'Asking how to verify identity or complete World ID verification.',
  request_slot: 'Asking to register or claim a plot slot.',
  trigger_explanation: 'Asking why or how a trigger fired (a weather index crossing a threshold).',
  talk_to_coop: 'Asking to speak with a human or the co-op directly.',
  other: 'Anything else: greetings, unrelated chatter, or unclear messages.',
};

async function routeTextMessage(replyToken: string, text: string): Promise<void> {
  const threshold = env.jevConfidenceThreshold();
  const result = await askChoice<Intent>(
    { message: text, channel: 'line' },
    { instructions: INTENT_INSTRUCTIONS, criteria: INTENT_CRITERIA },
  );

  if (!result) {
    logDecision({ intent: null, confidence: null, probabilities: null, threshold, escalated: true, reason: 'jev_unavailable' });
    await safeReply(replyToken, escalationTemplate());
    return;
  }

  const escalated = result.confidence < threshold;
  logDecision({
    intent: result.answer,
    confidence: result.confidence,
    probabilities: result.probabilities,
    threshold,
    escalated,
    reason: escalated ? 'low_confidence' : 'ok',
  });

  await safeReply(replyToken, escalated ? escalationTemplate() : intentTemplate(result.answer));
}

async function safeReply(replyToken: string, text: string): Promise<void> {
  try {
    await replyMessage(replyToken, [{ type: 'text', text }]);
  } catch (err) {
    console.error(JSON.stringify({ scope: 'jev', kind: 'reply_failed', detail: String(err) }));
  }
}

function logDecision(fields: Record<string, unknown>): void {
  // Structured, single-line JSON (scope:"jev") -- see docs/JEV.md for example logs from real calls.
  console.log(JSON.stringify({ scope: 'jev', kind: 'intent_decision', model: env.jevModel(), ...fields }));
}
