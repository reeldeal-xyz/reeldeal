import { describe, expect, test } from 'bun:test';
import type { Hex } from 'viem';
import { idOf, type TriggerJson } from '@repo/shared';
import { buildFallbackTrigger, triggerFromJson } from './trigger-codec';
import { getReferenceEvent, ruleForReferenceEvent } from './reference-events';

describe('triggerFromJson', () => {
  test('converts string bigints and preserves every field', () => {
    const json: TriggerJson = {
      zoneId: idOf('karakuwa-east'),
      speciesId: idOf('scallop'),
      perilId: idOf('HEAT'),
      tier: 1,
      seasonLabel: '2026',
      windowStart: '1000',
      windowEnd: '2000',
      firedAt: '1500',
      index: 20,
      threshold: 14,
      tempC: 25,
      dataHash: idOf('fixture'),
      deadline: '9999999999',
    };
    const trigger = triggerFromJson(json);
    expect(trigger.windowStart).toBe(1000n);
    expect(trigger.windowEnd).toBe(2000n);
    expect(trigger.firedAt).toBe(1500n);
    expect(trigger.deadline).toBe(9999999999n);
    expect(trigger.zoneId).toBe(json.zoneId as Hex);
    expect(trigger.tier).toBe(1);
    expect(trigger.index).toBe(20);
    expect(trigger.tempC).toBe(25);
  });
});

describe('buildFallbackTrigger', () => {
  test('matches the reference event and rule for 2023 scallop tier 2', () => {
    const ref = getReferenceEvent('2023-scallop-tier2');
    const rule = ruleForReferenceEvent(ref);
    const trigger = buildFallbackTrigger(ref.id);

    expect(trigger.zoneId).toBe(idOf(ref.zone));
    expect(trigger.speciesId).toBe(idOf(ref.species));
    expect(trigger.perilId).toBe(idOf(ref.peril));
    expect(trigger.tier).toBe(ref.tier);
    expect(trigger.seasonLabel).toBe('2026');
    expect(trigger.index).toBe(rule.threshold);
    expect(trigger.threshold).toBe(rule.threshold);
    // 2023-08-14T00:00:00Z
    expect(trigger.firedAt).toBe(1691971200n);
  });

  test('window covers the whole 07-01..09-30 range inclusive', () => {
    const trigger = buildFallbackTrigger('2023-scallop-tier2');
    expect(trigger.windowStart).toBe(BigInt(Date.parse('2023-07-01T00:00:00Z') / 1000));
    // end is exclusive-of-boundary -> the instant after 09-30, i.e. 10-01T00:00:00Z
    expect(trigger.windowEnd).toBe(BigInt(Date.parse('2023-10-01T00:00:00Z') / 1000));
  });

  test('deadline is in the future relative to the injected clock', () => {
    const now = () => Date.parse('2026-01-01T00:00:00Z');
    const trigger = buildFallbackTrigger('2023-scallop-tier2', { now, deadlineSeconds: 60 });
    expect(trigger.deadline).toBe(BigInt(Date.parse('2026-01-01T00:00:00Z') / 1000 + 60));
  });

  test('index equals threshold (fallback has no real satellite data) and is clearly a marker dataHash', () => {
    const trigger = buildFallbackTrigger('2023-hoya-tier1');
    expect(trigger.index).toBe(trigger.threshold);
    expect(trigger.dataHash).not.toBe('0x');
  });

  test('throws for an unknown reference event id', () => {
    expect(() => buildFallbackTrigger('nonsense')).toThrow();
  });

  test('sets tempC from the rule for a HEAT reference event', () => {
    const trigger = buildFallbackTrigger('2023-scallop-tier2');
    expect(trigger.tempC).toBe(26); // RULES: scallop tier 2
  });

  test('sets tempC to 0 for a non-HEAT (BANWEEKS) reference event, and collapses the window to firedOn', () => {
    const trigger = buildFallbackTrigger('2026-scallop-banweeks-karakuwa');
    expect(trigger.tempC).toBe(0);
    expect(trigger.threshold).toBe(4);
    expect(trigger.index).toBe(4);
    // BANWEEKS carries no rules.ts window -- windowStart/windowEnd both collapse to firedOn (2026-06-02).
    expect(trigger.windowStart).toBe(BigInt(Date.parse('2026-06-02T00:00:00Z') / 1000));
    expect(trigger.windowEnd).toBe(trigger.windowStart);
    expect(trigger.firedAt).toBe(trigger.windowStart);
  });
});
