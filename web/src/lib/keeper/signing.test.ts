import { describe, expect, mock, test } from 'bun:test';
import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import { TRIGGER_EIP712_TYPES, eip712Domain, idOf } from '@repo/shared';
import { resolveSignedTrigger } from './signing';
import { buildFallbackTrigger } from './trigger-codec';

const POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as Address;
const PIPELINE_KEY = `0x${'11'.repeat(32)}` as Hex;
const COOP_KEY = `0x${'22'.repeat(32)}` as Hex;
const SCIENCE_KEY = `0x${'33'.repeat(32)}` as Hex;
const pipelineAccount = privateKeyToAccount(PIPELINE_KEY);
const coopAccount = privateKeyToAccount(COOP_KEY);

const REF_ID = '2023-scallop-tier2';

function triggersFileFor(signature: Hex) {
  const trigger = buildFallbackTrigger(REF_ID);
  return {
    zone: 'karakuwa-east',
    season: '2023',
    triggers: [
      {
        label: 'scallop:2',
        zone: 'karakuwa-east',
        species: 'scallop',
        peril: 'HEAT26',
        firedOn: '2023-08-11',
        trigger: {
          zoneId: trigger.zoneId,
          speciesId: trigger.speciesId,
          perilId: trigger.perilId,
          tier: trigger.tier,
          seasonLabel: trigger.seasonLabel,
          windowStart: trigger.windowStart.toString(),
          windowEnd: trigger.windowEnd.toString(),
          firedAt: trigger.firedAt.toString(),
          index: trigger.index,
          threshold: trigger.threshold,
          dataHash: trigger.dataHash,
          deadline: trigger.deadline.toString(),
        },
        signatures: [{ signer: pipelineAccount.address, signature }],
      },
    ],
  };
}

function fetchReturning(body: unknown): typeof fetch {
  return mock(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

function fetchFailing(): typeof fetch {
  return mock(async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
}

async function signPipeline(): Promise<Hex> {
  const trigger = buildFallbackTrigger(REF_ID);
  return pipelineAccount.signTypedData({
    domain: eip712Domain(POOL_ADDRESS),
    types: TRIGGER_EIP712_TYPES,
    primaryType: 'Trigger',
    message: trigger,
  });
}

const baseParams = {
  referenceEventId: REF_ID,
  zone: 'karakuwa-east',
  dataSeason: '2023',
  species: 'scallop',
  tier: 2,
  poolAddress: POOL_ADDRESS,
  threshold: 2,
};

describe('resolveSignedTrigger', () => {
  test('uses the feed trigger + top-up co-op signature when the feed supplies one valid signature', async () => {
    const signature = await signPipeline();
    const isRegisteredSigner = async (addr: Address) =>
      addr.toLowerCase() === pipelineAccount.address.toLowerCase() || addr.toLowerCase() === coopAccount.address.toLowerCase();

    const resolved = await resolveSignedTrigger({
      ...baseParams,
      feedUrl: 'http://localhost:8787',
      isRegisteredSigner,
      fallbackKeys: { pipeline: PIPELINE_KEY, coop: COOP_KEY, science: SCIENCE_KEY },
      fetchFn: fetchReturning(triggersFileFor(signature)),
    });

    expect(resolved.source).toBe('feed');
    expect(resolved.signatures).toHaveLength(2);
    const signers = resolved.signatures.map((s) => s.signer.toLowerCase()).sort();
    expect(signers).toEqual([pipelineAccount.address.toLowerCase(), coopAccount.address.toLowerCase()].sort());

    // Every signature actually recovers against the resolved trigger.
    for (const sig of resolved.signatures) {
      const recovered = await recoverTypedDataAddress({
        domain: eip712Domain(POOL_ADDRESS),
        types: TRIGGER_EIP712_TYPES,
        primaryType: 'Trigger',
        message: resolved.trigger,
        signature: sig.signature,
      });
      expect(recovered.toLowerCase()).toBe(sig.signer.toLowerCase());
    }
  });

  test('does not top up when the feed alone already meets the threshold', async () => {
    const signature = await signPipeline();
    const resolved = await resolveSignedTrigger({
      ...baseParams,
      threshold: 1,
      feedUrl: 'http://localhost:8787',
      isRegisteredSigner: async () => true,
      fallbackKeys: { pipeline: PIPELINE_KEY, coop: COOP_KEY },
      fetchFn: fetchReturning(triggersFileFor(signature)),
    });
    expect(resolved.source).toBe('feed');
    expect(resolved.signatures).toHaveLength(1);
  });

  test('falls back to a fully self-signed trigger when the feed is unreachable', async () => {
    const resolved = await resolveSignedTrigger({
      ...baseParams,
      feedUrl: 'http://localhost:8787',
      isRegisteredSigner: async () => true,
      fallbackKeys: { pipeline: PIPELINE_KEY, coop: COOP_KEY },
      fetchFn: fetchFailing(),
      now: () => Date.parse('2026-01-01T00:00:00Z'),
    });
    expect(resolved.source).toBe('fallback');
    expect(resolved.signatures).toHaveLength(2);
    const signers = resolved.signatures.map((s) => s.signer.toLowerCase()).sort();
    expect(signers).toEqual([pipelineAccount.address.toLowerCase(), coopAccount.address.toLowerCase()].sort());
  });

  test('throws if fewer fallback keys are configured than the threshold requires', async () => {
    await expect(
      resolveSignedTrigger({
        ...baseParams,
        feedUrl: 'http://localhost:8787',
        isRegisteredSigner: async () => true,
        fallbackKeys: { pipeline: PIPELINE_KEY },
        fetchFn: fetchFailing(),
      }),
    ).rejects.toThrow(/only produced 1\/2/);
  });

  test('throws when the feed has one signature but no fallback key is available to top it up to threshold', async () => {
    const signature = await signPipeline();
    await expect(
      resolveSignedTrigger({
        ...baseParams,
        feedUrl: 'http://localhost:8787',
        isRegisteredSigner: async () => true,
        fallbackKeys: { pipeline: PIPELINE_KEY }, // pipeline already used by the feed sig -- no distinct key left
        fetchFn: fetchReturning(triggersFileFor(signature)),
      }),
    ).rejects.toThrow(/only produced 1\/2/);
  });
});
