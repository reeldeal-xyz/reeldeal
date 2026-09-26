import ResourceShowcase from './ResourceShowcase.astro';

export default {
  title: 'ReelDeal/02 Molecules/Farm Card',
  component: ResourceShowcase,
  args: { kind: 'farm' },
};

export const Ready = { args: { sample: 'ready' } };
export const Unmapped = { args: { sample: 'unmapped' } };
export const MissingDetails = { args: { sample: 'missingDetails' } };
export const Loading = { args: { sample: 'loading' } };
export const Empty = { args: { sample: 'empty' } };
export const Unavailable = { args: { sample: 'unavailable' } };
