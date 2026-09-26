// Marks a slot request issued/revoked after the holder screen confirms the on-chain register/unregister call
// (issue #19). TODO(#15): once the LIFF request API exists, this is the one route that needs to point at it.
import { slotRequestStore, type SlotRequestStatus } from '@/lib/slot-request-store';

const STATUSES: SlotRequestStatus[] = ['pending', 'issued', 'revoked'];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body.status || !STATUSES.includes(body.status as SlotRequestStatus)) {
    return Response.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 });
  }

  const updated = await slotRequestStore.updateStatus(id, body.status as SlotRequestStatus);
  if (!updated) return Response.json({ error: 'request not found' }, { status: 404 });

  return Response.json({ request: updated });
}
