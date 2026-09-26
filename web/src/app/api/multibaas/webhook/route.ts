import { env } from '@/lib/env';
import { pushHeld, pushPaid } from '@/lib/line';
import {
  MULTIBAAS_SIGNATURE_HEADER,
  MULTIBAAS_TIMESTAMP_HEADER,
  eventInput,
  isEventEmitted,
  verifyMultiBaasSignature,
  type MultiBaasEventInformation,
  type MultiBaasWebhookItem,
} from '@/lib/multibaas';
import { payoutDirectory } from '@/lib/payout-directory';

// Curvegrid MultiBaas webhook receiver (issue #23).
// Verifies the HMAC-SHA256 signature per https://docs.curvegrid.com/multibaas/webhooks/, then routes
// `event.emitted` payloads for ReliefPool's Paid/Held to the LINE push helper (issue #14, stubbed in
// web/src/lib/line.ts pending that branch) and logs Donated/Attested for the donor dashboard, which
// otherwise reads directly from MultiBaas's indexed events via GET /api/multibaas/events.
export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get(MULTIBAAS_SIGNATURE_HEADER) ?? '';
  const timestamp = req.headers.get(MULTIBAAS_TIMESTAMP_HEADER) ?? '';

  if (!verifyMultiBaasSignature(body, timestamp, signature, env.multibaasWebhookSecret())) {
    return Response.json({ error: 'bad signature' }, { status: 401 });
  }

  let items: MultiBaasWebhookItem[];
  try {
    const parsed: unknown = JSON.parse(body);
    items = Array.isArray(parsed) ? (parsed as MultiBaasWebhookItem[]) : [parsed as MultiBaasWebhookItem];
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }

  let processed = 0;
  for (const item of items) {
    if (!isEventEmitted(item)) continue;
    const { event } = item.data;
    switch (event.name) {
      case 'Paid':
        await handlePaid(event);
        break;
      case 'Held':
        await handleHeld(event);
        break;
      case 'Donated':
        handleDonated(event);
        break;
      case 'Attested':
        handleAttested(event);
        break;
      default:
        continue;
    }
    processed++;
  }

  return Response.json({ ok: true, processed });
}

// ---------------------------------------------------------------------
// Event handlers — exported for unit testing.
// ---------------------------------------------------------------------

// Hold reasons are bytes32-packed ASCII on-chain (ReliefPool.REASON_*); eventInput gives the decoded label.
const HELD_REASON_TEXT: Record<string, { reasonJa: string; reasonEn: string }> = {
  UNVERIFIED: { reasonJa: '本人確認をすると受け取れます', reasonEn: 'Verify your identity to receive the payout.' },
  NO_FARMER: { reasonJa: 'この区画の今季の担い手が未登録です', reasonEn: "No farmer is registered for this plot's season slot." },
  PLOT_EXPIRED: { reasonJa: '今季の区画登録の期限が切れています', reasonEn: 'The season slot for this plot has expired.' },
  CAP: { reasonJa: '今回の上限口数に達しました', reasonEn: 'You have reached the unit cap for this event.' },
  ZONE_MISMATCH: { reasonJa: '区画の海域が一致しません', reasonEn: "The plot's zone does not match this event." },
  default: { reasonJa: '確認中です。組合にお問い合わせください', reasonEn: 'Under review. Please contact the co-op.' },
};

// Plot labels don't carry the zone today; all demo plots sit in the Karakuwa branch.
function zoneLabelFor(_plotLabel: string): string {
  return '唐桑東';
}

function txHashOf(event: MultiBaasEventInformation): `0x${string}` | undefined {
  const h = (event as { transaction?: { txHash?: string } }).transaction?.txHash;
  return h?.startsWith('0x') ? (h as `0x${string}`) : undefined;
}

/** event Paid(bytes32 indexed eventId, string plotLabel, address indexed farmer, bytes32 indexed nullifier, uint256 amount) */
export async function handlePaid(event: MultiBaasEventInformation): Promise<void> {
  const eventId = eventInput(event, 'eventId') ?? '';
  const plotLabel = eventInput(event, 'plotLabel') ?? '';
  const farmer = eventInput(event, 'farmer');
  const amount = eventInput(event, 'amount') ?? '0';

  if (!farmer) {
    console.warn('[multibaas] Paid event missing farmer input', eventId, plotLabel);
    return;
  }

  const lineUserId = await payoutDirectory.lineUserIdForWallet(farmer);
  if (!lineUserId) {
    console.warn('[multibaas] Paid event: no LINE mapping for wallet', farmer, '(plot', plotLabel, ')');
    return;
  }

  await pushPaid(lineUserId, { plotCode: plotLabel, zoneLabel: zoneLabelFor(plotLabel), amountWei: BigInt(amount), txHash: txHashOf(event) });
}

/** event Held(bytes32 indexed eventId, string plotLabel, bytes32 reason) — no farmer field, so this looks
 *  up the LINE userId by plotLabel (see web/src/lib/payout-directory.ts). */
export async function handleHeld(event: MultiBaasEventInformation): Promise<void> {
  const eventId = eventInput(event, 'eventId') ?? '';
  const plotLabel = eventInput(event, 'plotLabel') ?? '';
  const reason = eventInput(event, 'reason') ?? '';

  const lineUserId = await payoutDirectory.lineUserIdForPlot(plotLabel);
  if (!lineUserId) {
    console.warn('[multibaas] Held event: no LINE mapping for plot', plotLabel, '(reason', reason, ')');
    return;
  }

  const text = HELD_REASON_TEXT[reason] ?? HELD_REASON_TEXT.default!;
  await pushHeld(lineUserId, { plotCode: plotLabel, zoneLabel: zoneLabelFor(plotLabel), ...text });
}

/** event Donated(address indexed from, uint256 amount, string memo) — dashboard reads via GET
 *  /api/multibaas/events, so this is just a real-time audit-log line for now. */
export function handleDonated(event: MultiBaasEventInformation): void {
  console.log('[multibaas] Donated', eventInput(event, 'from'), eventInput(event, 'amount'), eventInput(event, 'memo'));
}

/** event Attested(bytes32 indexed eventId, Trigger t, uint32 eligibleUnits, uint256 perUnit, address[] signers) */
export function handleAttested(event: MultiBaasEventInformation): void {
  console.log('[multibaas] Attested', eventInput(event, 'eventId'));
}
