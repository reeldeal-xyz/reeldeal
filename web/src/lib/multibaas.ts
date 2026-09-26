// Curvegrid MultiBaas webhook + event-query helpers (issue #23).
//
// Docs used (no numeric worked example for the HMAC is published, only the algorithm description +
// Go pseudocode for *generating* the signature — see the comment on verifyMultiBaasSignature):
//   - https://docs.curvegrid.com/multibaas/webhooks/        (signature scheme, event.emitted payload shape)
//   - https://docs.curvegrid.com/multibaas/event-indexing/  (what "sync events" means)
//   - https://github.com/curvegrid/multibaas-sdk-typescript/blob/main/docs/EventsApi.md (GET /events params)
//   - https://github.com/curvegrid/multibaas-sdk-typescript/blob/main/docs/Event.md
//   - Confirmed against the live (empty) MultiBaas deployment on 2026-09-26: GET /api/v0/events returns
//     `{status, message, result: []}` — a flat array in `result`, matching the SDK docs.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Headers MultiBaas sends on every webhook POST. Source: docs.curvegrid.com/multibaas/webhooks/ */
export const MULTIBAAS_SIGNATURE_HEADER = 'x-multibaas-signature';
export const MULTIBAAS_TIMESTAMP_HEADER = 'x-multibaas-timestamp';

/**
 * Verifies a MultiBaas webhook request.
 *
 * Per docs.curvegrid.com/multibaas/webhooks/, MultiBaas signs each webhook delivery as:
 *
 *   mac := hmac.New(sha256.New, []byte(secret))
 *   mac.Write(rawRequestBodyBytes)
 *   mac.Write([]byte(strconv.FormatInt(timestamp, 10))) // decimal seconds, as a string
 *   signature := hex.EncodeToString(mac.Sum(nil))
 *
 * and sends `signature` in `X-MultiBaas-Signature` and the same `timestamp` string in
 * `X-MultiBaas-Timestamp`. The docs page only shows Go pseudocode for *generating* the signature (no
 * verification snippet, no numeric worked example) — this recomputes the same HMAC server-side and
 * compares it to the received value in constant time.
 */
export function verifyMultiBaasSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  if (!timestamp || !signature) return false;
  const expectedHex = createHmac('sha256', secret).update(rawBody).update(timestamp).digest('hex');

  const expected = Buffer.from(expectedHex, 'hex');
  let got: Buffer;
  try {
    got = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

// ---------------------------------------------------------------------
// event.emitted payload shape
// (docs.curvegrid.com/multibaas/webhooks/ — verbatim field names from the sample payload)
// ---------------------------------------------------------------------

export interface MultiBaasEventInput {
  name: string;
  value: string;
  hashed: boolean;
  type: string;
}

export interface MultiBaasContractRef {
  address: string;
  addressLabel?: string;
  name: string;
  label: string;
}

export interface MultiBaasEventInformation {
  name: string;
  signature: string;
  inputs: MultiBaasEventInput[];
  rawFields?: string;
  contract: MultiBaasContractRef;
  indexInLog: number;
}

export interface MultiBaasMethodInformation {
  name: string;
  signature: string;
  inputs: Array<{ name: string; value: string; type: string }>;
}

export interface MultiBaasTransactionInformation {
  from: string;
  txData?: string;
  txHash: string;
  txIndexInBlock: number;
  blockHash: string;
  blockNumber: number;
  contract: MultiBaasContractRef;
  method?: MultiBaasMethodInformation;
}

export interface MultiBaasEventEmittedData {
  triggeredAt: string;
  event: MultiBaasEventInformation;
  transaction: MultiBaasTransactionInformation;
}

/** One item of the array MultiBaas POSTs to the webhook endpoint. */
export interface MultiBaasWebhookItem {
  id: string;
  event: 'event.emitted' | 'transaction.included';
  data: MultiBaasEventEmittedData | Record<string, unknown>;
}

/** Reads a named argument's decoded value off an emitted event's `inputs` array. */
export function eventInput(event: MultiBaasEventInformation, name: string): string | undefined {
  return event.inputs.find((input) => input.name === name)?.value;
}

export function isEventEmitted(
  item: MultiBaasWebhookItem,
): item is MultiBaasWebhookItem & { event: 'event.emitted'; data: MultiBaasEventEmittedData } {
  return item.event === 'event.emitted';
}

// ---------------------------------------------------------------------
// Event Query API — GET /api/v0/events (used by the donor-ledger dashboard route)
// https://github.com/curvegrid/multibaas-sdk-typescript/blob/main/docs/EventsApi.md#listevents
// ---------------------------------------------------------------------

export interface FetchMultiBaasEventsOptions {
  /** MULTIBAAS_URL — the deployment base, e.g. https://xxxx.multibaas.com (no /api/v0 suffix). */
  baseUrl: string;
  apiKey: string;
  contractLabel?: string;
  eventSignature?: string;
  limit?: number;
  offset?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

export interface DonorLedgerEvent {
  triggeredAt: string;
  name: string;
  contractLabel: string;
  contractAddress: string;
  txHash: string;
  blockNumber: number;
  inputs: MultiBaasEventInput[];
}

interface MultiBaasEnvelope<T> {
  status: number;
  message: string;
  result: T;
}

/** Queries indexed events from MultiBaas and maps them to the shape the donor-ledger dashboard wants. */
export async function fetchMultiBaasEvents(opts: FetchMultiBaasEventsOptions): Promise<DonorLedgerEvent[]> {
  const doFetch = opts.fetchFn ?? fetch;
  const url = new URL('/api/v0/events', opts.baseUrl);
  if (opts.contractLabel) url.searchParams.set('contractLabel', opts.contractLabel);
  if (opts.eventSignature) url.searchParams.set('eventSignature', opts.eventSignature);
  url.searchParams.set('limit', String(opts.limit ?? 25));
  if (opts.offset) url.searchParams.set('offset', String(opts.offset));

  const res = await doFetch(url.toString(), {
    headers: { Authorization: `Bearer ${opts.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`MultiBaas events query failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as MultiBaasEnvelope<MultiBaasEventEmittedData[]>;
  return body.result.map((e) => ({
    triggeredAt: e.triggeredAt,
    name: e.event.name,
    contractLabel: e.event.contract.label,
    contractAddress: e.event.contract.address,
    txHash: e.transaction.txHash,
    blockNumber: e.transaction.blockNumber,
    inputs: e.event.inputs,
  }));
}
