// Given a route eventId (bytes32 hex), find which (zone, replay-season, rule) produced it. eventId only
// encodes zone+species+peril+tier+seasonLabel — and seasonLabel is always the *payout* season ("2026" per
// docs/INTERFACE.md), not the replay year the data came from — so two different replay seasons could in
// principle produce the same eventId if they fire the same rule; this returns the first match found. The
// BANWEEKS season ("2026") is searched too since it's a real, current-season trigger (#28).
import { eventIdOf, REPLAY_SEASONS, type Peril, type Species, type Zone } from '@repo/shared';
import { getTriggers, type FeedSource } from './feed-client';

const ZONES: readonly Zone[] = ['karakuwa-east', 'kesennuma-bay'];
const BANWEEKS_SEASON = '2026';
const ALL_SEASONS: readonly string[] = [...REPLAY_SEASONS, BANWEEKS_SEASON];

export interface ResolvedEvent {
  zone: Zone;
  /** The replay season the underlying data came from (2022-2025), or "2026" for the BANWEEKS episode. */
  dataSeason: string;
  label: string;
  species: Species;
  peril: Peril;
  tier: number;
  firedOn: string;
  dataHash: `0x${string}`;
  index: number;
  threshold: number;
  triggersSource: FeedSource;
}

export async function resolveEvent(eventId: string): Promise<ResolvedEvent | null> {
  const target = eventId.toLowerCase();
  const combos = ZONES.flatMap((zone) => ALL_SEASONS.map((season) => ({ zone, season })));
  const results = await Promise.all(
    combos.map(async ({ zone, season }) => ({ zone, season, result: await getTriggers(zone, season) })),
  );

  for (const { zone, season, result } of results) {
    for (const t of result.data) {
      const species = t.species as Species;
      const peril = t.peril as Peril;
      const id = eventIdOf(zone, species, peril, t.trigger.tier, t.trigger.seasonLabel);
      if (id.toLowerCase() !== target) continue;
      return {
        zone,
        dataSeason: season,
        label: t.label,
        species,
        peril,
        tier: t.trigger.tier,
        firedOn: t.firedOn,
        dataHash: t.trigger.dataHash as `0x${string}`,
        index: t.trigger.index,
        threshold: t.trigger.threshold,
        triggersSource: result.source,
      };
    }
  }
  return null;
}
