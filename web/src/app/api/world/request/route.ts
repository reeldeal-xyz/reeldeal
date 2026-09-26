// RP-signed request context for IDKit. Called by WorldVerify before opening the World App flow.
// Never returns WORLD_RP_SIGNING_KEY -- only the signature it produces.
import { buildWorldRequestContext } from '@/lib/world/signing';
import type { WorldLevel } from '@/lib/world/schema';

function parseLevel(body: unknown): WorldLevel | null {
  if (typeof body !== 'object' || body === null) return null;
  const level = (body as Record<string, unknown>).level;
  return level === 'level1' || level === 'level2' ? level : null;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const level = parseLevel(body);
  if (!level) {
    return Response.json({ error: 'invalid_level' }, { status: 400 });
  }

  try {
    const context = buildWorldRequestContext(level);
    return Response.json(context);
  } catch (err) {
    console.error('[world] failed to build request context', err);
    return Response.json({ error: 'world_request_failed' }, { status: 500 });
  }
}
