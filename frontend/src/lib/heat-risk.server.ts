import { heatCoverage, pipelineDay, pipelineHeatRisk, pipelinePlotCode, pipelineSeason, type PipelineHeatRisk } from '@repo/shared';

type Failure = 'not-configured' | 'invalid-request' | 'not-found' | 'unimplemented' | 'unavailable'
  | 'timeout' | 'cancelled' | 'invalid-payload';
export type HeatRiskResult =
  | { status: Failure; data: null }
  | { status: 'available' | 'partial' | 'stale'; data: PipelineHeatRisk;
      coverage: ReturnType<typeof heatCoverage>; fetchedAt: string };

const MAX_BYTES = 2 * 1024 * 1024;

export async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!/^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? ''))
    throw new Error('Expected JSON');
  if (Number(response.headers.get('content-length')) > MAX_BYTES || !response.body)
    throw new Error('Response exceeds limit or has no body');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let body = '';
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('Response exceeds limit');
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

export async function readHeatRisk(input: {
  origin: string | undefined;
  plotCode: string;
  season: string;
  signal?: AbortSignal;
  /** Product-specific acceptance cutoff, supplied only after agreement; never inferred from fetch time. */
  requiredThrough?: string;
}, transport: (url: URL, init: RequestInit) => Promise<Response> = fetch): Promise<HeatRiskResult> {
  const failed = (status: Failure): HeatRiskResult => ({ status, data: null });
  if (!pipelinePlotCode.safeParse(input.plotCode).success || !pipelineSeason.safeParse(input.season).success
    || (input.requiredThrough !== undefined && !pipelineDay.safeParse(input.requiredThrough).success))
    return failed('invalid-request');
  if (input.signal?.aborted) return failed('cancelled');
  if (!input.origin) return failed('not-configured');
  let origin: URL;
  try {
    origin = new URL(input.origin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash)
      return failed('not-configured');
  } catch { return failed('not-configured'); }
  const timeout = AbortSignal.timeout(5000);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  const url = new URL(origin);
  url.pathname = `${origin.pathname.replace(/\/$/, '')}/heat/plots/${encodeURIComponent(input.plotCode)}/risk`;
  url.searchParams.set('season', input.season);
  let response: Response;
  try {
    response = await transport(url, { signal, redirect: 'error', cache: 'no-store', headers: { accept: 'application/json' } });
  } catch {
    return failed(input.signal?.aborted ? 'cancelled' : timeout.aborted ? 'timeout' : 'unavailable');
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    return failed(response.status === 501 ? 'unimplemented' : response.status === 404 ? 'not-found' : 'unavailable');
  }
  try {
    const data = pipelineHeatRisk.parse(await readJson(response, signal));
    if (data.plot.plotCode !== input.plotCode || data.window.start !== `${input.season}-06-01`
      || data.window.end !== `${input.season}-10-31`) return failed('invalid-payload');
    const coverage = heatCoverage(data);
    const stale = input.requiredThrough && coverage.latestObservedDay && coverage.latestObservedDay < input.requiredThrough;
    return {
      status: stale ? 'stale' : coverage.nullDays || coverage.omittedDays ? 'partial' : 'available',
      data, coverage, fetchedAt: new Date().toISOString(),
    };
  } catch {
    return failed(input.signal?.aborted ? 'cancelled' : timeout.aborted ? 'timeout' : 'invalid-payload');
  }
}
