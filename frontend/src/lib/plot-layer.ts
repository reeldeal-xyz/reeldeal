export const OPERATION_COLORS: Record<string, string> = {
  longline: '#f7a32f', raft: '#e56b6f', cage: '#39b7a5', other: '#c9c9c9',
};
export const operationColor = (operation: string) => OPERATION_COLORS[operation] ?? OPERATION_COLORS.other;

export type PlotFacts = {
  plotCode: string; source: string; operation: string; species: string[]; areaM2: number; seaArea: string | null;
};
export type PlotLabels = {
  sources: Record<string, string>; operations: Record<string, string>; species: Record<string, string>;
  noSpecies: string; noSeaArea: string; hectares: string; locale: string;
};

/** Hover lines for a plot, in display order; the plot code is the tooltip title. */
export function plotFacts(plot: PlotFacts, labels: PlotLabels): string[] {
  const hectares = (plot.areaM2 / 10_000).toLocaleString(labels.locale, { maximumFractionDigits: plot.areaM2 < 100_000 ? 2 : 1 });
  return [
    labels.sources[plot.source] ?? plot.source,
    [labels.operations[plot.operation] ?? plot.operation, `${hectares} ${labels.hectares}`].join(' · '),
    plot.species.length ? plot.species.map((item) => labels.species[item] ?? item).join(', ') : labels.noSpecies,
    plot.seaArea ?? labels.noSeaArea,
  ];
}
