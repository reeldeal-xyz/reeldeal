/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { hmiLayerDate } from '../src/lib/hmi-layer-date';

describe('hmiLayerDate', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  test('uses a conservative current-year NRT date instead of a future season end', () => {
    expect(hmiLayerDate('2026', now)).toBe('2026-09-23');
  });
  test('rejects malformed years and invalid clocks', () => {
    for (const season of ['26', ' 2026', '2026.0', '2026-01-01', '']) expect(() => hmiLayerDate(season, now)).toThrow();
    expect(() => hmiLayerDate('2026', new Date('invalid'))).toThrow();
    expect(hmiLayerDate('2026', new Date('2026-01-01T01:00:00Z'))).toBe('2026-01-01');
  });
  test('keeps historical seasons on the observation-season endpoint', () => {
    expect(hmiLayerDate('2025', now)).toBe('2025-10-31');
  });
  test('never turns a future season into a future raster request', () => {
    expect(() => hmiLayerDate('2027', now)).toThrow('future season');
  });
});
