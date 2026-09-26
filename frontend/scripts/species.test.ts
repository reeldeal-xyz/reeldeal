/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readSpecies } from '../src/lib/species.server';

const input = { origin: 'https://pipeline.example.test/v1', species: 'scallop' };
const window = { start: '07-01', end: '09-30' };
const payload = () => ({
  id: 'scallop', name: 'Yesso scallop', nameJa: 'ホタテガイ', group: 'shellfish', taxon: 'Mizuhopecten yessoensis',
  hazards: ['heat', 'hab', 'storm'],
  evidence: [{
    id: 'scallop-temperature-2014', url: 'https://link.springer.com/article/10.1007/s10499-014-9788-0',
    factors: ['temperature'], access: 'abstract', lifeStage: null, size: null, exposure: null, endpoint: null,
    testedRange: null, xUnit: null, yUnit: null, points: [], note: 'Abstract only.', status: 'no_supported_data',
  }],
  kind: 'reference', profile_version: 'species-profiles-0.1.0', rules_version: 'rules-0.1.0',
  rules: [
    { species: 'scallop', tier: 1, peril: 'HEAT', tempC: 25, threshold: 14, window },
    { species: 'scallop', tier: 1, peril: 'BANWEEKS', tempC: null, threshold: 4, window: null },
  ],
});
const read = (data: unknown, init?: ResponseInit) => readSpecies(input, async () => Response.json(data, init));

describe('species reference consumer', () => {
  test('reads the profile, evidence status and rules for the requested species', async () => {
    let requested = '';
    const result = await readSpecies(input, async (url) => { requested = url.href; return Response.json(payload()); });
    expect(requested).toBe('https://pipeline.example.test/v1/species/scallop');
    expect(result.status).toBe('available');
    expect(result.data?.rules.map((r) => r.tempC)).toEqual([25, null]);
    expect(result.data?.evidence[0]?.status).toBe('no_supported_data');
  });

  test('maps pipeline and request failures without inventing data', async () => {
    expect(await read({ detail: 'unknown species' }, { status: 404 })).toEqual({ status: 'not-found', data: null });
    expect(await read({}, { status: 501 })).toEqual({ status: 'unimplemented', data: null });
    expect(await readSpecies({ ...input, species: 'tuna' })).toEqual({ status: 'invalid-request', data: null });
    expect(await readSpecies({ ...input, origin: undefined })).toEqual({ status: 'not-configured', data: null });
  });

  test('rejects another species, fitted curves, inconsistent statuses and malformed rules', async () => {
    const mutations = [
      (p: any) => { p.id = 'hoya'; },
      (p: any) => { p.rules[0].species = 'hoya'; },
      (p: any) => { p.rules[0].tempC = null; },
      (p: any) => { p.rules[1].tempC = 20; },
      (p: any) => { p.evidence[0].status = 'measured'; },
      (p: any) => { p.evidence[0].curve = { a: 1, b: 2 }; },
      (p: any) => { p.kind = 'advisory'; },
    ];
    for (const mutate of mutations) {
      const data = payload(); mutate(data);
      expect(await read(data)).toEqual({ status: 'invalid-payload', data: null });
    }
  });
});
