import { describe, expect, test } from 'bun:test';
import { keccak256, toBytes } from 'viem';
import { eventIdOf, idOf, triggerEventId } from './ids';
import type { Trigger } from './trigger';

describe('idOf', () => {
  test('is keccak256 of the utf8 label, matching Solidity keccak256(bytes(label))', () => {
    expect(idOf('karakuwa-east')).toBe(keccak256(toBytes('karakuwa-east')));
  });
});

describe('eventIdOf', () => {
  test('is stable for the same inputs', () => {
    const a = eventIdOf('karakuwa-east', 'scallop', 'HEAT', 1, '2026');
    const b = eventIdOf('karakuwa-east', 'scallop', 'HEAT', 1, '2026');
    expect(a).toBe(b);
  });

  test('changes when any field changes (note: the HEAT temperature lives in Trigger.tempC, not the peril id, so a tempC-only change is NOT expected to change eventId)', () => {
    const base = eventIdOf('karakuwa-east', 'scallop', 'HEAT', 1, '2026');
    expect(eventIdOf('kesennuma-bay', 'scallop', 'HEAT', 1, '2026')).not.toBe(base);
    expect(eventIdOf('karakuwa-east', 'hoya', 'HEAT', 1, '2026')).not.toBe(base);
    expect(eventIdOf('karakuwa-east', 'scallop', 'BANWEEKS', 1, '2026')).not.toBe(base);
    expect(eventIdOf('karakuwa-east', 'scallop', 'HEAT', 2, '2026')).not.toBe(base);
    expect(eventIdOf('karakuwa-east', 'scallop', 'HEAT', 1, '2027')).not.toBe(base);
  });
});

describe('triggerEventId', () => {
  test('matches eventIdOf when the Trigger fields are the keccak256(label) ids eventIdOf would compute', () => {
    const trigger: Pick<Trigger, 'zoneId' | 'speciesId' | 'perilId' | 'tier' | 'seasonLabel'> = {
      zoneId: idOf('karakuwa-east'),
      speciesId: idOf('scallop'),
      perilId: idOf('HEAT'),
      tier: 2,
      seasonLabel: '2026',
    };
    expect(triggerEventId(trigger)).toBe(eventIdOf('karakuwa-east', 'scallop', 'HEAT', 2, '2026'));
  });

  test('works directly off a fetched/decoded Trigger without needing the original labels', () => {
    const fields = {
      zoneId: `0x${'11'.repeat(32)}` as const,
      speciesId: `0x${'22'.repeat(32)}` as const,
      perilId: `0x${'33'.repeat(32)}` as const,
      tier: 1,
      seasonLabel: '2026',
    };
    expect(triggerEventId(fields)).toBe(triggerEventId({ ...fields }));
  });
});
