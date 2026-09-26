// Resolves the 2-of-3 (N-of-M) signed Trigger the keeper submits to `attest` (issue #17).
//
// Preferred path: fetch the pipeline-signed Trigger from the feed (issue #9) and top it up with the
// keeper's own local signature(s) to reach the pool's signer threshold -- this is the documented normal
// flow (docs/INTERFACE.md: "the pipeline signs with its key; the app's keeper adds the second signature").
//
// Fallback path, used only when the feed is unreachable, invalid, or doesn't supply enough valid
// signatures even after topping up: the keeper builds the Trigger itself from
// packages/shared/src/rules.ts (REFERENCE_FIRES + RULES) and signs it fully locally. Always logged loudly
// so a Sepolia demo run never confuses a self-signed trigger with a pipeline-signed one.
import { type Address, type Hex } from 'viem';
import { TRIGGER_EIP712_TYPES, eip712Domain, type Trigger } from '@repo/shared';
import { fallbackSignerAccount } from './chain-clients';
import { fetchSignedTrigger } from './feed-client';
import { buildFallbackTrigger } from './trigger-codec';

export interface FallbackKeys {
  pipeline?: Hex;
  coop?: Hex;
  science?: Hex;
}

export interface ResolveSignedTriggerParams {
  referenceEventId: string;
  zone: string;
  dataSeason: string;
  species: string;
  tier: number;
  poolAddress: Address;
  feedUrl: string;
  threshold: number;
  isRegisteredSigner: (address: Address) => Promise<boolean>;
  fallbackKeys: FallbackKeys;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export type TriggerSource = 'feed' | 'fallback';

export interface ResolvedTrigger {
  trigger: Trigger;
  signatures: { signer: Address; signature: Hex }[];
  source: TriggerSource;
}

/** Signs `trigger` with as many of `keys` as needed (skipping any whose address is already in `already`
 *  or already added) to bring the total up to `need`, stopping once it does. */
async function topUpWithFallbackKeys(
  trigger: Trigger,
  poolAddress: Address,
  keys: Hex[],
  already: ReadonlySet<string>,
  need: number,
): Promise<{ signer: Address; signature: Hex }[]> {
  const domain = eip712Domain(poolAddress);
  const added: { signer: Address; signature: Hex }[] = [];
  const seen = new Set(already);
  for (const key of keys) {
    if (seen.size >= need) break;
    const account = fallbackSignerAccount(key);
    const addr = account.address.toLowerCase();
    if (seen.has(addr)) continue;
    const signature = await account.signTypedData({
      domain,
      types: TRIGGER_EIP712_TYPES,
      primaryType: 'Trigger',
      message: trigger,
    });
    added.push({ signer: account.address, signature });
    seen.add(addr);
  }
  return added;
}

export async function resolveSignedTrigger(params: ResolveSignedTriggerParams): Promise<ResolvedTrigger> {
  const keys = [params.fallbackKeys.pipeline, params.fallbackKeys.coop, params.fallbackKeys.science].filter(
    (k): k is Hex => Boolean(k),
  );

  const feedResult = await fetchSignedTrigger({
    feedUrl: params.feedUrl,
    zone: params.zone,
    dataSeason: params.dataSeason,
    species: params.species,
    tier: params.tier,
    poolAddress: params.poolAddress,
    isRegisteredSigner: params.isRegisteredSigner,
    fetchFn: params.fetchFn,
  });

  if (feedResult) {
    const have = new Set(feedResult.signatures.map((s) => s.signer.toLowerCase()));
    if (have.size >= params.threshold) {
      console.log(
        `[keeper] ${params.referenceEventId}: feed supplied ${have.size} valid signature(s), meets threshold ${params.threshold}`,
      );
      return { trigger: feedResult.trigger, signatures: feedResult.signatures.slice(0, params.threshold), source: 'feed' };
    }

    const topUp = await topUpWithFallbackKeys(feedResult.trigger, params.poolAddress, keys, have, params.threshold);
    if (have.size + topUp.length >= params.threshold) {
      console.log(
        `[keeper] ${params.referenceEventId}: feed supplied ${have.size} signature(s); added ${topUp.length} local signature(s) to reach threshold ${params.threshold}`,
      );
      return { trigger: feedResult.trigger, signatures: [...feedResult.signatures, ...topUp], source: 'feed' };
    }

    console.warn(
      `[keeper] ${params.referenceEventId}: feed + local top-up only reached ${have.size + topUp.length}/${params.threshold} signatures; falling back to a fully self-signed trigger`,
    );
  } else {
    console.warn(
      `[keeper] ${params.referenceEventId}: pipeline feed had no valid signed trigger (unreachable, invalid, or not yet live -- see issue #9); building and signing it locally (FALLBACK)`,
    );
  }

  const trigger = buildFallbackTrigger(params.referenceEventId, { now: params.now });
  const signatures = await topUpWithFallbackKeys(trigger, params.poolAddress, keys, new Set(), params.threshold);
  if (signatures.length < params.threshold) {
    throw new Error(
      `[keeper] ${params.referenceEventId}: fallback signing only produced ${signatures.length}/${params.threshold} signature(s) -- configure enough of PIPELINE_SIGNER_PRIVATE_KEY / COOP_SIGNER_PRIVATE_KEY / SCIENCE_KEY_PRIVATE_KEY`,
    );
  }
  console.warn(
    `[keeper] FALLBACK: ${params.referenceEventId} self-signed with ${signatures.length} local signature(s) (${signatures
      .map((s) => s.signer)
      .join(', ')}) -- pipeline feed unavailable`,
  );
  return { trigger, signatures, source: 'fallback' };
}
