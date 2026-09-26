import ReliefShowcase from './ReliefShowcase.astro';

export default {
  title: 'ReelDeal/02 Molecules/Contribution Split',
  component: ReliefShowcase,
  args: { kind: 'contribution' },
};

export const Pending = { args: { sample: 'pending' } };
export const Paid = { args: { sample: 'paid' } };
export const Unavailable = { args: { sample: 'unavailable' } };
