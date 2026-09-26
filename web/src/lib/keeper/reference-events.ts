// Reference replay events (issue #17: "Replay mode: 2023 -> 2024 -> 2025 against the 2026 registry").
//
// Each entry names one rule firing from packages/shared/src/rules.ts REFERENCE_FIRES, at the
// karakuwa-east reference point (38.85N 141.66E) used throughout the pipeline regression. All of them
// pay the "2026" season slots (docs/INTERFACE.md: "Seasons for the replay: 2022, 2023, 2024, 2025 (July
// to September data), all paying the 2026 season slots") even though the *data* season (when the rule
// fired) is 2023/2024/2025.
//
// `id` is what both the CLI (`bun run keeper -- --event <id>`) and POST /api/keeper/replay take, e.g.
// "2023-scallop-tier2" for the 2023 scallop tier-2 fire the issue's "Done when" calls out by name.
import type { Peril, Species, Zone } from '@repo/shared';
import { RULES, type Rule } from '@repo/shared';

export interface ReferenceEvent {
  id: string;
  zone: Zone;
  species: Species;
  peril: Peril;
  tier: 1 | 2;
  /** The historical data year the rule fired in (feed lookup: GET /triggers/:zone/:dataSeason). */
  dataSeason: string;
  /** The season slot actually paid -- always "2026" for this demo (see module docstring). */
  payoutSeasonLabel: string;
  /** YYYY-MM-DD the index crossed the threshold, per packages/shared/src/rules.ts REFERENCE_FIRES. */
  firedOn: string;
}

const PAYOUT_SEASON_LABEL = '2026';
const ZONE: Zone = 'karakuwa-east';

// Mirrors packages/shared/src/rules.ts REFERENCE_FIRES exactly (species:tier -> firedOn), with the peril
// each fire's rule actually uses -- kept explicit rather than derived, since RULES has two entries for
// (species: 'scallop', tier: 1) on different perils (HEAT25 and BANWEEKS) and REFERENCE_FIRES doesn't
// disambiguate by peril. All reference fires are heat-index fires (the regression's only computed index).
const REFERENCE_EVENT_DEFS: ReadonlyArray<{
  dataSeason: string;
  species: Species;
  tier: 1 | 2;
  peril: Peril;
  firedOn: string;
}> = [
  { dataSeason: '2023', species: 'scallop', tier: 1, peril: 'HEAT25', firedOn: '2023-08-13' },
  { dataSeason: '2023', species: 'scallop', tier: 2, peril: 'HEAT26', firedOn: '2023-08-14' },
  { dataSeason: '2023', species: 'hoya', tier: 1, peril: 'HEAT24', firedOn: '2023-08-27' },
  { dataSeason: '2024', species: 'scallop', tier: 1, peril: 'HEAT25', firedOn: '2024-09-05' },
  { dataSeason: '2024', species: 'hoya', tier: 1, peril: 'HEAT24', firedOn: '2024-09-09' },
  { dataSeason: '2025', species: 'scallop', tier: 1, peril: 'HEAT25', firedOn: '2025-08-20' },
  { dataSeason: '2025', species: 'hoya', tier: 1, peril: 'HEAT24', firedOn: '2025-08-31' },
];

export const REFERENCE_EVENTS: readonly ReferenceEvent[] = REFERENCE_EVENT_DEFS.map((d) => ({
  id: `${d.dataSeason}-${d.species}-tier${d.tier}`,
  zone: ZONE,
  species: d.species,
  peril: d.peril,
  tier: d.tier,
  dataSeason: d.dataSeason,
  payoutSeasonLabel: PAYOUT_SEASON_LABEL,
  firedOn: d.firedOn,
}));

export function getReferenceEvent(id: string): ReferenceEvent {
  const found = REFERENCE_EVENTS.find((r) => r.id === id);
  if (!found) {
    const known = REFERENCE_EVENTS.map((r) => r.id).join(', ');
    throw new Error(`unknown reference event "${id}" (known: ${known})`);
  }
  return found;
}

/** The RULES entry (threshold, season window) backing a reference event's species/tier/peril. */
export function ruleForReferenceEvent(ref: ReferenceEvent): Rule {
  const rule = RULES.find((r) => r.species === ref.species && r.tier === ref.tier && r.peril === ref.peril);
  if (!rule) {
    throw new Error(`no RULES entry for ${ref.species} tier ${ref.tier} peril ${ref.peril} (reference event ${ref.id})`);
  }
  return rule;
}
