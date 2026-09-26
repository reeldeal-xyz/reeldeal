// Demo plot list for the co-op/holder screens (issues #19/#20). Issue #16 ("Deploy to public Sepolia") creates
// the real 15 plots (8 scallop, 4 hoya, 3 oyster) in karakuwa-east and their 2026 season slots on-chain — this
// file is a placeholder so the table/QR/CSV UI has real shape before that lands. TODO(#16): once addresses are
// committed, swap this for the deployed plot list (ideally re-exported from packages/shared alongside DEPLOYED).
//
// Deliberately has NO database import: this file is pulled into the browser bundle (coop-screen.tsx,
// liff-app.tsx, use-plot-table.ts are all 'use client' and import `DEMO_PLOTS` at module scope), and the
// Postgres driver depends on Node built-ins (tls, net, perf_hooks) that don't exist in a browser bundle.
// The DB-backed accessor lives in ./plots.server.ts instead -- server-only code (Server Components,
// Route Handlers) imports that file, never this one's DEMO_PLOTS consumers.
import type { Species, Zone } from '@repo/shared';

export interface DemoPlot {
  plotLabel: string;
  zone: Zone;
  species: Species;
}

export const ZONE: Zone = 'karakuwa-east';

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

/** Base LIFF deep link with no plot param, for generic prompts (e.g. Jev intent-routing replies, docs/JEV.md). */
export const LIFF_BASE_URL = 'https://liff.line.me/2011749457-SgvM5ahH';

// ENS display names (sponsor-polish task): the real registered hierarchy, confirmed in docs/INTERFACE.md
// and contracts/script/DeployEnsBranch.s.sol/DeployReelDeal.s.sol -- `umi.eth` (parent, ETHRegistrar) ->
// `karakuwa.umi.eth` (branch registry/resolver, issue #7) -> `p1213-NNN.karakuwa.umi.eth` (per-plot, x15).
// Display-only: web/src/lib/ens-adapter.ts's getPlotDnsName (the DNS-wire encoding used by setText/
// setAddress writes) still carries its own TODO(#7) placeholder name and is intentionally untouched here
// -- changing the write path's node encoding is out of scope for this UI-polish task.
export const ENS_PARENT_NAME = 'umi.eth';
export const ENS_BRANCH_NAME = `karakuwa.${ENS_PARENT_NAME}`;
export const ensNameForPlot = (plotLabel: string): string => `${plotLabel}.${ENS_BRANCH_NAME}`;
