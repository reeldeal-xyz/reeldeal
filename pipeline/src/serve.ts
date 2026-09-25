// OWNER: Jay. Feed API. Serves pipeline/out/*.json over HTTP on :8787 (PIPELINE_PORT).
// GET /health, /series/:zone/:season, /indices/:zone/:season, /triggers/:zone/:season, /buoy/:month
const port = Number(process.env.PIPELINE_PORT ?? 8787);
const outDir = new URL('../out/', import.meta.url);
const map: Record<string, (p: string[]) => string> = {
  series: ([z, s]) => `series-${z}-${s}.json`,
  indices: ([z, s]) => `indices-${z}-${s}.json`,
  triggers: ([z, s]) => `triggers-${z}-${s}.json`,
  buoy: ([m]) => `buoy-${m}.json`,
};
Bun.serve({
  port,
  async fetch(req) {
    const parts = new URL(req.url).pathname.split('/').filter(Boolean);
    if (parts[0] === 'health') return Response.json({ ok: true });
    const make = parts[0] ? map[parts[0]] : undefined;
    if (!make) return new Response('not found', { status: 404 });
    const file = Bun.file(new URL(make(parts.slice(1)), outDir));
    if (!(await file.exists())) return new Response('not found', { status: 404 });
    return new Response(file, { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
  },
});
console.log(`pipeline feed on http://localhost:${port}`);
