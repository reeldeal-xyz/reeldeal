import { RULES, RULES_VERSION, heatDays, pipelineHeatRisk, type PipelineHeatRisk, type PipelineSpeciesDetail, type PipelinePlotRecord } from '@repo/shared';

export function thresholdView(species: string, season: string, data: PipelineHeatRisk | null, plot?: PipelinePlotRecord, profile?: PipelineSpeciesDetail | null, now = new Date()) {
  const rules = RULES.filter((rule) => rule.species === species);
  const liveRules = profile?.rules.map((rule) => ({ ...rule, tempC: rule.tempC ?? undefined, window: rule.window ?? undefined }));
  const sameRule = (a: (typeof RULES)[number], b: (typeof RULES)[number]) => a.species === b.species && a.tier === b.tier && a.peril === b.peril && a.tempC === b.tempC && a.threshold === b.threshold && a.window?.start === b.window?.start && a.window?.end === b.window?.end;
  const drift = !!profile && (profile.rules_version !== RULES_VERSION || profile.id !== species || liveRules?.length !== rules.length || rules.some((rule) => !liveRules?.some((other) => sameRule(rule, other))));
  const geometryMatches = !!data && !!plot && data.plot.plotCode === plot.plotCode
    && Math.abs(data.plot.areaM2 - plot.areaM2) <= 0.2
    && data.plot.centroid.every((value, index) => Math.abs(value - plot.centroid[index]) < 0.000002);
  const validSeason = /^20\d{2}$/.test(season) && Number.isFinite(now.getTime());
  const today = validSeason ? now.toISOString().slice(0, 10) : '';
  const sst = data?.indices.filter((item) => item.index === 'SST') ?? [];
  const invalidObservations = !!data && (!pipelineHeatRisk.safeParse(data).success || sst.some((item, i) => {
    const date = Date.parse(`${item.asOf}T00:00:00Z`);
    return !Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== item.asOf
      || (i > 0 && item.asOf <= sst[i - 1].asOf) || (item.value !== null && !Number.isFinite(item.value));
  }));
  const usable = validSeason && data?.window.start === `${season}-06-01` && data.window.end === `${season}-10-31`
    && geometryMatches && plot?.species.includes(species) && !drift && !invalidObservations;
  return {
    rulesVersion: RULES_VERSION, drift, invalidObservations,
    geometryMismatch: !!data && !!plot && !geometryMatches,
    heat: rules.filter((rule) => rule.peril === 'HEAT' && rule.window && rule.tempC !== undefined).map((rule) => {
      const start = `${season}-${rule.window!.start}`, end = `${season}-${rule.window!.end}`;
      const through = today < end ? today : end;
      const elapsedDays = validSeason ? Math.max(0, Math.floor((Date.parse(through) - Date.parse(start)) / 86_400_000) + 1) : 0;
      const readings = usable ? sst.filter((item) => item.asOf >= start && item.asOf <= through) : [];
      const observed = readings.filter((item) => item.value !== null);
      const days = readings.map((item) => ({ date: item.asOf, value: item.value }));
      const count = observed.length ? heatDays(days, rule.tempC!, rule.window!).at(-1)?.value ?? 0 : null;
      return { rule, count, observedDays: observed.length, missingDays: Math.max(0, elapsedDays - observed.length), elapsedDays,
        asOf: observed.at(-1)?.asOf ?? null, reached: count !== null && count >= rule.threshold };
    }),
    bans: rules.filter((rule) => rule.peril === 'BANWEEKS'),
  };
}
