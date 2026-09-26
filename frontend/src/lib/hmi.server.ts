import { pipelinePlotRecord, type PipelinePlotRecord } from '@repo/shared';

export type HmiPlot = PipelinePlotRecord;
export type HmiData = { status: 'available'; plots: HmiPlot[] }
  | { status: 'not-configured' | 'unavailable' | 'invalid-payload'; plots: [] };

const MAX_BYTES = 2 * 1024 * 1024;
const REGION_BBOX = '140.5,37.2,143.1,40.5';

async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!/^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
    || !response.body || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Invalid response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let body = '';
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Response too large');
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readHmiData(origin: string | undefined): Promise<HmiData> {
  if (!origin) return { status: 'not-configured', plots: [] };
  let base: URL;
  try {
    base = new URL(origin);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
      return { status: 'not-configured', plots: [] };
  } catch { return { status: 'not-configured', plots: [] }; }
  const signal = AbortSignal.timeout(5000);
  const request = async (path: string) => {
    const url = new URL(base);
    const [pathname, search = ''] = path.split('?', 2);
    url.pathname = `${base.pathname.replace(/\/$/, '')}${pathname}`;
    url.search = search;
    return fetch(url, { signal, redirect: 'error', cache: 'no-store', headers: { accept: 'application/json' } });
  };
  try {
    const plotResponse = await request(`/plots?bbox=${encodeURIComponent(REGION_BBOX)}`);
    if (!plotResponse.ok) {
      await plotResponse.body?.cancel();
      return { status: 'unavailable', plots: [] };
    }
    const validPlots = pipelinePlotRecord.array().max(5000).safeParse(await json(plotResponse, signal));
    if (!validPlots.success) return { status: 'invalid-payload', plots: [] };
    return { status: 'available', plots: validPlots.data };
  } catch {
    return { status: 'unavailable', plots: [] };
  }
}

export const HMI_REGION = { west: 140.5, south: 37.2, east: 143.1, north: 40.5 } as const;

export function geoPath(shape: HmiPlot['geometry']): string {
  if (!shape) return '';
  const projectRing = (points: [number, number][]) => points.map(([lon, lat], index) => {
    const x = ((lon - HMI_REGION.west) / (HMI_REGION.east - HMI_REGION.west)) * 800;
    const y = ((HMI_REGION.north - lat) / (HMI_REGION.north - HMI_REGION.south)) * 620;
    return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ') + ' Z';
  const polygons = shape.type === 'Polygon' ? [shape.coordinates] : shape.coordinates;
  return polygons.flatMap((polygon) => polygon.map((points) => projectRing(points))).join(' ');
}

export function geoPoint([lon, lat]: [number, number]): [number, number] {
  return [
    ((lon - HMI_REGION.west) / (HMI_REGION.east - HMI_REGION.west)) * 800,
    ((HMI_REGION.north - lat) / (HMI_REGION.north - HMI_REGION.south)) * 620,
  ];
}
