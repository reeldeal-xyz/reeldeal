import type { Species } from '@repo/shared';

/** Shared species -> color mapping for plot markers, legends, and chart lines (map + verify routes).
 *  National SPECIES (#55): grouped by kind -- seaweed (green family), shellfish (the original cyan/
 *  amber/violet trio), finfish (blue/red/pink family) -- so related species read as a family at a glance. */
export const SPECIES_COLOR: Record<Species, string> = {
  // seaweed
  nori: '#4ade80', // green
  wakame: '#22c55e', // deeper green
  kombu: '#15803d', // darkest green
  // shellfish
  scallop: '#3df0c9', // bioluminescent cyan — the signature accent, and the season's headline species
  oyster: '#c084fc', // violet
  hoya: '#f2b84a', // amber
  // finfish
  yellowtail: '#60a5fa', // blue
  'sea-bream': '#f472b6', // pink
  salmon: '#fb7185', // salmon-red
  'bluefin-tuna': '#1e40af', // deep blue
};

export const SPECIES_LABEL: Record<Species, string> = {
  nori: 'Nori (seaweed)',
  wakame: 'Wakame (seaweed)',
  kombu: 'Kombu (seaweed)',
  scallop: 'Scallop',
  oyster: 'Oyster',
  hoya: 'Sea pineapple (hoya)',
  yellowtail: 'Yellowtail',
  'sea-bream': 'Sea bream',
  salmon: 'Salmon',
  'bluefin-tuna': 'Bluefin tuna',
};
