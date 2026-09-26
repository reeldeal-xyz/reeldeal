import { describe, expect, test } from 'bun:test';
import { selectHmiView } from '../src/lib/hmi-selection';

const plots = [
  { plotCode: '04-ku-1101', species: [] },
  { plotCode: '04-ku-1102', species: [] },
  { plotCode: 'p1213-001', species: ['scallop'] },
  { plotCode: 'p1213-002', species: ['scallop'] },
  { plotCode: 'p1213-009', species: ['hoya'] },
];

describe('shared HMI route and component selection', () => {
  test('species-less reference records cannot leave the default view empty', () => {
    const result = selectHmiView(plots, '', '');
    expect(result.plot?.plotCode).toBe('p1213-001');
    expect(result.species).toBe('scallop');
    expect(result.speciesPlots.map((plot) => plot.plotCode)).toEqual(['04-ku-1101', '04-ku-1102', 'p1213-001', 'p1213-002']);
  });

  test('unknown species is not attached to a reference licence', () => {
    const result = selectHmiView(plots, '04-ku-1101', '');
    expect(result.plot?.plotCode).toBe('04-ku-1101');
    expect(result.species).toBe('');
    expect(result.speciesPlots).toEqual(plots);
  });

  test('species filtering resolves a plot that actually supports it', () => {
    const result = selectHmiView(plots, 'p1213-001', 'hoya');
    expect(result.plot?.plotCode).toBe('p1213-009');
    expect(result.species).toBe('hoya');
    expect(result.speciesPlots.map((plot) => plot.plotCode)).toEqual(['04-ku-1101', '04-ku-1102', 'p1213-009']);
  });

  test('preserves explicit eligible selection and handles empty inventories', () => {
    expect(selectHmiView(plots, 'p1213-002', '').plot?.plotCode).toBe('p1213-002');
    expect(selectHmiView(plots.slice(0, 2), '', '').plot?.plotCode).toBe('04-ku-1101');
    expect(selectHmiView([], '', '')).toEqual({ plot: undefined, species: '', supportedSpecies: [], speciesPlots: [] });
  });
});
