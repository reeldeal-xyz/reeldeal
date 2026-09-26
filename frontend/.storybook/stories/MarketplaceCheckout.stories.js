import MarketplaceCheckout from '../../src/components/organisms/marketplace/MarketplaceCheckout.astro';

export default {
  title: 'ReelDeal/03 Organisms/Marketplace Checkout',
  component: MarketplaceCheckout,
};

export const BeforeApproval = { args: { state: 'approval' } };
export const WalletRejected = { args: { state: 'rejected' } };
export const Submitted = { args: { state: 'submitted' } };
export const Confirmed = { args: { state: 'confirmed' } };
export const Failed = { args: { state: 'failed' } };
export const Unavailable = { args: { state: 'unavailable' } };
