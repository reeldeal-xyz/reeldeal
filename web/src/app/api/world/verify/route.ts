// POST /api/world/verify -- thin Next.js adapter. All logic lives in lib/world/verify-handler.ts
// so it can be unit tested without a real Request/Response or network/chain access.
import { handleWorldVerify } from '@/lib/world/verify-handler';

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const { status, body } = await handleWorldVerify(raw);
  return Response.json(body, { status });
}
