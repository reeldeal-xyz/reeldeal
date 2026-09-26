import ReliefShowcase from './ReliefShowcase.astro';

export default {
  title: 'ReelDeal/02 Molecules/Measurement Row',
  component: ReliefShowcase,
  args: { kind: 'measurement' },
};

export const Observed = { args: { sample: 'observed' } };
export const ZeroCelsius = { args: { sample: 'zero' } };
export const MalformedReading = { args: { sample: 'malformed' } };
export const MissingValue = { args: { sample: 'missingValue' } };
export const Stale = { args: { sample: 'stale' } };
export const AdvisoryOnly = { args: { sample: 'advisory' } };
export const Loading = { args: { sample: 'loading' } };
export const Missing = { args: { sample: 'missing' } };
export const Unavailable = { args: { sample: 'unavailable' } };
