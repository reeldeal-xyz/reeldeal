import { describe, expect, test } from 'bun:test';
import { pipelinePlotCode, pipelinePlotRecord } from '@repo/shared';
import { readPlotObservations } from '../src/lib/plot-observations';
import { readHeatRisk } from '../src/lib/heat-risk.server';

const product = 'GCOM-W_AMSR2_L3-SST.nighttime.v4';
const payload = (plotCode = 'p1213-001') => ({
  module: 'heat', module_version: 'heat-0.1.0',
  plot: { plotCode, areaM2: 500, centroid: [141.66, 38.85], seaArea: 'karakuwa-east' },
  window: { start: '2026-06-01', end: '2026-10-31' },
  indices: [
    { index: 'SST', unit: 'degC', asOf: '2026-06-01', value: 0,
      source: { product, sha256: 'a'.repeat(64) }, pixels: { strategy: 'nearest_pixel', count: 1, product, distanceKm: 5.7 } },
    { index: 'SST', unit: 'degC', asOf: '2026-06-02', value: null, source: null, pixels: null },
  ], advisory: [],
});
const signal = () => new AbortController().signal;
const envelope = (data: unknown = payload(), status = 'partial') => Response.json({ status, data });
const read = (response: Response) => readPlotObservations('p1213-001', '2026', signal(), async () => response);

describe('exact plot observations for map hover', () => {
  test('reads the canonical plot route, never a fabricated hull or area POST', async () => {
    const result = await readPlotObservations('p1213-001', '2026', signal(), async (url, init) => {
      expect(url).toBe('/api/risk/heat/p1213-001?season=2026');
      expect(init.method).toBeUndefined();
      expect(init.body).toBeUndefined();
      expect(init.cache).toBe('no-store');
      return envelope();
    });
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('Expected observations');
    expect(result.summary.mean).toBe(0);
    expect(result.summary.latest.asOf).toBe('2026-06-01');
    expect(result.coverage).toMatchObject({ observedDays: 1, nullDays: 1, omittedDays: 151, expectedDays: 153 });
  });

  test('does not turn API failure or malformed evidence into zero observations', async () => {
    expect(await read(new Response('', { status: 503 }))).toEqual({ status: 'unavailable' });
    expect(await read(new Response('', { status: 404 }))).toEqual({ status: 'not-found' });
    expect(await read(new Response('<html>error</html>'))).toEqual({ status: 'invalid-payload' });
    expect(await read(envelope(payload(), 'unavailable'))).toEqual({ status: 'invalid-payload' });
    const data = payload();
    data.indices = [data.indices[1]];
    expect(await read(envelope(data))).toEqual({ status: 'no-observations' });
    const stale = await read(envelope(payload(), 'stale'));
    expect(stale.status === 'available' && stale.stale).toBe(true);
  });

  test('rejects mismatched plot, dates, units and unsupported provenance', async () => {
    for (const change of [
      (d: ReturnType<typeof payload>) => { d.plot.plotCode = 'p1213-002'; },
      (d: ReturnType<typeof payload>) => { d.window.start = '2025-06-01'; },
      (d: ReturnType<typeof payload>) => { d.indices[0].unit = 'K'; },
      (d: ReturnType<typeof payload>) => { d.indices[0].source!.sha256 = 'unverified'; },
    ]) {
      const data = payload(); change(data);
      expect(await read(envelope(data))).toEqual({ status: 'invalid-payload' });
    }
  });

  test('bounds chunked bodies and cancels obsolete responses', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    });
    expect(await read(new Response(body, { headers: { 'content-type': 'application/json' } }))).toEqual({ status: 'invalid-payload' });
    expect(cancelled).toBe(true);
    const controller = new AbortController();
    const pending = readPlotObservations('p1213-001', '2026', controller.signal,
      async () => new Response(new ReadableStream(), { headers: { 'content-type': 'application/json' } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    expect(await pending).toEqual({ status: 'cancelled' });
  });

  test('accepts uploaded plot identity consistently at map and heat boundaries', async () => {
    const code = 'upload:local-test';
    expect(pipelinePlotCode.safeParse(code).success).toBe(true);
    expect(pipelinePlotRecord.safeParse({
      plotCode: code, geometry: { type: 'Polygon', coordinates: [[[141, 38], [142, 38], [142, 39], [141, 38]]] },
      species: ['scallop'], operation: 'longline', seaArea: null, prefecture: null,
      areaM2: 500, centroid: [141.66, 38.85], source: 'upload',
    }).success).toBe(true);
    const result = await readHeatRisk({ origin: 'https://pipeline.example.test', plotCode: code, season: '2026' }, async (url) => {
      expect(url.pathname).toBe('/heat/plots/upload%3Alocal-test/risk');
      return Response.json(payload(code));
    });
    expect(result.status).toBe('partial');
    expect((await readPlotObservations(code, '2026', signal(), async (url) => {
      expect(url).toBe('/api/risk/heat/upload%3Alocal-test?season=2026');
      return envelope(payload(code));
    })).status).toBe('available');
    for (const invalid of ['upload:', 'upload:../secret', 'upload:upload:foo', '../secret', 'http://example.test', '%2e%2e']) {
      expect(pipelinePlotCode.safeParse(invalid).success).toBe(false);
    }
  });
});
