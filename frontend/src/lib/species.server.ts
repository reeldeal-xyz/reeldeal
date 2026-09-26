import { SPECIES, pipelineSpeciesDetail, type PipelineSpeciesDetail } from '@repo/shared';
import { readJson } from './heat-risk.server';

type Failure = 'not-configured' | 'invalid-request' | 'not-found' | 'unimplemented' | 'unavailable'
  | 'timeout' | 'cancelled' | 'invalid-payload';
export type SpeciesResult =
  | { status: Failure; data: null }
  | { status: 'available'; data: PipelineSpeciesDetail };

/** GET /species/{id}: the species' profile, response evidence and trigger rules (reference values, never evaluated). */
export async function readSpecies(input: {
  origin: string | undefined;
  species: string;
  signal?: AbortSignal;
}, transport: (url: URL, init: RequestInit) => Promise<Response> = fetch): Promise<SpeciesResult> {
  const failed = (status: Failure): SpeciesResult => ({ status, data: null });
  if (!(SPECIES as readonly string[]).includes(input.species)) return failed('invalid-request');
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
  url.pathname = `${origin.pathname.replace(/\/$/, '')}/species/${encodeURIComponent(input.species)}`;
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
    const data = pipelineSpeciesDetail.parse(await readJson(response, signal));
    if (data.id !== input.species || data.rules.some((rule) => rule.species !== input.species)) return failed('invalid-payload');
    return { status: 'available', data };
  } catch {
    return failed(input.signal?.aborted ? 'cancelled' : timeout.aborted ? 'timeout' : 'invalid-payload');
  }
}
