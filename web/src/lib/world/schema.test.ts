import { describe, expect, test } from 'bun:test';
import { actionForLevel, identifiersForLevel, levelForSchema } from './schema';

process.env.WORLD_ACTION = 'bind-payout-wallet';
process.env.WORLD_ACTION_L2 = 'upgrade-level-2';

describe('levelForSchema', () => {
  test('11 maps to level 1 (Selfie Check)', () => {
    expect(levelForSchema(11)).toBe(1);
  });

  test('1, 9303, 9310 map to level 2', () => {
    expect(levelForSchema(1)).toBe(2);
    expect(levelForSchema(9303)).toBe(2);
    expect(levelForSchema(9310)).toBe(2);
  });

  test('unknown schemas map to null', () => {
    expect(levelForSchema(0)).toBeNull();
    expect(levelForSchema(42)).toBeNull();
  });
});

describe('actionForLevel', () => {
  test('reads WORLD_ACTION for level1 and WORLD_ACTION_L2 for level2', () => {
    expect(actionForLevel('level1')).toBe('bind-payout-wallet');
    expect(actionForLevel('level2')).toBe('upgrade-level-2');
  });
});

describe('identifiersForLevel', () => {
  test('level1 is selfie only; level2 is mnc/passport/proof_of_human', () => {
    expect(identifiersForLevel('level1')).toEqual(['selfie']);
    expect(identifiersForLevel('level2')).toEqual(['mnc', 'passport', 'proof_of_human']);
  });
});
