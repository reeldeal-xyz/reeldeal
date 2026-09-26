'use client';

import { REPLAY_SEASONS, type ReplayTrigger, type Zone } from '@repo/shared';
import { useState } from 'react';
import type { SstSeries } from '@/fixtures/series';
import type { SyntheticPlot, ZoneFeatureCollection } from '@/fixtures/geo';
import type { FeedResult } from '@/lib/feed-client';
import type { HeatIndexDay } from '@/lib/heat-indices';
import { SPECIES_COLOR, SPECIES_LABEL } from '@/lib/species-colors';
import { FixtureBadge } from '../ui/FixtureBadge';
import { MapCanvas, type ActiveFire } from './MapCanvas';
import styles from './MapExperience.module.css';
import { ReplayButton } from './ReplayButton';
import { Timeline } from './Timeline';

export interface ZoneSeasonDataset {
  zone: Zone;
  season: string;
  series: FeedResult<SstSeries>;
  indices: FeedResult<HeatIndexDay[]>;
  triggers: FeedResult<ReplayTrigger[]>;
}

export interface BanweeksDataset {
  zone: Zone;
  triggers: FeedResult<ReplayTrigger[]>;
}

interface MapExperienceProps {
  datasets: ZoneSeasonDataset[];
  banweeks: BanweeksDataset[];
  zoneFeatures: ZoneFeatureCollection;
  plots: SyntheticPlot[];
}

const ZONE_LABEL: Record<Zone, string> = {
  'karakuwa-east': 'Karakuwa East',
  'kesennuma-bay': 'Kesennuma Bay',
};

const ZONES: Zone[] = ['karakuwa-east', 'kesennuma-bay'];

export function MapExperience({ datasets, banweeks, zoneFeatures, plots }: MapExperienceProps) {
  const [zone, setZone] = useState<Zone>('karakuwa-east');
  const [season, setSeason] = useState<string>('2023');
  const [dayIndex, setDayIndex] = useState(0);

  const current = datasets.find((d) => d.zone === zone && d.season === season);
  const days = current?.indices.data ?? [];
  const clampedIndex = Math.min(dayIndex, Math.max(days.length - 1, 0));

  const seasonFires: ActiveFire[] = (current?.triggers.data ?? [])
    .filter((t) => {
      const fireDayIndex = days.findIndex((d) => d.date === t.firedOn);
      return fireDayIndex >= 0 && fireDayIndex <= clampedIndex;
    })
    .map((t) => ({ id: `${zone}-${season}-${t.label}`, zone, label: t.label, firedOn: t.firedOn }));

  const banweeksFires: ActiveFire[] = banweeks.flatMap((b) =>
    b.triggers.data.map((t) => ({
      id: `${b.zone}-2026-${t.label}`,
      zone: b.zone,
      label: `${t.label} · toxin ban`,
      firedOn: t.firedOn,
    })),
  );

  const overallSource = [current?.series.source, current?.indices.source, current?.triggers.source].includes('fixture')
    ? 'fixture'
    : 'feed';

  return (
    <div className={styles.layout}>
      <div className={styles.mapColumn}>
        <div className={styles.card}>
          <div className={styles.controlsRow}>
            <div className={styles.selectGroup}>
              <select className={styles.select} value={zone} onChange={(e) => setZone(e.target.value as Zone)} aria-label="Zone">
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {ZONE_LABEL[z]}
                  </option>
                ))}
              </select>
              <select
                className={styles.select}
                value={season}
                onChange={(e) => {
                  setSeason(e.target.value);
                  setDayIndex(0);
                }}
                aria-label="Season"
              >
                {REPLAY_SEASONS.map((s) => (
                  <option key={s} value={s}>
                    {s} season
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.badgeRow}>
              <FixtureBadge source={overallSource} />
            </div>
          </div>
        </div>

        <div className={styles.mapFrame}>
          <MapCanvas zoneFeatures={zoneFeatures} plots={plots} selectedZone={zone} activeFires={[...seasonFires, ...banweeksFires]} />
        </div>

        <div className={styles.card}>
          <ReplayButton zone={zone} season={season} />
        </div>
      </div>

      <div className={styles.sidebar}>
        <div className={styles.card}>
          <h2 className={styles.sectionTitle}>Season timeline</h2>
          {current ? (
            <Timeline
              days={current.indices.data}
              triggers={current.triggers.data}
              index={clampedIndex}
              onIndexChange={setDayIndex}
            />
          ) : (
            <p className={styles.footnote}>No data for this zone/season combination.</p>
          )}
        </div>

        <div className={styles.card}>
          <h2 className={styles.sectionTitle}>Species</h2>
          <div className={styles.banweeksList}>
            {(Object.keys(SPECIES_COLOR) as (keyof typeof SPECIES_COLOR)[]).map((s) => (
              <div className={styles.banweeksRow} key={s}>
                <span
                  style={{ width: '0.85em', height: '0.85em', borderRadius: '999px', background: SPECIES_COLOR[s], display: 'inline-block' }}
                  aria-hidden
                />
                {SPECIES_LABEL[s]}
              </div>
            ))}
          </div>
          <p className={styles.footnote}>All 15 plot points are synthetic — no real plot registry exists yet (#7/#8).</p>
        </div>

        <div className={styles.card}>
          <h2 className={styles.sectionTitle}>2026 toxin ban (BANWEEKS)</h2>
          <div className={styles.banweeksList}>
            {banweeks.map((b) => {
              const t = b.triggers.data[0];
              return (
                <div className={styles.banweeksRow} key={b.zone}>
                  <span className={styles.banweeksZone}>{ZONE_LABEL[b.zone]}</span>
                  {t ? `fired ${t.firedOn}` : 'no trigger'}
                </div>
              );
            })}
          </div>
          <p className={styles.footnote}>
            Scallop tier 1, verified against Miyagi-prefecture PSP-toxin test records (#28) — shown on the map
            regardless of which season is selected above.
          </p>
        </div>

        <div className={styles.card}>
          <h2 className={styles.sectionTitle}>Zone geometry</h2>
          <p className={styles.footnote}>{zoneFeatures.features.map((f) => `${f.properties.label}: ${f.properties.accuracy}`).join(' ')}</p>
        </div>
      </div>
    </div>
  );
}
