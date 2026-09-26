// Fetches a signed Trigger from the pipeline feed (issue #9, docs/INTERFACE.md) and validates it: parses
// with the shared zod schema, then recovers each signature to a currently-registered ReliefPool signer.
// Returns null (never throws) on any failure -- the caller (web/src/lib/keeper/run.ts) treats that as
// "feed unavailable, fall back to self-signing" and logs which.
import { recoverTypedDataAddress, type Address } from 'viem';
import { TRIGGER_EIP712_TYPES, TriggersFile, eip712Domain, type Trigger } from '@repo/shared';
import { triggerFromJson } from './trigger-codec';

export interface FeedTriggerResult {
  trigger: Trigger;
  /** Only signatures that both parse and recover to a currently-registered signer. */
  signatures: { signer: Address; signature: `0x${string}` }[];
}

export interface FetchSignedTriggerParams {
  feedUrl: string;
  zone: string;
  dataSeason: string;
  species: string;
  tier: number;
  poolAddress: Address;
  /** Checks the recovered address is a live ReliefPool signer (pool.isSigner(addr)). */
  isRegisteredSigner: (address: Address) => Promise<boolean>;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

/** GET /triggers/:zone/:dataSeason, find the `${species}:${tier}` entry, and validate its signatures.
 *  Returns null on any failure: unreachable feed, bad JSON, schema mismatch, no matching entry, or zero
 *  signatures that recover to a registered signer. */
export async function fetchSignedTrigger(params: FetchSignedTriggerParams): Promise<FeedTriggerResult | null> {
  const doFetch = params.fetchFn ?? fetch;
  const url = new URL(`/triggers/${params.zone}/${params.dataSeason}`, params.feedUrl);

  let body: unknown;
  try {
    const res = await doFetch(url.toString());
    if (!res.ok) {
      console.warn(`[keeper/feed] GET ${url} -> HTTP ${res.status}`);
      return null;
    }
    body = await res.json();
  } catch (err) {
    console.warn(`[keeper/feed] GET ${url} failed`, err);
    return null;
  }

  const parsed = TriggersFile.safeParse(body);
  if (!parsed.success) {
    console.warn('[keeper/feed] response failed schema validation', parsed.error.message);
    return null;
  }

  const label = `${params.species}:${params.tier}`;
  const entry = parsed.data.triggers.find((t) => t.label === label);
  if (!entry) {
    console.warn(`[keeper/feed] no entry for "${label}" in ${url}`);
    return null;
  }

  const trigger = triggerFromJson(entry.trigger);
  const domain = eip712Domain(params.poolAddress);

  const seenSigners = new Set<string>();
  const validSignatures: FeedTriggerResult['signatures'] = [];
  for (const sig of entry.signatures) {
    const signature = sig.signature as `0x${string}`;
    let recovered: Address;
    try {
      recovered = await recoverTypedDataAddress({
        domain,
        types: TRIGGER_EIP712_TYPES,
        primaryType: 'Trigger',
        message: trigger,
        signature,
      });
    } catch (err) {
      console.warn('[keeper/feed] signature failed to recover, dropping', sig.signer, err);
      continue;
    }
    if (recovered.toLowerCase() !== sig.signer.toLowerCase()) {
      console.warn('[keeper/feed] recovered address does not match claimed signer, dropping', sig.signer);
      continue;
    }
    if (seenSigners.has(recovered.toLowerCase())) continue; // dedupe, mirrors ReliefPool._verifySignatures
    const registered = await params.isRegisteredSigner(recovered);
    if (!registered) {
      console.warn('[keeper/feed] recovered signer is not a registered ReliefPool signer, dropping', recovered);
      continue;
    }
    seenSigners.add(recovered.toLowerCase());
    validSignatures.push({ signer: recovered, signature });
  }

  if (validSignatures.length === 0) {
    console.warn(`[keeper/feed] no valid signatures for "${label}" in ${url}`);
    return null;
  }

  return { trigger, signatures: validSignatures };
}
