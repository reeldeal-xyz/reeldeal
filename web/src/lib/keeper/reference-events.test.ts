import { describe, expect, test } from 'bun:test';
import { REFERENCE_FIRES } from '@repo/shared';
import { getReferenceEvent, REFERENCE_EVENTS, REPLAY_REFERENCE_EVENTS, ruleForReferenceEvent } from './reference-events';

describe('REPLAY_REFERENCE_EVENTS', () => {
  test('every REFERENCE_FIRES entry has a matching reference event, and vice versa', () => {
    const fireKeys = new Set<string>();
    for (const [season, fires] of Object.entries(REFERENCE_FIRES)) {
      for (const label of Object.keys(fires)) {
        fireKeys.add(`${season}:${label}`); // e.g. "2023:scallop:2"
      }
    }
    const eventKeys = new Set(REPLAY_REFERENCE_EVENTS.map((r) => `${r.dataSeason}:${r.species}:${r.tier}`));
    expect(eventKeys).toEqual(fireKeys);
  });

  test('ids are unique and match "<dataSeason>-<species>-tier<tier>"', () => {
    const ids = REPLAY_REFERENCE_EVENTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const ref of REPLAY_REFERENCE_EVENTS) {
      expect(ref.id).toBe(`${ref.dataSeason}-${ref.species}-tier${ref.tier}`);
    }
  });

  test('firedOn matches REFERENCE_FIRES exactly', () => {
    for (const ref of REPLAY_REFERENCE_EVENTS) {
      const seasonFires = REFERENCE_FIRES[ref.dataSeason as keyof typeof REFERENCE_FIRES] as Record<string, string>;
      expect(seasonFires[`${ref.species}:${ref.tier}`]).toBe(ref.firedOn);
    }
  });

  test('every replay event fires the HEAT peril (the regression is heat-only)', () => {
    for (const ref of REPLAY_REFERENCE_EVENTS) {
      expect(ref.peril).toBe('HEAT');
    }
  });
});

describe('REFERENCE_EVENTS', () => {
  test('all reference events pay the 2026 season slot', () => {
    for (const ref of REFERENCE_EVENTS) {
      expect(ref.payoutSeasonLabel).toBe('2026');
    }
  });

  test('ids are unique', () => {
    const ids = REFERENCE_EVENTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('includes every replay event plus the 2026 BANWEEKS demo event', () => {
    expect(REFERENCE_EVENTS.length).toBe(REPLAY_REFERENCE_EVENTS.length + 1);
    const banweeks = REFERENCE_EVENTS.find((r) => r.id === '2026-scallop-banweeks-karakuwa');
    expect(banweeks).toBeDefined();
    expect(banweeks?.zone).toBe('karakuwa-east');
    expect(banweeks?.species).toBe('scallop');
    expect(banweeks?.peril).toBe('BANWEEKS');
    expect(banweeks?.tier).toBe(1);
    expect(banweeks?.dataSeason).toBe('2026');
    expect(banweeks?.firedOn).toBe('2026-06-02');
  });
});

describe('getReferenceEvent', () => {
  test('returns the known 2023 scallop tier-2 event (issue #17 "Done when")', () => {
    const ref = getReferenceEvent('2023-scallop-tier2');
    expect(ref.zone).toBe('karakuwa-east');
    expect(ref.species).toBe('scallop');
    expect(ref.tier).toBe(2);
    expect(ref.peril).toBe('HEAT'); // was HEAT26 pre-v2; the temperature (26) now lives in the rule's tempC
    expect(ref.firedOn).toBe('2023-08-14');
  });

  test('returns the 2026 scallop BANWEEKS demo event (issue #32)', () => {
    const ref = getReferenceEvent('2026-scallop-banweeks-karakuwa');
    expect(ref.peril).toBe('BANWEEKS');
    expect(ref.tier).toBe(1);
    expect(ref.firedOn).toBe('2026-06-02');
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
