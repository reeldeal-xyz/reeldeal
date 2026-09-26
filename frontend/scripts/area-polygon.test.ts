import { describe, expect, test } from 'bun:test';
import { validAreaPolygon } from '../src/lib/area-polygon';

const bounds = { west: 140.5, south: 37.2, east: 143.1, north: 40.5 };
const outer = [[141, 38], [142, 38], [142, 39], [141, 39], [141, 38]];

describe('area polygon boundary validation', () => {
  test('accepts a closed polygon and an interior hole', () => {
    expect(validAreaPolygon([outer], bounds)).toBe(true);
    expect(validAreaPolygon([outer, [[141.2, 38.2], [141.2, 38.4], [141.4, 38.4], [141.4, 38.2], [141.2, 38.2]]], bounds)).toBe(true);
  });

  test('rejects self-intersections, open rings, and out-of-bounds holes', () => {
    expect(validAreaPolygon([[[141, 38], [142, 39], [141, 39], [142, 38], [141, 38]]], bounds)).toBe(false);
    expect(validAreaPolygon([outer.slice(0, -1)], bounds)).toBe(false);
    expect(validAreaPolygon([outer, [[142.5, 40], [142.5, 40.1], [142.6, 40.1], [142.6, 40], [142.5, 40]]], bounds)).toBe(false);
  });

  test('rejects crossing holes and oversized polygon payloads', () => {
    const crossing = [[141.5, 38.2], [142.1, 38.2], [142.1, 38.4], [141.5, 38.4], [141.5, 38.2]];
    expect(validAreaPolygon([outer, crossing], bounds)).toBe(false);
    expect(validAreaPolygon([Array.from({ length: 251 }, (_, i) => [141 + i / 1000, 38])], bounds)).toBe(false);
  });
});
