import { describe, expect, test } from 'bun:test';
import { operationColor, plotAreaName, plotFacts, plotSpecies, speciesColor } from '../src/lib/plot-layer';

describe('HMI farm-plots layer', () => {
  test('species colours distinguish farms without inventing species for unrecorded or mixed plots', () => {
    expect(new Set(['oyster', 'hoya', 'scallop'].map((species) => speciesColor([species]))).size).toBe(3);
    expect(speciesColor([])).toBe(speciesColor(['unknown']));
    expect(plotSpecies(['oyster', 'oyster'])).toBe('oyster');
    expect(plotSpecies(['oyster', 'hoya'])).toBe('mixed');
    expect(speciesColor(['hoya', 'oyster'])).toBe(speciesColor(['oyster', 'hoya']));
  });
  test('describes a plot without species or sea area, and colours unknown operations as other', () => {
    const labels = {
      sources: { fishery_right: 'Licensed fishery-right polygon' }, operations: { cage: 'cage' }, species: { scallop: 'Scallop' },
      noSpecies: 'No species recorded', noSeaArea: 'Outside mapped sea areas', hectares: 'ha', locale: 'en-US',
    };
    const plot = { plotCode: '04-ku-1101', source: 'fishery_right', operation: 'cage', species: [], areaM2: 359_999.3, seaArea: null };
    expect(plotFacts(plot, labels)).toEqual(['cage · 36 ha']);
    expect(plotFacts({ ...plot, operation: null }, labels)).toEqual(['36 ha']);
    expect(plotFacts({ ...plot, species: ['scallop', 'oyster'], seaArea: 'karakuwa-east', areaM2: 18_200 }, labels))
      .toEqual(['Scallop, oyster', 'cage · 1.82 ha']);
    expect(plotAreaName('kesennuma-bay', labels)).toBe('Kesennuma Bay');
    expect(plotAreaName(null, labels)).toBeNull();
    expect(operationColor('weir')).toBe(operationColor('other'));
  });
});
