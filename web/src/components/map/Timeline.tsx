'use client';

import { RULES, type IndicesDay, type Peril } from '@repo/shared';
import { useMemo } from 'react';
import { SPECIES_COLOR } from '@/lib/species-colors';
import styles from './Timeline.module.css';

export interface TimelineTrigger {
  label: string; // "scallop:2"
  species: string;
  peril: string;
  firedOn: string; // YYYY-MM-DD
}

interface TimelineProps {
  days: IndicesDay[];
  triggers: TimelineTrigger[];
  index: number;
  onIndexChange: (i: number) => void;
}

const HEAT_METRIC: Record<string, (d: IndicesDay) => number> = {
  HEAT24: (d) => d.heat24,
  HEAT25: (d) => d.heat25,
  HEAT26: (d) => d.heat26,
};

const LINE_STYLE: Record<string, { color: string; dash?: string; name: string }> = {
  'scallop:1': { color: SPECIES_COLOR.scallop, name: 'Scallop tier 1 · HEAT25' },
  'scallop:2': { color: '#1fb8a3', dash: '5 4', name: 'Scallop tier 2 · HEAT26' },
  'hoya:1': { color: SPECIES_COLOR.hoya, name: 'Hoya tier 1 · HEAT24' },
};

const VB_W = 800;
const VB_H = 180;
const MARGIN_X = 10;
const TOP = 12;
const BOTTOM = VB_H - 16;
const MAX_PERCENT = 150;

function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function Timeline({ days, triggers, index, onIndexChange }: TimelineProps) {
  const heatRules = useMemo(
    () =>
      RULES.filter((r) => r.window !== undefined).map((r) => ({
        label: `${r.species}:${r.tier}`,
        peril: r.peril,
        threshold: r.threshold,
      })),
    [],
  );

  const scaleX = (i: number) => MARGIN_X + (days.length <= 1 ? 0 : (i / (days.length - 1)) * (VB_W - 2 * MARGIN_X));
  const scaleY = (percent: number) => {
    const clamped = Math.max(0, Math.min(percent, MAX_PERCENT));
    return BOTTOM - (clamped / MAX_PERCENT) * (BOTTOM - TOP);
  };

  const lines = heatRules.map((rule) => {
    const metric = HEAT_METRIC[rule.peril as Peril] ?? (() => 0);
    const points = days.map((d, i) => [scaleX(i), scaleY((metric(d) / rule.threshold) * 100)] as const);
    const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const style = LINE_STYLE[rule.label] ?? { color: '#7ba3ad', name: rule.label };
    return { ...rule, ...style, path, points };
  });

  const revealed = triggers
    .map((t) => ({ ...t, dayIndex: days.findIndex((d) => d.date === t.firedOn) }))
    .filter((t) => t.dayIndex >= 0 && t.dayIndex <= index)
    .sort((a, b) => a.dayIndex - b.dayIndex);

  const current = days[Math.min(index, days.length - 1)];

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <span className={styles.dateLabel}>Scrubbing</span>
          <span className={styles.date}>{current ? formatDate(current.date) : '—'}</span>
        </div>
        <div className={styles.legend}>
          {lines.map((l) => (
            <span className={styles.legendItem} key={l.label}>
              <span className={styles.swatch} style={{ background: l.color }} />
              {l.name} (≥{l.threshold})
            </span>
          ))}
        </div>
      </div>

      <div className={styles.chartWrap}>
        <svg className={styles.chart} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" role="img" aria-label="HEAT index vs. threshold, over the season">
          <line x1={MARGIN_X} x2={VB_W - MARGIN_X} y1={scaleY(100)} y2={scaleY(100)} stroke="var(--heat-500)" strokeDasharray="4 4" strokeWidth={1} />
          <text x={VB_W - MARGIN_X} y={scaleY(100) - 4} textAnchor="end" className={styles.thresholdLabel}>
            threshold
          </text>

          {lines.map((l) => (
            <path key={l.label} d={l.path} fill="none" stroke={l.color} strokeWidth={2} strokeDasharray={l.dash} strokeLinecap="round" strokeLinejoin="round" />
          ))}

          {revealed.map((t) => {
            const line = lines.find((l) => l.label === t.label);
            const point = line?.points[t.dayIndex];
            if (!point) return null;
            return (
              <g key={`${t.label}-${t.firedOn}`}>
                <circle cx={point[0]} cy={point[1]} r={5} fill="var(--heat-500)" stroke="#fff2ec" strokeWidth={1} />
                <circle cx={point[0]} cy={point[1]} r={10} fill="var(--heat-500)" opacity={0.25} />
              </g>
            );
          })}

          <line x1={scaleX(index)} x2={scaleX(index)} y1={TOP - 4} y2={BOTTOM + 4} stroke="var(--foam-100)" strokeWidth={1} opacity={0.55} />
        </svg>
      </div>

      <input
        type="range"
        className={styles.range}
        min={0}
        max={Math.max(days.length - 1, 0)}
        value={index}
        onChange={(e) => onIndexChange(Number(e.target.value))}
        aria-label="Day of season"
      />

      <div className={styles.firedList}>
        {revealed.length === 0 ? (
          <span className={styles.pending}>No threshold crossed yet this season.</span>
        ) : (
          revealed.map((t) => (
            <span className={styles.firedRow} key={`${t.label}-row`}>
              🔥 {LINE_STYLE[t.label]?.name ?? t.label} fired {formatDate(t.firedOn)}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
