/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readHeatRisk } from '../src/lib/heat-risk.server';

const input = { origin: 'https://pipeline.example.test/v1', plotCode: 'p1213-001', season: '2025' };
const product = 'GCOM-W_AMSR2_L3-SST.nighttime.v4';
const record = (asOf: string, value: number | null = 0) => ({
  index: 'SST', unit: 'degC', asOf, value,
  source: value === null ? null : { product, sha256: 'a'.repeat(64) },
  pixels: value === null ? null : { strategy: 'nearest_pixel', count: 1, product, distanceKm: 5.7, stationId: null },
});
const payload = () => ({
  module: 'heat', module_version: 'heat-0.1.0',
  plot: { plotCode: input.plotCode, areaM2: 500, centroid: [141.66, 38.85], seaArea: 'karakuwa-east' },
  window: { start: '2025-06-01', end: '2025-10-31' },
  indices: [record('2025-06-01'), record('2025-06-02', null)], advisory: [],
});
const transport = (response: Response) => async () => response;
const read = (data: unknown) => readHeatRisk(input, transport(Response.json(data)));

describe('operational heat consumer', () => {
  test('preserves zero, null, omitted days and source support without inventing observations', async () => {
    const result = await read(payload());
    expect(result.status).toBe('partial');
    if (!result.data) throw new Error('Expected parsed data');
    expect(result.coverage).toEqual({ expectedDays: 153, observedDays: 1, nullDays: 1, omittedDays: 151, latestObservedDay: '2025-06-01' });
    expect(result.data.indices[0]?.value).toBe(0);
    expect(result.data.indices[0]?.pixels?.distanceKm).toBe(5.7);
    expect(result.data.indices[1]?.value).toBeNull();
  });

  test('labels complete coverage and only applies an explicit observation freshness cutoff', async () => {
    const data = payload();
    data.indices = Array.from({ length: 153 }, (_, i) => record(new Date(Date.UTC(2025, 5, 1 + i)).toISOString().slice(0, 10)));
    expect((await read(data)).status).toBe('available');
    expect((await readHeatRisk({ ...input, requiredThrough: '2025-11-01' }, transport(Response.json(data)))).status).toBe('stale');
    expect((await readHeatRisk({ ...input, requiredThrough: '2025-02-30' }, transport(Response.json(data)))).status).toBe('invalid-request');
  });

  test('accepts database plot codes, including uploads, in the request and the echoed response', async () => {
    for (const plotCode of ['04-ku-1101', 'upload:coop-7']) {
      let requested = '';
      const data = payload();
      data.plot.plotCode = plotCode;
      const result = await readHeatRisk({ ...input, plotCode }, async (url) => { requested = url.pathname; return Response.json(data); });
      expect(result.status).toBe('partial');
      expect(requested).toBe(`/v1/heat/plots/${encodeURIComponent(plotCode)}/risk`);
    }
    expect((await readHeatRisk({ ...input, plotCode: 'upload:' }, transport(Response.json(payload())))).status).toBe('invalid-request');
  });

  test('rejects wrong identity, season, unit, hash, unsupported indices and advisory records', async () => {
    const mutations = [
      (p: any) => { p.plot.plotCode = 'p1213-002'; },
      (p: any) => { p.window.start = '2024-06-01'; },
      (p: any) => { p.indices[0].unit = 'K'; },
      (p: any) => { p.indices[0].source.sha256 = 'not-a-hash'; },
      (p: any) => { p.indices[0].source = null; },
      (p: any) => { p.indices[0].pixels.distanceKm = null; },
      (p: any) => { p.indices[0].index = 'UNKNOWN'; },
      (p: any) => { p.indices[0].asOf = '2025-02-30'; },
      (p: any) => { p.indices[0].asOf = '2026-06-01'; },
      (p: any) => { p.indices.push(p.indices[0]); },
      (p: any) => { p.indices.reverse(); },
      (p: any) => { p.advisory.push({ index: 'heat-forecast', value: 30 }); },
    ];
    for (const mutate of mutations) {
      const data = payload(); mutate(data);
      expect(await read(data)).toEqual({ status: 'invalid-payload', data: null });
    }
  });

  test('reports upstream failures and malformed data without a fixture fallback', async () => {
    for (const [code, status] of [[501, 'unimplemented'], [404, 'not-found'], [503, 'unavailable']] as const) {
      expect(await readHeatRisk(input, transport(new Response('private upstream details', { status: code })))).toEqual({ status, data: null });
    }
    for (const response of [new Response('<html>error</html>'), new Response('{', { headers: { 'content-type': 'application/json' } })]) {
      expect(await readHeatRisk(input, transport(response))).toEqual({ status: 'invalid-payload', data: null });
    }
    const failing = async () => { throw new Error('private endpoint'); };
    expect(await readHeatRisk(input, failing)).toEqual({ status: 'unavailable', data: null });
  });

  test('bounds streamed bodies even without Content-Length and cancels the stream', async () => {
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    });
    const result = await readHeatRisk(input, transport(new Response(body, { headers: { 'content-type': 'application/json' } })));
    expect(result).toEqual({ status: 'invalid-payload', data: null });
    expect(cancelled).toBe(true);
  });

  test('cancels obsolete requests while reading a body', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const result = readHeatRisk({ ...input, signal: controller.signal }, transport(new Response(body, { headers: { 'content-type': 'application/json' } })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    expect(await result).toEqual({ status: 'cancelled', data: null });
    expect(cancelled).toBe(true);
  });

  test('bounds a stalled upstream body by the same five-second deadline', async () => {
    const body = new ReadableStream();
    expect(await readHeatRisk(input, transport(new Response(body, { headers: { 'content-type': 'application/json' } })))).toEqual({ status: 'timeout', data: null });
  }, 7000);

  test('keeps the upstream address server-configured and rejects bad input before requesting', async () => {
    let calls = 0;
    const fetcher = async (url: URL, init: RequestInit) => {
      calls++;
      expect(String(url)).toBe('https://pipeline.example.test/v1/heat/plots/p1213-001/risk?season=2025');
      expect(init.redirect).toBe('error');
      expect(init.cache).toBe('no-store');
      return Response.json(payload());
    };
    expect((await readHeatRisk(input, fetcher)).status).toBe('partial');
    for (const change of [{ plotCode: '../secret' }, { season: '2025/../' }, { origin: undefined }, { origin: 'file:///tmp/data' }, { origin: 'https://user:secret@pipeline.example.test' }])
      expect((await readHeatRisk({ ...input, ...change }, fetcher)).data).toBeNull();
    expect(calls).toBe(1);
  });
});
