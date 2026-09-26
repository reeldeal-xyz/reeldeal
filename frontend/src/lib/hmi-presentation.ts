type Reading = { asOf: string; value: number | null };
type Sample = { asOf: string; value: number };
const DAY = 86_400_000;

const month = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));

export function observationSummary(readings: readonly Reading[]) {
  const observed = readings.filter((item): item is Sample => item.value !== null && Number.isFinite(item.value));
  if (!observed.length) return null;
  const values = observed.map((item) => item.value);
  return {
    count: observed.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    latest: observed[observed.length - 1],
  };
}

export function observationChart(readings: readonly Reading[], metric: string) {
  const summary = observationSummary(readings);
  if (!summary || !readings.length) return null;

  const padding = Math.max((summary.max - summary.min) * 0.1, 0.5);
  const low = summary.min - padding;
  const high = summary.max + padding;
  const start = Date.parse(`${readings[0].asOf}T00:00:00Z`);
  const end = Date.parse(`${readings[readings.length - 1].asOf}T00:00:00Z`);
  const y = (value: number) => 130 - (value - low) / (high - low) * 110;
  const segments: { x: number; y: number; asOf: string; value: number }[][] = [];
  let segment: (typeof segments)[number] | null = null;
  let previous: string | null = null;

  for (const reading of readings) {
    if (reading.value === null || !Number.isFinite(reading.value)) {
      segment = null;
      previous = null;
      continue;
    }
    const consecutive = previous !== null && (metric === 'SST_MONTH'
      ? month(reading.asOf) - month(previous) === 1
      : Date.parse(`${reading.asOf}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`) === DAY);

    if (!segment || !consecutive) {
      segment = [];
      segments.push(segment);
    }
    segment.push({
      x: end === start ? 176 : 44 + (Date.parse(`${reading.asOf}T00:00:00Z`) - start) / (end - start) * 264,
      y: y(reading.value),
      asOf: reading.asOf,
      value: reading.value,
    });
    previous = reading.asOf;
  }

  return {
    ...summary,
    segments,
    start: readings[0].asOf,
    end: readings[readings.length - 1].asOf,
    ticks: [high, (high + low) / 2, low].map((value) => ({ value, y: y(value) })),
  };
}
