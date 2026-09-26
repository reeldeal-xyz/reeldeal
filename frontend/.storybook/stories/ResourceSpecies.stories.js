import ResourceShowcase from './ResourceShowcase.astro';

export default {
  title: 'ReelDeal/02 Molecules/Species Card',
  component: ResourceShowcase,
  args: { kind: 'species' },
};

export const Ready = { args: { sample: 'ready' } };
export const MissingDetails = { args: { sample: 'missingDetails' } };
export const Loading = { args: { sample: 'loading' } };
export const Empty = { args: { sample: 'empty' } };
export const Unavailable = { args: { sample: 'unavailable' } };
