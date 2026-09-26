import { env } from '@/lib/env';
import { runKeeper } from '@/lib/keeper/run';
import { resolveEscalatedRuns } from '@/lib/keeper-runs';
import { REFERENCE_EVENTS } from '@/lib/keeper/reference-events';

// "Approve and attest" button on the co-op screen's "Needs co-op review" card (sponsor-polish task).
// Guarded by a simple shared passcode (COOP_PASSCODE) instead of KEEPER_API_TOKEN -- that token stays
// server-only and is never sent to the browser; this route holds it and does the equivalent of
// `POST /api/keeper/replay` with `{ event, force: true }` on the co-op's behalf (calling `runKeeper`
// directly rather than an internal HTTP round-trip to that route, which would need to guess this
// deployment's own origin/host — see web/src/app/api/keeper/replay/route.ts for the same call with the
// Bearer-token auth path, used by the map's replay button).
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const passcode = typeof record.passcode === 'string' ? record.passcode : '';
  const expected = env.coopPasscode();
  if (!expected || passcode !== expected) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const eventId = record.event;
  if (typeof eventId !== 'string' || eventId.length === 0) {
    return Response.json({ error: 'missing_event', knownEvents: REFERENCE_EVENTS.map((r) => r.id) }, { status: 400 });
  }

  try {
    const result = await runKeeper({ referenceEventId: eventId, force: true });
    if (result.status === 'ok') await resolveEscalatedRuns(result.eventId);
    return Response.json({
      ok: true,
      eventId: result.eventId,
      status: result.status,
      attestTxHash: result.attestTxHash,
      settleTxHashes: result.settleTxHashes,
      plotOutcomes: result.plotOutcomes.map((p) => ({ ...p, amount: p.amount !== undefined ? p.amount.toString() : undefined })),
    });
  } catch (err) {
    console.error('[coop/approve-attest] run failed', err);
    return Response.json({ error: 'keeper_failed', message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
