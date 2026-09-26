import { describe, expect, test } from 'bun:test';
import { callWorldVerify, WorldVerifyError } from './verify-client';

function fakeFetch(response: { ok: boolean; status: number; text: string }): typeof fetch {
  return (async () =>
    ({
      ok: response.ok,
      status: response.status,
      text: async () => response.text,
    }) as unknown as Response) as unknown as typeof fetch;
}

describe('callWorldVerify', () => {
  test('resolves on 2xx with no explicit failure body', async () => {
    const fetchImpl = fakeFetch({ ok: true, status: 200, text: '' });
    await expect(callWorldVerify('rp_test', { any: 'result' }, fetchImpl)).resolves.toBeUndefined();
  });

  test('resolves on 2xx with a non-failure JSON body', async () => {
    const fetchImpl = fakeFetch({ ok: true, status: 200, text: JSON.stringify({ success: true }) });
    const payload = await callWorldVerify('rp_test', { any: 'result' }, fetchImpl);
    expect(payload).toEqual({ success: true });
  });

  test('throws WorldVerifyError on non-2xx', async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 400, text: JSON.stringify({ error: 'invalid_proof' }) });
    await expect(callWorldVerify('rp_test', {}, fetchImpl)).rejects.toBeInstanceOf(WorldVerifyError);
  });

  test('throws WorldVerifyError when a 2xx body carries an explicit failure flag', async () => {
    const fetchImpl = fakeFetch({ ok: true, status: 200, text: JSON.stringify({ success: false }) });
    await expect(callWorldVerify('rp_test', {}, fetchImpl)).rejects.toBeInstanceOf(WorldVerifyError);
  });

  test('POSTs the exact result object unmodified, byte-for-byte', async () => {
    let capturedBody: string | undefined;
    let capturedUrl: string | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = init?.body as string;
      return { ok: true, status: 200, text: async () => '' } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = { protocol_version: '4.0', nonce: 'abc', responses: [{ nullifier: '0x1' }] };
    await callWorldVerify('rp_deadbeef', result, fetchImpl);

    expect(capturedUrl).toBe('https://developer.world.org/api/v4/verify/rp_deadbeef');
    expect(capturedBody).toBe(JSON.stringify(result));
  });

  test('throws WorldVerifyError when the network call itself fails', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(callWorldVerify('rp_test', {}, fetchImpl)).rejects.toBeInstanceOf(WorldVerifyError);
  });
});
