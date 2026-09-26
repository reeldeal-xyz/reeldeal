// Pure helpers for the HMI farm-plots layer: styling, hover facts and which plot a view shows.
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

/**
 * The plot and species a page view shows, shared by the /hmi route (which fetches that plot's heat) and HmiScene
 * (which renders it), so both always agree. A species drives every panel, and most fishery-right plots have none
 * recorded: a requested plot without species, or none, falls back to the first plot that has one.
 */
export function selectHmiView<P extends { plotCode: string; species: string[] }>(plots: readonly P[], plotCode: string, requestedSpecies: string) {
  const supportedSpecies = [...new Set(plots.flatMap((item) => item.species))];
  const requestedPlot = plots.find((item) => item.plotCode === plotCode && item.species.length) ?? plots.find((item) => item.species.length);
  const species = supportedSpecies.includes(requestedSpecies) ? requestedSpecies : requestedPlot?.species[0] ?? '';
  const plot = requestedPlot?.species.includes(species) ? requestedPlot : plots.find((item) => item.species.includes(species));
  return { supportedSpecies, species, plot };
}
