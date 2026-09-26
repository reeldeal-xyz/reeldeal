import { heatCoverage, pipelineHeatRisk, pipelinePlotCode, pipelineSeason } from '@repo/shared';
import { observationSummary } from './hmi-presentation';

type Summary = NonNullable<ReturnType<typeof observationSummary>>;
export type PlotObservationResult = { status: 'available'; summary: Summary; coverage: ReturnType<typeof heatCoverage>; stale: boolean }
  | { status: 'not-found' | 'no-observations' | 'unavailable' | 'invalid-payload' | 'cancelled' };

export async function readPlotObservations(
  plotCode: string,
  season: string,
  signal: AbortSignal,
  transport: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<PlotObservationResult> {
  if (!pipelinePlotCode.safeParse(plotCode).success || !pipelineSeason.safeParse(season).success) return { status: 'invalid-payload' };
  if (signal.aborted) return { status: 'cancelled' };
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
  let response: Response;
  try {
    response = await transport(`/api/risk/heat/${encodeURIComponent(plotCode)}?season=${encodeURIComponent(season)}`, {
      signal: bounded, cache: 'no-store', headers: { accept: 'application/json' }, redirect: 'error',
    });
  } catch { return { status: signal.aborted ? 'cancelled' : 'unavailable' }; }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { status: response.status === 404 ? 'not-found' : 'unavailable' };
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void reader?.cancel().catch(() => {}); };
  try {
    if (!response.headers.get('content-type')?.startsWith('application/json') || !response.body) return { status: 'invalid-payload' };
    reader = response.body.getReader();
    bounded.addEventListener('abort', cancel, { once: true });
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0, text = '';
    while (true) {
      bounded.throwIfAborted();
      const { value, done } = await reader.read();
      bounded.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) return { status: 'invalid-payload' };
      text += decoder.decode(value, { stream: true });
    }
    const envelope = JSON.parse(text + decoder.decode());
    if (!['available', 'partial', 'stale'].includes(envelope?.status)) return { status: 'invalid-payload' };
    const parsed = pipelineHeatRisk.safeParse(envelope.data);
    if (!parsed.success || parsed.data.plot.plotCode !== plotCode
      || parsed.data.window.start !== `${season}-06-01` || parsed.data.window.end !== `${season}-10-31`) return { status: 'invalid-payload' };
    const summary = observationSummary(parsed.data.indices.filter((item) => item.index === 'SST'));
    return summary ? { status: 'available', summary, coverage: heatCoverage(parsed.data), stale: envelope.status === 'stale' } : { status: 'no-observations' };
  } catch { return { status: signal.aborted ? 'cancelled' : bounded.aborted ? 'unavailable' : 'invalid-payload' }; }
  finally {
    bounded.removeEventListener('abort', cancel);
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    else await response.body?.cancel().catch(() => {});
  }
}
