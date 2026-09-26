import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { eventInput, fetchMultiBaasEvents, verifyMultiBaasSignature, type MultiBaasEventInformation } from './multibaas';

describe('verifyMultiBaasSignature', () => {
  // Curvegrid's docs (docs.curvegrid.com/multibaas/webhooks/) describe the algorithm and show Go
  // pseudocode for generating the signature, but publish no numeric worked example. This vector is
  // derived straight from that documented algorithm — HMAC-SHA256(secret, body + decimalTimestampString),
  // hex-encoded — so a regression here means either our implementation or the docs' algorithm changed.
  const secret = 'whsec_test_multibaas_secret';
  const body = '{"hello":"world"}';
  const timestamp = '1700000000';
  const knownSignature = 'cf4702eb557f34556df7d5cedcc636bdb779cb11f6f7abbf6a5123ed7190c679';

  test('accepts a signature computed with the documented algorithm', () => {
    expect(verifyMultiBaasSignature(body, timestamp, knownSignature, secret)).toBe(true);
  });

  test('matches an independently-computed HMAC for arbitrary input', () => {
    const anotherBody = '[{"id":"abc","event":"event.emitted"}]';
    const anotherTimestamp = '1758800000';
    const anotherSecret = 'another-secret';
    const expected = createHmac('sha256', anotherSecret).update(anotherBody).update(anotherTimestamp).digest('hex');
    expect(verifyMultiBaasSignature(anotherBody, anotherTimestamp, expected, anotherSecret)).toBe(true);
  });

  test('rejects a wrong secret', () => {
    expect(verifyMultiBaasSignature(body, timestamp, knownSignature, 'wrong-secret')).toBe(false);
  });

  test('rejects a tampered body', () => {
    expect(verifyMultiBaasSignature('{"hello":"tampered"}', timestamp, knownSignature, secret)).toBe(false);
  });

  test('rejects a tampered timestamp', () => {
    expect(verifyMultiBaasSignature(body, '1700000001', knownSignature, secret)).toBe(false);
  });

  test('rejects a non-hex signature instead of throwing', () => {
    expect(verifyMultiBaasSignature(body, timestamp, 'not-hex!!', secret)).toBe(false);
  });

  test('rejects missing signature or timestamp', () => {
    expect(verifyMultiBaasSignature(body, timestamp, '', secret)).toBe(false);
    expect(verifyMultiBaasSignature(body, '', knownSignature, secret)).toBe(false);
  });
});

describe('eventInput', () => {
  const event: MultiBaasEventInformation = {
    name: 'Paid',
    signature: 'Paid(bytes32,string,address,bytes32,uint256)',
    inputs: [
      { name: 'eventId', value: '0xabc', hashed: false, type: 'bytes32' },
      { name: 'plotLabel', value: 'p1213-017', hashed: false, type: 'string' },
      { name: 'farmer', value: '0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172', hashed: false, type: 'address' },
      { name: 'amount', value: '20000000000000000000000', hashed: false, type: 'uint256' },
    ],
    contract: { address: '0xdeadbeef', name: 'ReliefPool', label: 'reliefpool' },
    indexInLog: 0,
  };

  test('reads a named input value', () => {
    expect(eventInput(event, 'plotLabel')).toBe('p1213-017');
    expect(eventInput(event, 'amount')).toBe('20000000000000000000000');
  });

  test('returns undefined for a missing input', () => {
    expect(eventInput(event, 'nullifier')).toBeUndefined();
  });
});

describe('fetchMultiBaasEvents', () => {
  test('queries GET /api/v0/events with auth header and filters, and maps the result', async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: HeadersInit | undefined;

    const fetchFn = (async (input: string | URL, init?: RequestInit) => {
      capturedUrl = input.toString();
      capturedHeaders = init?.headers;
      return new Response(
        JSON.stringify({
          status: 200,
          message: 'success',
          result: [
            {
              triggeredAt: '2023-11-10T11:11:30+09:00',
              event: {
                name: 'Donated',
                signature: 'Donated(address,uint256,string)',
                inputs: [{ name: 'from', value: '0xabc', hashed: false, type: 'address' }],
                contract: { address: '0xreliefpool', name: 'ReliefPool', label: 'reliefpool' },
                indexInLog: 0,
              },
              transaction: {
                from: '0xabc',
                txHash: '0xhash',
                txIndexInBlock: 0,
                blockHash: '0xblockhash',
                blockNumber: 10,
                contract: { address: '0xreliefpool', name: 'ReliefPool', label: 'reliefpool' },
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const events = await fetchMultiBaasEvents({
      baseUrl: 'https://example.multibaas.com',
      apiKey: 'test-api-key',
      contractLabel: 'reliefpool',
      limit: 10,
      fetchFn,
    });

    expect(capturedUrl).toBe('https://example.multibaas.com/api/v0/events?contractLabel=reliefpool&limit=10');
    expect(capturedHeaders).toEqual({ Authorization: 'Bearer test-api-key' });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      triggeredAt: '2023-11-10T11:11:30+09:00',
      name: 'Donated',
      contractLabel: 'reliefpool',
      contractAddress: '0xreliefpool',
      txHash: '0xhash',
      blockNumber: 10,
      inputs: [{ name: 'from', value: '0xabc', hashed: false, type: 'address' }],
    });
  });

  test('throws on a non-OK response', async () => {
    const fetchFn = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(
      fetchMultiBaasEvents({ baseUrl: 'https://example.multibaas.com', apiKey: 'k', fetchFn }),
    ).rejects.toThrow('HTTP 500');
  });
});
