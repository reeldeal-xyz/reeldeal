import HolderView from '../../src/components/organisms/operations/HolderView.astro';
import { expect, userEvent, waitFor, within } from 'storybook/test';

export default { title: 'ReelDeal/03 Organisms/Holder Operations', component: HolderView };
export const Queue = {};
export const UnverifiedFarmer = { args: { sample: 'unverified' } };
export const VerifiedFarmer = { args: { sample: 'verified' } };
export const Issued = { args: { sample: 'issued' } };
export const ConfirmIssue = { args: { sample: 'confirmIssue' } };
export const IssuePending = { args: { sample: 'issuePending' } };
export const RevokePending = { args: { sample: 'revokePending' } };
export const WalletCancelled = { args: { sample: 'walletCancelled' } };
export const Expired = { args: { sample: 'expired' } };
export const Revoked = { args: { sample: 'revoked' } };
export const MissingRegistry = { args: { sample: 'missingRegistry' } };
export const MissingFarmer = { args: { sample: 'missingFarmer' } };
export const Disconnected = { args: { sample: 'disconnected' } };
export const WrongNetwork = { args: { sample: 'wrongNetwork' } };
export const Unauthorized = { args: { sample: 'unauthorized' }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText(/example account is not authorized/)).toBeVisible();
  await expect(canvas.queryByRole('button', { name: 'Preview issue' })).not.toBeInTheDocument();
} };
export const AuthorityUnavailable = { args: { sample: 'authorityUnavailable' } };
export const SlotUnavailable = { args: { sample: 'slotUnavailable' } };
export const Loading = { args: { sample: 'loading' } };
export const Empty = { args: { sample: 'empty' } };
export const Unavailable = { args: { sample: 'unavailable' } };

async function hydratedCanvas(canvasElement) {
  await waitFor(async () => {
    const islands = canvasElement.querySelectorAll('astro-island');
    await expect(islands.length).toBeGreaterThan(0);
    for (const island of islands) await expect(island).not.toHaveAttribute('ssr');
  }, { timeout: 5000 });
  return within(canvasElement);
}

export const CancelIssue = { args: { sample: 'unverified' }, play: async ({ canvasElement }) => {
  const canvas = await hydratedCanvas(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Preview issue' }));
  await expect(canvas.getByRole('heading', { name: 'Review issue preview' })).toBeVisible();
  await expect(canvas.getByRole('heading', { name: 'Review issue preview' })).toHaveFocus();
  await userEvent.click(canvas.getByRole('button', { name: 'Cancel preview' }));
  await expect(canvas.getByRole('status')).toHaveTextContent('Preview cancelled');
  await expect(canvas.getByRole('status')).toHaveFocus();
  await expect(canvas.getByText('Request pending', { exact: true })).toBeVisible();
  await expect(canvas.queryByText('Issued', { exact: true })).not.toBeInTheDocument();
} };
export const IssueStaysPending = { args: { sample: 'unverified' }, play: async ({ canvasElement }) => {
  const canvas = await hydratedCanvas(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Preview issue' }));
  await expect(canvas.getByRole('heading', { name: 'Review issue preview' })).toHaveFocus();
  await userEvent.click(canvas.getByRole('button', { name: 'Confirm demo issue' }));
  await expect(canvas.getByRole('status')).toHaveTextContent('no transaction was submitted or confirmed');
  await expect(canvas.getByRole('status')).toHaveFocus();
  await expect(canvas.getByText('Request pending', { exact: true })).toBeVisible();
  await expect(canvas.queryByText('Issued', { exact: true })).not.toBeInTheDocument();
} };
export const RevokeStaysIssued = { args: { sample: 'issued' }, play: async ({ canvasElement }) => {
  const canvas = await hydratedCanvas(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Preview revoke' }));
  await expect(canvas.getByRole('heading', { name: 'Review revoke preview' })).toHaveFocus();
  await userEvent.click(canvas.getByRole('button', { name: 'Confirm demo revoke' }));
  await expect(canvas.getByRole('status')).toHaveTextContent('Demo revoke pending');
  await expect(canvas.getByRole('status')).toHaveFocus();
  await expect(canvas.getByText('Issued', { exact: true })).toBeVisible();
  await expect(canvas.queryByText('Revoked', { exact: true })).not.toBeInTheDocument();
} };
