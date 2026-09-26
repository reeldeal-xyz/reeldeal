import { describe, expect, test } from 'bun:test';
import { operationColor, plotFacts, selectHmiView } from '../src/lib/plot-layer';

const plot = (plotCode: string, species: string[] = []) => ({ plotCode, species });

describe('HMI farm-plots layer', () => {
  test('describes a plot without species or sea area, and colours unknown operations as other', () => {
    const labels = {
      sources: { fishery_right: 'Licensed fishery-right polygon' }, operations: { cage: 'cage' }, species: { scallop: 'Scallop' },
      noSpecies: 'No species recorded', noSeaArea: 'Outside mapped sea areas', hectares: 'ha', locale: 'en-US',
    };
    const facts = { plotCode: '04-ku-1101', source: 'fishery_right', operation: 'cage', species: [], areaM2: 359_999.3, seaArea: null };
    expect(plotFacts(facts, labels)).toEqual([
      'Licensed fishery-right polygon', 'cage · 36 ha', 'No species recorded', 'Outside mapped sea areas',
    ]);
    expect(plotFacts({ ...facts, species: ['scallop', 'oyster'], seaArea: 'karakuwa-east', areaM2: 18_200 }, labels).slice(1))
      .toEqual(['cage · 1.82 ha', 'Scallop, oyster', 'karakuwa-east']);
    expect(operationColor('weir')).toBe(operationColor('other'));
  });

  test('defaults past species-less fishery-right plots to the first plot with a species', () => {
    // The live inventory lists 04-ku-* first, and almost none of them record species.
    const plots = [plot('04-ku-1101'), plot('04-ku-1102'), plot('p1213-001', ['scallop']), plot('p1213-002', ['oyster'])];
    expect(selectHmiView(plots, '', '')).toMatchObject({ species: 'scallop', plot: { plotCode: 'p1213-001' } });
    // A requested plot without species, e.g. an old link, gets the same fallback instead of an empty view.
    expect(selectHmiView(plots, '04-ku-1102', '')).toMatchObject({ species: 'scallop', plot: { plotCode: 'p1213-001' } });
    expect(selectHmiView(plots, 'p1213-002', '')).toMatchObject({ species: 'oyster', plot: { plotCode: 'p1213-002' } });
    expect(selectHmiView(plots, '', 'oyster')).toMatchObject({ species: 'oyster', plot: { plotCode: 'p1213-002' } });
    expect(selectHmiView(plots, '', '').supportedSpecies).toEqual(['scallop', 'oyster']);
    expect(selectHmiView([plot('04-ku-1101')], '', '')).toMatchObject({ species: '', plot: undefined });
  });
});
