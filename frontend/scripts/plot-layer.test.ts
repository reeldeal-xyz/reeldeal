import { describe, expect, test } from 'bun:test';
import { operationColor, plotFacts } from '../src/lib/plot-layer';

describe('HMI farm-plots layer', () => {
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
