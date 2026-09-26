import { env } from '@/lib/env';
import { fetchMultiBaasEvents } from '@/lib/multibaas';

// Donor-ledger dashboard read side (issue #23): queries events MultiBaas has already indexed for the
// linked contracts (see scripts/multibaas-setup.ts) instead of maintaining our own event store.
// Falls back gracefully — `{ configured: false }` — before MULTIBAAS_URL/MULTIBAAS_API_KEY are set
// (they're only set once the MultiBaas account exists and #16 has deployed addresses to link).
export async function GET(req: Request) {
  const baseUrl = env.multibaasUrl();
  const apiKey = env.multibaasApiKey();
  if (!baseUrl || !apiKey) {
    return Response.json({ configured: false, events: [] });
  }

  const { searchParams } = new URL(req.url);
  const limitParam = Number(searchParams.get('limit') ?? '25');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 25;
  const contractLabel = searchParams.get('contract') ?? undefined;
  const eventSignature = searchParams.get('event') ?? undefined;

  try {
    const events = await fetchMultiBaasEvents({ baseUrl, apiKey, contractLabel, eventSignature, limit });
    return Response.json({ configured: true, events });
  } catch (err) {
    console.error('[multibaas] events query failed', err);
    return Response.json({ configured: true, events: [], error: 'query failed' }, { status: 502 });
  }
}
