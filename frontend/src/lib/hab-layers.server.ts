import { pipelineLayerInfo, type PipelineLayerInfo } from '@repo/shared';
import { pickChlLayer } from './hab-layers';

export type HabLayerResult =
  | { status: 'available'; layer: PipelineLayerInfo }
  | { status: 'not-configured' | 'not-built' | 'unavailable' | 'invalid-payload'; layer: null };

const MAX_BYTES = 256 * 1024;

/** The JAXA chl-a layer to draw for a season month, via GET /hab/layers/{YYYY-MM-15}. */
export async function readHabLayer(origin: string | undefined, season: string, month: string): Promise<HabLayerResult> {
  const failed = (status: Exclude<HabLayerResult['status'], 'available'>): HabLayerResult => ({ status, layer: null });
  if (!origin || !/^20\d{2}$/.test(season) || !/^(0[1-9]|1[0-2])$/.test(month)) return failed('not-configured');
  let base: URL;
  try {
    base = new URL(origin);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
      return failed('not-configured');
  } catch { return failed('not-configured'); }
  const url = new URL(base);
  url.pathname = `${base.pathname.replace(/\/$/, '')}/hab/layers/${season}-${month}-15`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000), redirect: 'error', cache: 'no-store', headers: { accept: 'application/json' },
    });
    if (!response.ok || !/^application\/json/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel().catch(() => {});
      return failed('unavailable');
    }
    const text = await response.text();
    if (text.length > MAX_BYTES) return failed('invalid-payload');
    const parsed = pipelineLayerInfo.array().max(100).safeParse(JSON.parse(text));
    if (!parsed.success) return failed('invalid-payload');
    const layer = pickChlLayer(parsed.data);
    return layer ? { status: 'available', layer } : failed('not-built');
  } catch {
    return failed('unavailable');
  }
}
