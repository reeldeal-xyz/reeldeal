interface PlotChoice { plotCode: string; species: string[] }

export function selectHmiView<T extends PlotChoice>(plots: T[], plotCode: string, requestedSpecies: string) {
  const supportedSpecies = [...new Set(plots.flatMap((plot) => plot.species))];
  const requestedPlot = plots.find((plot) => plot.plotCode === plotCode)
    ?? plots.find((plot) => plot.species.length > 0) ?? plots[0];
  const species = supportedSpecies.includes(requestedSpecies) ? requestedSpecies : requestedPlot?.species[0] ?? '';
  const plot = !species || requestedPlot?.species.includes(species)
    ? requestedPlot : plots.find((item) => item.species.includes(species));
  const speciesPlots = species ? plots.filter((item) => item.species.includes(species) || !item.species.length) : plots;
  return { plot, species, supportedSpecies, speciesPlots };
}
