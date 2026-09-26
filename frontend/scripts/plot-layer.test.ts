import { describe, expect, test } from 'bun:test';
import { validAreaPolygon } from '../src/lib/area-polygon';
import { operationColor, plotFacts, sampleRing } from '../src/lib/plot-layer';

const bounds = { west: 140.5, south: 37.2, east: 143.1, north: 40.5 };
const square = (x: number, y: number, size = 0.01): [number, number][] =>
  [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];

describe('HMI farm-plots layer', () => {
  test('samples a MultiPolygon as one convex ring the area endpoint accepts', () => {
    const ring = sampleRing({ type: 'MultiPolygon', coordinates: [[square(141.6, 38.8)], [square(141.63, 38.82)]] });
    expect(ring).not.toBeNull();
    expect(ring![0]).toEqual(ring!.at(-1)!);
    expect(validAreaPolygon([ring], bounds)).toBe(true);
    // Both parts are inside the hull: its corners are the outer corners of the two squares.
    expect(ring).toContainEqual([141.6, 38.8]);
    expect(ring).toContainEqual([141.64, 38.83]);
  });

  test('drops holes and concave notches, and keeps a many-vertex outline within the 250-point limit', () => {
    const notch: [number, number][] = [[141.6, 38.8], [141.62, 38.8], [141.61, 38.805], [141.62, 38.81], [141.6, 38.81], [141.6, 38.8]];
    const hull = sampleRing({ type: 'Polygon', coordinates: [notch, square(141.605, 38.802, 0.001)] });
    expect(hull).toHaveLength(5);
    expect(validAreaPolygon([hull], bounds)).toBe(true);

    const circle = Array.from({ length: 600 }, (_, i) => {
      const angle = (i / 600) * 2 * Math.PI;
      return [141.6 + 0.01 * Math.cos(angle), 38.8 + 0.01 * Math.sin(angle)] as [number, number];
    });
    const ring = sampleRing({ type: 'Polygon', coordinates: [[...circle, circle[0]]] });
    expect(ring!.length).toBeLessThanOrEqual(250);
    expect(validAreaPolygon([ring], bounds)).toBe(true);
  });

  test('returns null for a degenerate shape instead of a ring the endpoint would reject', () => {
    expect(sampleRing({ type: 'Polygon', coordinates: [[[141.6, 38.8], [141.61, 38.8], [141.62, 38.8], [141.6, 38.8]]] })).toBeNull();
    expect(sampleRing({ type: 'MultiPolygon', coordinates: [] })).toBeNull();
  });

  test('describes a plot without species or sea area, and colours unknown operations as other', () => {
    const labels = {
      sources: { fishery_right: 'Licensed fishery-right polygon' }, operations: { cage: 'cage' }, species: { scallop: 'Scallop' },
      noSpecies: 'No species recorded', noSeaArea: 'Outside mapped sea areas', hectares: 'ha', locale: 'en-US',
    };
    const plot = { plotCode: '04-ku-1101', source: 'fishery_right', operation: 'cage', species: [], areaM2: 359_999.3, seaArea: null };
    expect(plotFacts(plot, labels)).toEqual([
      'Licensed fishery-right polygon', 'cage · 36 ha', 'No species recorded', 'Outside mapped sea areas',
    ]);
    expect(plotFacts({ ...plot, species: ['scallop', 'oyster'], seaArea: 'karakuwa-east', areaM2: 18_200 }, labels).slice(1))
      .toEqual(['cage · 1.82 ha', 'Scallop, oyster', 'karakuwa-east']);
    expect(operationColor('weir')).toBe(operationColor('other'));
  });
});
