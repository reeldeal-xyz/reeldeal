// Demo plot list for the co-op/holder screens (issues #19/#20). Issue #16 ("Deploy to public Sepolia") creates
// the real 15 plots (8 scallop, 4 hoya, 3 oyster) in karakuwa-east and their 2026 season slots on-chain — this
// file is a placeholder so the table/QR/CSV UI has real shape before that lands. TODO(#16): once addresses are
// committed, swap this for the deployed plot list (ideally re-exported from packages/shared alongside DEPLOYED).
import type { Species, Zone } from '@repo/shared';

export interface DemoPlot {
  plotLabel: string;
  zone: Zone;
  species: Species;
}

const ZONE: Zone = 'karakuwa-east';

const speciesForIndex = (i: number): Species => {
  if (i < 8) return 'scallop'; // p1213-001..008
  if (i < 12) return 'hoya'; // p1213-009..012
  return 'oyster'; // p1213-013..015
};

export const SEASON_LABEL = '2026';

export const DEMO_PLOTS: readonly DemoPlot[] = Array.from({ length: 15 }, (_, i) => ({
  plotLabel: `p1213-${String(i + 1).padStart(3, '0')}`,
  zone: ZONE,
  species: speciesForIndex(i),
}));

/** LIFF deep link a farmer scans to open their plot in the LINE app (see issue #13/#14). */
export const liffPlotUrl = (plotLabel: string): string => `https://liff.line.me/2011749457-SgvM5ahH?plot=${encodeURIComponent(plotLabel)}`;
