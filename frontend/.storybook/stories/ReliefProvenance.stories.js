import ReliefShowcase from './ReliefShowcase.astro';

export default {
  title: 'ReelDeal/02 Molecules/Source and Provenance',
  component: ReliefShowcase,
  args: { kind: 'provenance' },
};

export const Collapsed = { args: { sample: 'collapsed' } };
export const Expanded = { args: { sample: 'expanded' } };
export const Unavailable = { args: { sample: 'unavailable' } };
