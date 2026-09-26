import { listEscalatedRuns } from '@/lib/keeper-runs';

// "Needs co-op review" card (sponsor-polish task, docs/JEV.md attest gate): lists keeper runs the Jev
// gate held for a human review. Read-only, unauthenticated -- same trust level as the slot-request list
// (web/src/app/api/liff/slot-request), an internal ops screen, not farmer-facing.
export async function GET() {
  const runs = await listEscalatedRuns();
  return Response.json({ runs });
}
