import CoopView from '../../src/components/organisms/operations/CoopView.astro';
import { expect, within } from 'storybook/test';

export default { title: 'ReelDeal/03 Organisms/Co-op Operations', component: CoopView };
export const Overview = {};
export const Paid = { args: { sample: 'paid' } };
export const Unverified = { args: { sample: 'unverified' } };
export const HeldUnverified = { args: { sample: 'heldUnverified' } };
export const VerifiedHistoricalHold = { args: { sample: 'verifiedHistoricalHold' }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText('Verified · Level 1')).toBeVisible();
  await expect(canvas.getByText('Held', { exact: true })).toBeVisible();
  await expect(canvas.getByText(/Recorded Held reason: UNVERIFIED/)).toBeVisible();
  await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
} };
export const HeldNoFarmer = { args: { sample: 'heldNoFarmer' } };
export const HeldPlotExpired = { args: { sample: 'heldPlotExpired' } };
export const HeldCap = { args: { sample: 'heldCap' } };
export const HeldZoneMismatch = { args: { sample: 'heldZoneMismatch' } };
export const Expired = { args: { sample: 'expired' }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText('Expired', { exact: true })).toBeVisible();
  await expect(canvas.getByText('No active season slot')).toBeVisible();
  await expect(canvas.getByText('Paid', { exact: true })).toBeVisible();
  await expect(canvas.getByText(/historical recipient is separate from the current farmer/)).toBeVisible();
} };
export const Revoked = { args: { sample: 'revoked' } };
export const ClaimWindowElapsed = { args: { sample: 'claimWindowElapsed' } };
export const IdentityUnavailable = { args: { sample: 'identityUnavailable' } };
export const MissingHolder = { args: { sample: 'missingHolder' } };
export const SlotUnavailable = { args: { sample: 'slotUnavailable' } };
export const Loading = { args: { sample: 'loading' } };
export const Empty = { args: { sample: 'empty' } };
export const Unavailable = { args: { sample: 'unavailable' } };
