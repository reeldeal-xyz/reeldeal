import { pipelinePlotRecord, pipelineZoneRecord, type PipelinePlotRecord, type PipelineZoneRecord } from '@repo/shared';

export type HmiPlot = PipelinePlotRecord;
export type HmiZone = PipelineZoneRecord;
export type HmiData = { status: 'available'; plots: HmiPlot[]; zones: HmiZone[] }
  | { status: 'not-configured' | 'unavailable' | 'invalid-payload'; plots: []; zones: [] };

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
  if (!origin) return { status: 'not-configured', plots: [], zones: [] };
  let base: URL;
  try {
    base = new URL(origin);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
      return { status: 'not-configured', plots: [], zones: [] };
  } catch { return { status: 'not-configured', plots: [], zones: [] }; }
  const signal = AbortSignal.timeout(5000);
  const request = async (path: string) => {
    const url = new URL(base);
    const [pathname, search = ''] = path.split('?', 2);
    url.pathname = `${base.pathname.replace(/\/$/, '')}${pathname}`;
    url.search = search;
    return fetch(url, { signal, redirect: 'error', cache: 'no-store', headers: { accept: 'application/json' } });
  };
  try {
    const [plotResponse, zoneResponse] = await Promise.all([
      request(`/plots?bbox=${encodeURIComponent(REGION_BBOX)}`), request('/zones'),
    ]);
    if (!plotResponse.ok || !zoneResponse.ok) {
      await Promise.all([plotResponse.body?.cancel(), zoneResponse.body?.cancel()]);
      return { status: 'unavailable', plots: [], zones: [] };
    }
    const [plots, zones] = await Promise.all([json(plotResponse, signal), json(zoneResponse, signal)]);
    const validPlots = pipelinePlotRecord.array().max(5000).safeParse(plots);
    const validZones = pipelineZoneRecord.array().max(500).safeParse(zones);
    if (!validPlots.success || !validZones.success) return { status: 'invalid-payload', plots: [], zones: [] };
    return { status: 'available', plots: validPlots.data, zones: validZones.data };
  } catch {
    return { status: 'unavailable', plots: [], zones: [] };
  }
}

export const HMI_REGION = { west: 140.5, south: 37.2, east: 143.1, north: 40.5 } as const;
export const HMI_MAP_SIZE = { width: 800, height: 620, padding: 28 } as const;

const referenceLatitude = (HMI_REGION.south + HMI_REGION.north) / 2;
const longitudeScale = Math.cos(referenceLatitude * Math.PI / 180);
const projectedWidth = (HMI_REGION.east - HMI_REGION.west) * longitudeScale;
const projectedHeight = HMI_REGION.north - HMI_REGION.south;
const unitsPerDegree = Math.min(
  (HMI_MAP_SIZE.width - HMI_MAP_SIZE.padding * 2) / projectedWidth,
  (HMI_MAP_SIZE.height - HMI_MAP_SIZE.padding * 2) / projectedHeight,
);
const projectedBounds = {
  x: (HMI_MAP_SIZE.width - projectedWidth * unitsPerDegree) / 2,
  y: (HMI_MAP_SIZE.height - projectedHeight * unitsPerDegree) / 2,
  width: projectedWidth * unitsPerDegree,
  height: projectedHeight * unitsPerDegree,
};

export function geoPath(shape: HmiPlot['geometry'] | HmiZone['geometry']): string {
  if (!shape) return '';
  const projectRing = (points: [number, number][]) => points.map((point, index) => {
    const [x, y] = geoPoint(point);
    return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ') + ' Z';
  const polygons = shape.type === 'Polygon' ? [shape.coordinates] : shape.coordinates;
  return polygons.flatMap((polygon) => polygon.map((points) => projectRing(points))).join(' ');
}

export function geoPoint([lon, lat]: [number, number]): [number, number] {
  return [
    projectedBounds.x + (lon - HMI_REGION.west) * longitudeScale * unitsPerDegree,
    projectedBounds.y + (HMI_REGION.north - lat) * unitsPerDegree,
  ];
}

export function geoGraticule() {
  const longitudes = [140.5, 141, 141.5, 142, 142.5, 143];
  const latitudes = [37.5, 38, 38.5, 39, 39.5, 40];
  return {
    longitudes: longitudes.map((lon) => {
      const [x] = geoPoint([lon, HMI_REGION.south]);
      return { label: `${lon.toFixed(1)}°E`, x, y: projectedBounds.y + projectedBounds.height + 18, d: `M${x.toFixed(2)},${projectedBounds.y.toFixed(2)}V${(projectedBounds.y + projectedBounds.height).toFixed(2)}` };
    }),
    latitudes: latitudes.map((lat) => {
      const [x1, y] = geoPoint([HMI_REGION.west, lat]);
      const [x2] = geoPoint([HMI_REGION.east, lat]);
      return { label: `${lat.toFixed(1)}°N`, x: x1 - 38, y: y + 4, d: `M${x1.toFixed(2)},${y.toFixed(2)}H${x2.toFixed(2)}` };
    }),
    bounds: projectedBounds,
  };
}
