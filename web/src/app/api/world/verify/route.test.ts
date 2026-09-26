import { describe, expect, test } from 'bun:test';
import { POST } from './route';

// This only exercises the Next.js adapter wiring (Request in, Response out). The actual
// verification/binding logic is covered exhaustively in lib/world/verify-handler.test.ts with
// mocked dependencies -- these bodies fail validation before any network or chain call happens.
describe('POST /api/world/verify (adapter)', () => {
  test('rejects a malformed body', async () => {
    const req = new Request('http://localhost/api/world/verify', {
      method: 'POST',
      body: JSON.stringify({ nope: true }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_request');
  });

  test('rejects invalid JSON', async () => {
    const req = new Request('http://localhost/api/world/verify', { method: 'POST', body: 'not json' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
