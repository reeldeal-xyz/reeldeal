import { REPLAY_SEASONS, type Zone } from '@repo/shared';
import type { Metadata } from 'next';
import { MapExperience, type BanweeksDataset, type ZoneSeasonDataset } from '@/components/map/MapExperience';
import { SYNTHETIC_PLOTS, zoneFeaturesGeoJson } from '@/fixtures/geo';
import { getIndices, getSeries, getTriggers } from '@/lib/feed-client';
import '@/styles/ocean-theme.css';
import styles from './map.module.css';

export const metadata: Metadata = { title: 'Map & replay — Reel Deal' };

const ZONES: readonly Zone[] = ['karakuwa-east', 'kesennuma-bay'];
const BANWEEKS_SEASON = '2026';

export default async function MapPage() {
  const combos = ZONES.flatMap((zone) => REPLAY_SEASONS.map((season) => ({ zone, season })));

  const [datasets, banweeks] = await Promise.all([
    Promise.all(
      combos.map(async ({ zone, season }): Promise<ZoneSeasonDataset> => {
        const [series, indices, triggers] = await Promise.all([
          getSeries(zone, season),
          getIndices(zone, season),
          getTriggers(zone, season),
        ]);
        return { zone, season, series, indices, triggers };
      }),
    ),
    Promise.all(
      ZONES.map(async (zone): Promise<BanweeksDataset> => ({ zone, triggers: await getTriggers(zone, BANWEEKS_SEASON) })),
    ),
  ]);

  return (
    <main className={`oceanRoot ${styles.page}`}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>Reel Deal — opening visual</p>
        <h1 className={styles.title}>Kesennuma Bay, replayed</h1>
        <p className={styles.lede}>
          Scrub a season and watch the scallop and hoya heat indices climb toward their thresholds — the
          same computation that fires a real JPYC payout on-chain. 2023 is the headline: scallop tier 2
          fires 11 Aug, tier 1 the next day, hoya three weeks later.
        </p>
      </header>
      <MapExperience datasets={datasets} banweeks={banweeks} zoneFeatures={zoneFeaturesGeoJson()} plots={SYNTHETIC_PLOTS} />
    </main>
  );
}
