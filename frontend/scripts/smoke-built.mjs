/** Run after `bun run frontend:build`: node frontend/scripts/smoke-built.mjs. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const frontend = fileURLToPath(new URL('..', import.meta.url));
const secret = 'frontend-smoke-server-only';

async function withServer(legacyOrigin, check) {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: secret, SEPOLIA_RPC_URL: 'http://127.0.0.1:1' };
  delete env.LEGACY_WEB_ORIGIN;
  delete env.PIPELINE_API_URL;
  if (legacyOrigin) env.LEGACY_WEB_ORIGIN = legacyOrigin === 'self' ? origin : legacyOrigin;
  const child = spawn('node', ['dist/server/entry.mjs'], { cwd: frontend, env, stdio: 'ignore' });
  let spawnError;
  child.on('error', (error) => { spawnError = error; });
  const stopped = once(child, 'exit');
  const request = async (path, init = {}) => {
    try { return await fetch(origin + path, { ...init, redirect: 'manual', signal: AbortSignal.timeout(3000) }); }
    catch (cause) { throw new Error(`Built smoke request failed: ${path}`, { cause }); }
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`Frontend exited with ${child.exitCode}`);
      try {
        if ((await request('/health')).ok) { ready = true; break; }
      } catch { /* The server is still starting. */ }
      await delay(100);
    }
    assert(ready, 'Built frontend did not become ready within 10 seconds');
    await check(request);
  } finally {
    child.kill('SIGTERM');
    await stopped;
  }
}

await withServer(undefined, async (request) => {
  const root = await request('/');
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/hmi');
  const mapRedirect = await request('/map');
  assert.equal(mapRedirect.status, 302);
  assert.equal(mapRedirect.headers.get('location'), '/hmi');
  const health = await request('/health');
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { status: 'ok', service: 'umi-frontend' });
  const hmi = await request('/hmi');
  assert.equal(hmi.status, 200);
  const hmiHtml = await hmi.text();
  assert.match(hmiHtml, /Coastal map · ReelDeal/);
  assert(!hmiHtml.includes(secret), 'Server-only env leaked into HTML');
  assert.match(hmiHtml, /id="hmi-map"/, 'HMI map container missing');
  assert.match(hmiHtml, /aria-controls="market-shelf"/, 'HMI market shelf missing');
  const hmiJa = await request('/hmi?lang=ja');
  assert.match(await hmiJa.text(), /<html lang="ja"[\s\S]*沿岸マップ · ReelDeal/);

  const market = await request('/market');
  assert.equal(market.status, 200);
  const marketHtml = await market.text();
  assert(!marketHtml.includes(secret), 'Server-only env leaked into HTML');
  assert.match(marketHtml, /data-market-preview-item="RD-LOT-004"/, 'Market lots missing');
  assert.match(marketHtml, /Sepolia testnet/, 'Testnet market label missing');

  for (const path of ['/workshop', '/market/checkout-demo']) {
    assert.equal((await request(path)).status, 404, `Removed route should stay gone: ${path}`);
  }

  for (const [path, expected] of [
    ['/relief?plot=does-not-exist', 404],
    ['/relief?plot=p1213-001&season=bad', 400],
    ['/relief?plot=p1213-001&plot=p1213-002', 400],
    ['/api/relief/plot/p1213-001?season=bad', 400],
    ['/api/relief/plot/p1213-001?season=2026&season=2025', 400],
    ['/api/relief/plot/p1213-001?eventId=0x1', 400],
  ]) {
    const response = await request(path);
    assert.equal(response.status, expected, `Relief request must reject invalid selection: ${path}`);
    const html = await response.text();
    assert(!html.includes('Payment confirmed'), `Invalid selection displayed another plot payment: ${path}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  console.log('PASS relief selection rejects unknown plots and malformed/duplicate season/event without a payment fallback');

  for (const query of ['latitude=0&longitude=0', 'latitude=38&longitude=141&latitude=39', 'latitude=38&longitude=141&origin=https://other.example', 'latitude=&longitude=141']) {
    const response = await request(`/api/weather/forecast?${query}`);
    assert.equal(response.status, 400, 'Weather query must reject invalid or duplicate coordinates');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  console.log('PASS forecast input is bounded to validated coordinates and a fixed provider');

  const heat = await request('/api/risk/heat/p1213-001?season=2025');
  assert.equal(heat.status, 503);
  assert.equal(heat.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await heat.json(), { status: 'not-configured', data: null });
  assert.equal((await request('/api/risk/heat/p1213-001?season=invalid')).status, 400);
  const area = (coordinates, start = '2025-06-01', end = '2025-10-31') => request('/api/risk/heat/area', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ feature: { type: 'Feature', properties: null, geometry: { type: 'Polygon', coordinates } }, start, end }),
  });
  assert.equal((await area([[[141, 38], [142, 39], [141, 39], [142, 38], [141, 38]]])).status, 400);
  assert.equal((await area([[[141, 38], [142, 38], [142, 39], [141, 39], [141, 38]]], '2025-01-01', '2026-01-02')).status, 400);
  assert.equal((await area([[[141, 38], [142, 38], [142, 39], [141, 39], [141, 38]]])).status, 503);

  let previewHtml = '';
  for (const [path, heading] of [
    ['/preview', 'Community journeys'],
    ['/preview/market', 'Local catch'],
    ['/preview/donate', 'relief fund'],
    ['/preview/farmer', 'My relief status'],
    ['/preview/holder', 'slot'],
    ['/preview/coop', 'Co-op'],
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200, `Preview route should render without services: ${path}`);
    const page = await response.text();
    assert(page.includes(heading), `Missing screen content: ${path}`);
    assert(page.includes('aria-label="Preview screens"'), `Missing journey navigation: ${path}`);
    assert(!page.includes(secret), `Server-only env leaked into ${path}`);
    previewHtml += page;
  }
  const html = hmiHtml + marketHtml + previewHtml;
  const assets = [...new Set([...html.matchAll(/(?:src|href|component-url|renderer-url)="(\/(?:_astro|images)\/[^\"]+)"/g)].map((match) => match[1]))];
  assert(assets.length >= 6, 'Expected CSS, the wallet island, renderers, the brand logo and preview images');
  for (const asset of assets) {
    const response = await request(asset);
    assert.equal(response.status, 200, `Missing asset: ${asset}`);
    assert(!response.headers.get('content-type')?.includes('text/html'), `Asset returned HTML: ${asset}`);
    assert((await response.arrayBuffer()).byteLength > 0, `Empty asset: ${asset}`);
  }
  for (const path of ['/donate', '/liff', '/coop', '/holder', '/verify/event-1']) {
    const response = await request(path);
    assert.equal(response.status, 503, `Unconfigured legacy route: ${path}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const path of ['/unknown', '/api/world', '/map/extra', '/verify/']) {
    assert.equal((await request(path)).status, 404, `Unknown route should stay local: ${path}`);
  }
  console.log(`PASS built health, HMI (en/ja)/market, six preview routes, ${assets.length} assets, removed demo routes, area validation, missing-env routes, and local 404s`);
});

await withServer('https://legacy.example.test/ignored-base', async (request) => {
  const response = await request('/verify/event-1?view=proof&next=%2Fmap');
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'https://legacy.example.test/verify/event-1?view=proof&next=%2Fmap');
  assert.equal((await request('/api/world')).status, 404);
  console.log('PASS legacy redirect preserves path/query and excludes API routes');
});

await withServer('self', async (request) => {
  const response = await request('/liff');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  console.log('PASS same-origin redirect loop guard');
});
