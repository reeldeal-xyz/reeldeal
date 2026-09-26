// Replay endpoint (issue #17 + #18 "Map and replay timeline"): runs the keeper for one chosen reference
// event (e.g. "2023-scallop-tier2") and returns the resulting tx hashes. Bound to the map's replay button.
//
// Auth: `Authorization: Bearer <KEEPER_API_TOKEN>`. This mutates chain state (attest + settle spend real
// gas and JPYC), so it's never public.
import { env } from '@/lib/env';
import { REFERENCE_EVENTS } from '@/lib/keeper/reference-events';
import { runKeeper } from '@/lib/keeper/run';

function isAuthorized(req: Request): boolean {
  const header = req.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return false;
  return token === env.keeperApiToken();
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const eventId = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).event : undefined;
  if (typeof eventId !== 'string' || eventId.length === 0) {
    return Response.json(
      { error: 'missing_event', knownEvents: REFERENCE_EVENTS.map((r) => r.id) },
      { status: 400 },
    );
  }

  const dryRun = Boolean((body as Record<string, unknown>).dryRun);
  // Skips the Jev attest gate (docs/JEV.md) and proceeds straight to attest -- a live-demo override, so a
  // co_op_review hold never blocks the map's replay button when someone on stage needs it to just work.
  const force = Boolean((body as Record<string, unknown>).force);

  try {
    const result = await runKeeper({ referenceEventId: eventId, dryRun, force });
    return Response.json({
      ok: true,
      eventId: result.eventId,
      triggerSource: result.triggerSource,
      alreadyAttested: result.alreadyAttested,
      dryRun: result.dryRun,
      status: result.status,
      jevGate: result.jevGate,
      attestTxHash: result.attestTxHash,
      settleTxHashes: result.settleTxHashes,
      eligiblePlots: result.eligiblePlots,
      unsettledPlots: result.unsettledPlots,
      // Response.json can't serialize bigint (PlotSettlementOutcome.amount) -- stringify it explicitly.
      plotOutcomes: result.plotOutcomes.map((p) => ({ ...p, amount: p.amount !== undefined ? p.amount.toString() : undefined })),
      pushes: result.pushes,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('unknown reference event')) {
      return Response.json({ error: 'unknown_event', message: err.message, knownEvents: REFERENCE_EVENTS.map((r) => r.id) }, { status: 400 });
    }
    console.error('[keeper/replay] run failed', err);
    return Response.json({ error: 'keeper_failed', message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
