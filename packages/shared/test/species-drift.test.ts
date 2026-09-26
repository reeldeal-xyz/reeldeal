// src/species.data.json is generated from pipeline/data/ref/species.json (canonical). If this fails, run
// `bun run species:gen` and commit both files; a rule change also needs a rules_version bump there.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { GENERATED, readCanonical, speciesData } from '../scripts/gen-species';
import { SPECIES } from '../src/ids';
import { HEAT_WINDOW, RULES, RULES_VERSION } from '../src/rules';

test('species.data.json matches the pipeline species.json', () => {
  expect(readFileSync(GENERATED, 'utf8')).toBe(speciesData(readCanonical()));
});

test('SPECIES lists the canonical species ids, in order', () => {
  expect<string[]>([...SPECIES]).toEqual(readCanonical().species.map((s) => s.id));
});

test('RULES and RULES_VERSION come from the canonical file', () => {
  const canonical = readCanonical();
  expect(RULES).toEqual(canonical.rules as unknown as typeof RULES);
  expect(RULES_VERSION).toBe(canonical.rules_version);
  expect(HEAT_WINDOW).toEqual({ start: '07-01', end: '09-30' });
});
