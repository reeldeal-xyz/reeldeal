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
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: secret };
  delete env.LEGACY_WEB_ORIGIN;
  delete env.PIPELINE_API_URL;
  if (legacyOrigin) env.LEGACY_WEB_ORIGIN = legacyOrigin === 'self' ? origin : legacyOrigin;
  const child = spawn('node', ['dist/server/entry.mjs'], { cwd: frontend, env, stdio: 'ignore' });
  let spawnError;
  child.on('error', (error) => { spawnError = error; });
  const stopped = once(child, 'exit');
  const request = (path) => fetch(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
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
  const health = await request('/health');
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { status: 'ok', service: 'umi-frontend' });
  const workshop = await request('/workshop');
  assert.equal(workshop.status, 200);
  const html = await workshop.text();
  assert(!html.includes(secret), 'Server-only env leaked into HTML');
  const heat = await request('/api/risk/heat/p1213-001?season=2025');
  assert.equal(heat.status, 503);
  assert.equal(heat.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await heat.json(), { status: 'not-configured', data: null });
  assert.equal((await request('/api/risk/heat/p1213-001?season=invalid')).status, 400);
  assert.match(html, /component-url="[^\"]*BidWorkshop\./);
  assert.match(html, /component-url="[^\"]*WalletPreview\./);
  for (const species of ['katsuo', 'sanma', 'saba', 'hotate', 'maguro', 'awabi']) {
    assert(html.includes(`/images/fish/${species}-ice.webp`), `Missing species illustration: ${species}`);
  }
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
  const assets = [...new Set([...(html + previewHtml).matchAll(/(?:src|href|component-url|renderer-url)="(\/(?:_astro|images)\/[^\"]+)"/g)].map((match) => match[1]))];
  assert(assets.length >= 6, 'Expected CSS, both islands, renderers, and a visible image');
  for (const asset of assets) {
    const response = await request(asset);
    assert.equal(response.status, 200, `Missing asset: ${asset}`);
    assert(!response.headers.get('content-type')?.includes('text/html'), `Asset returned HTML: ${asset}`);
    assert((await response.arrayBuffer()).byteLength > 0, `Empty asset: ${asset}`);
  }
  for (const path of ['/map', '/donate', '/liff', '/coop', '/holder', '/verify/event-1']) {
    const response = await request(path);
    assert.equal(response.status, 503, `Unconfigured legacy route: ${path}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const path of ['/unknown', '/api/world', '/map/extra', '/verify/']) {
    assert.equal((await request(path)).status, 404, `Unknown route should stay local: ${path}`);
  }
  console.log(`PASS built health, workshop, six preview routes, ${assets.length} assets, missing-env routes, and local 404s`);
});

await withServer('https://legacy.example.test/ignored-base', async (request) => {
  const response = await request('/verify/event-1?view=proof&next=%2Fmap');
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'https://legacy.example.test/verify/event-1?view=proof&next=%2Fmap');
  assert.equal((await request('/api/world')).status, 404);
  console.log('PASS legacy redirect preserves path/query and excludes API routes');
});

await withServer('self', async (request) => {
  const response = await request('/map');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  console.log('PASS same-origin redirect loop guard');
});
