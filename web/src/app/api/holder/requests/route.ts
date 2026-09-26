// Slot requests for the holder screen (issue #19). TODO(#15): backed by slotRequestStore, an in-memory/JSON
// stand-in for the LIFF app's not-yet-built "request this season's slot" API — see lib/slot-request-store.ts.
import { slotRequestStore, type NewSlotRequest } from '@/lib/slot-request-store';

export async function GET() {
  const requests = await slotRequestStore.list();
  return Response.json({ requests });
}

export async function POST(request: Request) {
  let body: Partial<NewSlotRequest>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body.plotLabel || !body.farmerAddress || !body.seasonLabel) {
    return Response.json({ error: 'plotLabel, farmerAddress and seasonLabel are required' }, { status: 400 });
  }

  const created = await slotRequestStore.create({
    plotLabel: body.plotLabel,
    farmerAddress: body.farmerAddress,
    seasonLabel: body.seasonLabel,
    farmerName: body.farmerName,
  });
  return Response.json({ request: created }, { status: 201 });
}
