import { describe, expect, test } from 'bun:test';
import { REFERENCE_FIRES } from '@repo/shared';
import { getReferenceEvent, REFERENCE_EVENTS, ruleForReferenceEvent } from './reference-events';

describe('REFERENCE_EVENTS', () => {
  test('every REFERENCE_FIRES entry has a matching reference event, and vice versa', () => {
    const fireKeys = new Set<string>();
    for (const [season, fires] of Object.entries(REFERENCE_FIRES)) {
      for (const label of Object.keys(fires)) {
        fireKeys.add(`${season}:${label}`); // e.g. "2023:scallop:2"
      }
    }
    const eventKeys = new Set(REFERENCE_EVENTS.map((r) => `${r.dataSeason}:${r.species}:${r.tier}`));
    expect(eventKeys).toEqual(fireKeys);
  });

  test('all reference events pay the 2026 season slot', () => {
    for (const ref of REFERENCE_EVENTS) {
      expect(ref.payoutSeasonLabel).toBe('2026');
    }
  });

  test('ids are unique and match "<dataSeason>-<species>-tier<tier>"', () => {
    const ids = REFERENCE_EVENTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const ref of REFERENCE_EVENTS) {
      expect(ref.id).toBe(`${ref.dataSeason}-${ref.species}-tier${ref.tier}`);
    }
  });

  test('firedOn matches REFERENCE_FIRES exactly', () => {
    for (const ref of REFERENCE_EVENTS) {
      const seasonFires = REFERENCE_FIRES[ref.dataSeason as keyof typeof REFERENCE_FIRES] as Record<string, string>;
      expect(seasonFires[`${ref.species}:${ref.tier}`]).toBe(ref.firedOn);
    }
  });
});

describe('getReferenceEvent', () => {
  test('returns the known 2023 scallop tier-2 event (issue #17 "Done when")', () => {
    const ref = getReferenceEvent('2023-scallop-tier2');
    expect(ref.zone).toBe('karakuwa-east');
    expect(ref.species).toBe('scallop');
    expect(ref.tier).toBe(2);
    expect(ref.peril).toBe('HEAT26');
    expect(ref.firedOn).toBe('2023-08-11');
  });

  test('throws with the list of known ids for an unknown id', () => {
    expect(() => getReferenceEvent('nope')).toThrow(/unknown reference event "nope"/);
  });
});

describe('ruleForReferenceEvent', () => {
  test('finds the RULES entry for every reference event', () => {
    for (const ref of REFERENCE_EVENTS) {
      const rule = ruleForReferenceEvent(ref);
      expect(rule.species).toBe(ref.species);
      expect(rule.tier).toBe(ref.tier);
      expect(rule.peril).toBe(ref.peril);
      expect(rule.threshold).toBeGreaterThan(0);
    }
  });
});
