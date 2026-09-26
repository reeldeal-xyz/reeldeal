import ReliefShowcase from './ReliefShowcase.astro';

export default {
  title: 'ReelDeal/02 Molecules/Transaction Row',
  component: ReliefShowcase,
  args: { kind: 'transaction' },
};

export const Pending = { args: { sample: 'pending' } };
export const Paid = { args: { sample: 'paid' } };
export const Held = { args: { sample: 'held' } };
export const Unavailable = { args: { sample: 'unavailable' } };
