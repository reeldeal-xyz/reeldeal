import { expect, test } from 'bun:test';
import { RULES, REFERENCE_FIRES } from '@repo/shared';
test('rules and regression targets are defined', () => {
  expect(RULES.length).toBeGreaterThan(0);
  expect(REFERENCE_FIRES['2023']['scallop:2']).toBe('2023-08-11');
});
