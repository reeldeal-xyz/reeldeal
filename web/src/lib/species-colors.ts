import type { Species } from '@repo/shared';

/** Shared species -> color mapping for plot markers, legends, and chart lines (map + verify routes). */
export const SPECIES_COLOR: Record<Species, string> = {
  scallop: '#3df0c9', // bioluminescent cyan — the signature accent, and the season's headline species
  hoya: '#f2b84a', // amber
  oyster: '#c084fc', // violet
};

export const SPECIES_LABEL: Record<Species, string> = {
  scallop: 'Scallop',
  hoya: 'Sea pineapple (hoya)',
  oyster: 'Oyster',
};
