import type { Address } from 'viem';
import { env } from '@/lib/env';
import { listEscalatedRuns, resolveEscalatedRuns } from '@/lib/keeper-runs';
import { getKeeperPublicClient } from '@/lib/keeper/chain-clients';
import { listEventStatuses } from '@/lib/keeper/event-status';
import { REFERENCE_EVENTS } from '@/lib/keeper/reference-events';
import { NotAttestedError, runKeeper } from '@/lib/keeper/run';

// Co-op event console: GET lists every reference event with its lifecycle stage and per-plot outcome
// (public chain data, same trust level as /api/coop/escalated-runs). POST runs one stage of the keeper,
// guarded by the co-op passcode (COOP_PASSCODE), like /api/coop/approve-attest:
//   check  -- resolve the signed Trigger and ask the Jev gate; anchors on attest_now, else awaits the co-op
//   accept -- co-op approval: anchor (attest) without the Jev gate
//   settle -- pay or hold every unsettled enrolled plot for an anchored event, with LINE pushes
export const dynamic = 'force-dynamic';

const ACTIONS = ['check', 'accept', 'settle'] as const;
type Action = (typeof ACTIONS)[number];

export async function GET() {
  const poolAddress = env.reliefPoolAddress();
  if (!poolAddress) return Response.json({ error: 'missing_pool' }, { status: 503 });
  try {
    const events = await listEventStatuses({
      publicClient: getKeeperPublicClient(),
      poolAddress: poolAddress as Address,
      fromBlock: env.reliefPoolDeployBlock(),
      escalatedRuns: listEscalatedRuns,
    });
    return Response.json({ pool: poolAddress, events });
  } catch (err) {
    console.error('[coop/events] read failed', err);
    return Response.json({ error: 'chain_read_failed', message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  const expected = env.coopPasscode();
  if (!expected || record.passcode !== expected) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const event = record.event;
  if (typeof event !== 'string' || !REFERENCE_EVENTS.some((r) => r.id === event)) {
    return Response.json({ error: 'unknown_event', knownEvents: REFERENCE_EVENTS.map((r) => r.id) }, { status: 400 });
  }
  const action = record.action as Action;
  if (!ACTIONS.includes(action)) {
    return Response.json({ error: 'unknown_action', actions: ACTIONS }, { status: 400 });
  }

  try {
    const result = await runKeeper({
      referenceEventId: event,
      stage: action === 'settle' ? 'settle' : 'attest',
      force: action === 'accept',
    });
    if (result.status === 'ok') await resolveEscalatedRuns(result.eventId);
    return Response.json({
      ok: true,
      action,
      status: result.status,
      alreadyAttested: result.alreadyAttested,
      triggerSource: result.triggerSource,
      jevGate: result.jevGate,
      attestTxHash: result.attestTxHash,
      settleTxHashes: result.settleTxHashes,
      plotOutcomes: result.plotOutcomes.map((p) => ({ ...p, amount: p.amount !== undefined ? p.amount.toString() : undefined })),
      pushes: result.pushes,
    });
  } catch (err) {
    if (err instanceof NotAttestedError) return Response.json({ error: 'not_anchored', message: err.message }, { status: 409 });
    console.error('[coop/events] keeper stage failed', err);
    return Response.json({ error: 'keeper_failed', message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
