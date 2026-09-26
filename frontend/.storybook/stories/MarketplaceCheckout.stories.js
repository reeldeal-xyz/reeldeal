import MarketplaceCheckout from '../../src/components/organisms/marketplace/MarketplaceCheckout.astro';
import { expect, within } from 'storybook/test';

async function proposedWithoutPaymentStatus({ canvasElement }) {
  const canvas = within(canvasElement);
  await expect(canvas.getByText('Proposed split', { exact: true })).toBeVisible();
  await expect(canvas.queryByText('Pending', { exact: true })).not.toBeInTheDocument();
  await expect(canvas.queryByText('Paid', { exact: true })).not.toBeInTheDocument();
}

export default {
  title: 'ReelDeal/03 Organisms/Marketplace Checkout',
  component: MarketplaceCheckout,
};

export const BeforeApproval = { args: { state: 'approval' }, play: proposedWithoutPaymentStatus };
export const WalletRejected = { args: { state: 'rejected' }, play: proposedWithoutPaymentStatus };
export const Submitted = { args: { state: 'submitted' }, play: async ({ canvasElement }) => {
  const split = within(within(canvasElement).getByRole('region', { name: 'Sale contribution split' }));
  await expect(split.getByText('Pending', { exact: true })).toBeVisible();
  await expect(split.queryByText('Proposed split', { exact: true })).not.toBeInTheDocument();
  await expect(split.queryByText('Paid', { exact: true })).not.toBeInTheDocument();
} };
export const Confirmed = { args: { state: 'confirmed' } };
export const Failed = { args: { state: 'failed' } };
export const Unavailable = { args: { state: 'unavailable' } };
