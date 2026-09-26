import ResourceShowcase from './ResourceShowcase.astro';

export default {
  title: 'ReelDeal/02 Molecules/Equipment Card',
  component: ResourceShowcase,
  args: { kind: 'equipment' },
};

export const Ready = { args: { sample: 'ready' } };
export const MissingFarm = { args: { sample: 'missingFarm' } };
export const Loading = { args: { sample: 'loading' } };
export const Empty = { args: { sample: 'empty' } };
export const Unavailable = { args: { sample: 'unavailable' } };
