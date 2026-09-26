// Client-side HEAT{tempC} index recompute (docs/INTERFACE.md: "HEAT{t} (days with SST >= t C) is computed
// on request only, e.g. for the web map"), built from a zone/season's raw SST series via rules.ts's
// heatDays. Replaces the old per-file IndicesFile.days { heat24, heat25, heat26 } shape now that Trigger v2
// (#55) collapsed HEAT24/HEAT25/HEAT26 into one HEAT peril with a per-rule tempC
// (packages/shared/src/rules.ts).
import { HEAT_WINDOW, RULES, heatDays, type SeriesDay } from '@repo/shared';

/** Every distinct tempC a HEAT rule in RULES actually uses, e.g. [25, 26, 24]. */
export const HEAT_TEMPS: readonly number[] = [
  ...new Set(
    RULES.filter((r): r is typeof r & { tempC: number } => r.peril === 'HEAT' && r.tempC !== undefined).map(
      (r) => r.tempC,
    ),
  ),
];

export interface HeatIndexDay {
  date: string;
  /** Cumulative day-count with SST >= tempC within HEAT_WINDOW, keyed by tempC (e.g. countByTempC[25]).
   *  Freezes at 0 before the window opens and holds its last value after it closes, same as the pre-v2
   *  computeIndices. */
  countByTempC: Record<number, number>;
}

export function computeHeatIndexDays(days: readonly SeriesDay[]): HeatIndexDay[] {
  const perTemp = HEAT_TEMPS.map((tempC) => ({
    tempC,
    byDate: new Map(heatDays(days, tempC, HEAT_WINDOW).map((d) => [d.date, d.value] as const)),
  }));
  const running = Object.fromEntries(HEAT_TEMPS.map((t) => [t, 0])) as Record<number, number>;
  return days.map((d) => {
    const countByTempC: Record<number, number> = {};
    for (const { tempC, byDate } of perTemp) {
      const value = byDate.get(d.date);
      if (value !== undefined) running[tempC] = value;
      countByTempC[tempC] = running[tempC]!;
    }
    return { date: d.date, countByTempC };
  });
}
