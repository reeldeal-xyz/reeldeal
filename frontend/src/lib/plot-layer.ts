export const OPERATION_COLORS: Record<string, string> = {
  longline: '#f7a32f', raft: '#e56b6f', cage: '#39b7a5', other: '#c9c9c9',
};
export const operationColor = (operation: string) => OPERATION_COLORS[operation] ?? OPERATION_COLORS.other;

export const SPECIES_COLORS: Record<string, string> = {
  scallop: '#efb438', oyster: '#af8ee8', hoya: '#f07958',
  nori: '#56b4a0', wakame: '#8ac95e', kombu: '#c9da72',
  yellowtail: '#f4da69', 'sea-bream': '#e896ba', salmon: '#e26191', 'bluefin-tuna': '#59b9e3',
  mixed: '#c4d8ec', unassigned: '#aeb8b8',
};
export const plotSpecies = (species: readonly string[]) => {
  const unique = [...new Set(species)];
  return unique.length > 1 ? 'mixed' : unique[0] || 'unassigned';
};
export const speciesColor = (species: readonly string[]) => {
  const key = plotSpecies(species);
  return SPECIES_COLORS[key === 'hotate' ? 'scallop' : key] ?? SPECIES_COLORS.unassigned;
};

export type PlotFacts = {
  plotCode: string; source: string; operation: string | null; species: string[]; areaM2: number; seaArea: string | null;
};
export type PlotLabels = {
  sources: Record<string, string>; operations: Record<string, string>; species: Record<string, string>;
  noSpecies: string; noSeaArea: string; hectares: string; locale: string;
  seaAreas?: Record<string, string>;
};

export const plotAreaName = (seaArea: string | null, labels: PlotLabels) => seaArea
  ? labels.seaAreas?.[seaArea] ?? seaArea.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : null;

/** Hover lines for a plot, in display order; the plot code is the tooltip title. */
export function plotFacts(plot: PlotFacts, labels: PlotLabels): string[] {
  const hectares = (plot.areaM2 / 10_000).toLocaleString(labels.locale, { maximumFractionDigits: plot.areaM2 < 100_000 ? 2 : 1 });
  return [
    ...(plot.species.length ? [plot.species.map((item) => labels.species[item] ?? item).join(', ')] : []),
    [plot.operation ? labels.operations[plot.operation] ?? plot.operation : '', `${hectares} ${labels.hectares}`].filter(Boolean).join(' · '),
  ];
}
