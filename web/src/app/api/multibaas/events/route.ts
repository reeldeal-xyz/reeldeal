import { getFundActivity } from '@/lib/fund-activity';

// Donor-ledger dashboard read side (issue #23, wired into the /donate "Fund activity" panel by the
// sponsor-polish task): serves MultiBaas's indexed ReliefPool events (Donated/Attested/Paid/Held/Claimed/
// Swept for the `reliefpool` alias) plus computed totals and the pool's live JPYC balance. Falls back to
// direct viem `getLogs` reads when MultiBaas is unconfigured or unreachable -- see lib/fund-activity.ts's
// `getFundActivity` for the full source-selection logic. `source` in the response tells the UI which one
// actually served this request.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limitParam = Number(searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 50; // MultiBaas max page size is 50

  try {
    const result = await getFundActivity({ limit });
    return Response.json(result);
  } catch (err) {
    console.error('[multibaas] fund activity query failed', err);
    return Response.json(
      { configured: false, source: 'unavailable', events: [], totals: null, error: 'query failed' },
      { status: 502 },
    );
  }
}
