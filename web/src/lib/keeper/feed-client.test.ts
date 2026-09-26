import { describe, expect, mock, test } from 'bun:test';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import { TRIGGER_EIP712_TYPES, eip712Domain, idOf } from '@repo/shared';
import { fetchSignedTrigger } from './feed-client';

const POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as Address;
const PIPELINE_KEY = `0x${'11'.repeat(32)}` as Hex;
const pipelineAccount = privateKeyToAccount(PIPELINE_KEY);

const TRIGGER_JSON = {
  zoneId: idOf('karakuwa-east'),
  speciesId: idOf('scallop'),
  perilId: idOf('HEAT'),
  tier: 2,
  seasonLabel: '2026',
  windowStart: '1000',
  windowEnd: '2000',
  firedAt: '1500',
  index: 20,
  threshold: 12,
  tempC: 26,
  dataHash: idOf('fixture'),
  deadline: '9999999999',
} as const;

async function signTrigger(): Promise<Hex> {
  return pipelineAccount.signTypedData({
    domain: eip712Domain(POOL_ADDRESS),
    types: TRIGGER_EIP712_TYPES,
    primaryType: 'Trigger',
    message: {
      zoneId: TRIGGER_JSON.zoneId,
      speciesId: TRIGGER_JSON.speciesId,
      perilId: TRIGGER_JSON.perilId,
      tier: TRIGGER_JSON.tier,
      seasonLabel: TRIGGER_JSON.seasonLabel,
      windowStart: BigInt(TRIGGER_JSON.windowStart),
      windowEnd: BigInt(TRIGGER_JSON.windowEnd),
      firedAt: BigInt(TRIGGER_JSON.firedAt),
      index: TRIGGER_JSON.index,
      threshold: TRIGGER_JSON.threshold,
      tempC: TRIGGER_JSON.tempC,
      dataHash: TRIGGER_JSON.dataHash,
      deadline: BigInt(TRIGGER_JSON.deadline),
    },
  });
}

function triggersFileResponse(signature: Hex, signer: Address = pipelineAccount.address) {
  return {
    zone: 'karakuwa-east',
    season: '2023',
    triggers: [
      {
        label: 'scallop:2',
        zone: 'karakuwa-east',
        species: 'scallop',
        peril: 'HEAT',
        firedOn: '2023-08-11',
        trigger: TRIGGER_JSON,
        signatures: [{ signer, signature }],
      },
    ],
  };
}

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return mock(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }).clone()) as unknown as typeof fetch;
}

describe('fetchSignedTrigger', () => {
  test('returns the trigger and validated signature when everything checks out', async () => {
    const signature = await signTrigger();
    const isRegisteredSigner = mock(async () => true);
    const result = await fetchSignedTrigger({
      feedUrl: 'http://localhost:8787',
      zone: 'karakuwa-east',
      dataSeason: '2023',
      species: 'scallop',
      tier: 2,
      poolAddress: POOL_ADDRESS,
      isRegisteredSigner,
      fetchFn: fakeFetch(triggersFileResponse(signature)),
    });

    expect(result).not.toBeNull();
    expect(result!.signatures).toHaveLength(1);
    expect(result!.signatures[0]!.signer.toLowerCase()).toBe(pipelineAccount.address.toLowerCase());
    expect(result!.trigger.tier).toBe(2);
    expect(isRegisteredSigner).toHaveBeenCalledTimes(1);
  });

  test('returns null when the feed is unreachable', async () => {
    const fetchFn = mock(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const result = await fetchSignedTrigger({
      feedUrl: 'http://localhost:8787',
      zone: 'karakuwa-east',
      dataSeason: '2023',
      species: 'scallop',
      tier: 2,
      poolAddress: POOL_ADDRESS,
      isRegisteredSigner: async () => true,
      fetchFn,
    });
    expect(result).toBeNull();
  });

  test('returns null on a non-2xx response', async () => {
    const result = await fetchSignedTrigger({
      feedUrl: 'http://localhost:8787',
      zone: 'karakuwa-east',
      dataSeason: '2023',
      species: 'scallop',
      tier: 2,
      poolAddress: POOL_ADDRESS,
      isRegisteredSigner: async () => true,
      fetchFn: fakeFetch({}, false, 404),
    });
    expect(result).toBeNull();
  });

  test('returns null when the response fails schema validation', async () => {
    const result = await fetchSignedTrigger({
      feedUrl: 'http://localhost:8787',
      zone: 'karakuwa-east',
      dataSeason: '2023',
      species: 'scallop',
      tier: 2,
      poolAddress: POOL_ADDRESS,
      isRegisteredSigner: async () => true,
      fetchFn: fakeFetch({ not: 'a triggers file' }),
    });
    expect(result).toBeNull();
  });

  test('returns null when no entry matches the requested species:tier label', async () => {
    const signature = await signTrigger();
    const body = triggersFileResponse(signature);
    body.triggers[0]!.label = 'hoya:1';
    const result = await fetchSignedTrigger({
      feedUrl: 'http://localhost:8787',
      zone: 'karakuwa-east',
      dataSeason: '2023',
      species: 'scallop',
      tier: 2,
      poolAddress: POOL_ADDRESS,
      isRegisteredSigner: async () => true,
      fetchFn: fakeFetch(body),
    });
    expect(result).toBeNull();
  });

  test('drops a signature that does not recover to its claimed signer', async () => {
    const signature = await signTrigger();
    const result = await fetchSignedTrigger({
      feedUrl: 'http://localhost:8787',
      zone: 'karakuwa-east',
      dataSeason: '2023',
      species: 'scallop',
      tier: 2,
      poolAddress: POOL_ADDRESS,
      isRegisteredSigner: async () => true,
      // claim a different signer than the one that actually produced the signature
      fetchFn: fakeFetch(triggersFileResponse(signature, '0x2222222222222222222222222222222222222222')),
    });
    expect(result).toBeNull();
  });

  test('drops a signature whose recovered signer is not currently registered', async () => {
    const signature = await signTrigger();
    const result = await fetchSignedTrigger({
      feedUrl: 'http://localhost:8787',
      zone: 'karakuwa-east',
      dataSeason: '2023',
      species: 'scallop',
      tier: 2,
      poolAddress: POOL_ADDRESS,
      isRegisteredSigner: async () => false,
      fetchFn: fakeFetch(triggersFileResponse(signature)),
    });
    expect(result).toBeNull();
  });

  test('dedupes two signatures from the same signer', async () => {
    const signature = await signTrigger();
    const body = triggersFileResponse(signature);
    body.triggers[0]!.signatures.push({ signer: pipelineAccount.address, signature });
    const result = await fetchSignedTrigger({
      feedUrl: 'http://localhost:8787',
      zone: 'karakuwa-east',
      dataSeason: '2023',
      species: 'scallop',
      tier: 2,
      poolAddress: POOL_ADDRESS,
      isRegisteredSigner: async () => true,
      fetchFn: fakeFetch(body),
    });
    expect(result!.signatures).toHaveLength(1);
  });
});
