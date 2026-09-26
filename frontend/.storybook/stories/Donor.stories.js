import DonorView from '../../src/components/organisms/donor/DonorView.astro';
import { expect, userEvent, waitFor, within } from 'storybook/test';

export default { title: 'ReelDeal/03 Organisms/Donor', component: DonorView, parameters: { layout: 'padded' } };
export const Ready = {};
export const Disconnected = { args: { sample: 'disconnected' } };
export const WrongNetwork = { args: { sample: 'wrongNetwork' } };
export const MissingSetup = { args: { sample: 'missingSetup' } };
export const Loading = { args: { sample: 'loading' } };
export const Unavailable = { args: { sample: 'unavailable' } };
export const AllowanceUnavailable = { args: { sample: 'allowanceUnavailable' } };
export const EmptyLedger = { args: { sample: 'emptyLedger' } };
export const ApprovalReview = { args: { sample: 'approvalReview' } };
export const ApprovalPending = { args: { sample: 'approvalPending' } };
export const ApprovalConfirmed = { args: { sample: 'approved' } };
export const ApprovalCancelled = { args: { sample: 'approvalCancelled' } };
export const ApprovalRejected = { args: { sample: 'approvalRejected' } };
export const ApprovalFailed = { args: { sample: 'approvalFailed' } };
export const ApprovalUnavailable = { args: { sample: 'approvalUnavailable' } };
export const DonationReview = { args: { sample: 'donationReview' } };
export const DonationPending = { args: { sample: 'donationPending' } };
export const DonationConfirmed = { args: { sample: 'donationConfirmed' } };
export const DonationCancelled = { args: { sample: 'donationCancelled' } };
export const DonationRejected = { args: { sample: 'donationRejected' } };
export const DonationFailed = { args: { sample: 'donationFailed' } };
export const DonationUnavailable = { args: { sample: 'donationUnavailable' } };

async function hydrated(canvasElement) {
  await waitFor(() => {
    const island = canvasElement.querySelector('astro-island');
    expect(island).not.toBeNull();
    expect(island).not.toHaveAttribute('ssr');
  }, { timeout: 5000 });
  return within(canvasElement);
}

export const CompleteJourney = { play: async ({ canvasElement }) => {
  const canvas = await hydrated(canvasElement);
  const input = canvas.getByRole('textbox', { name: 'Amount (JPYC)' });
  const progress = canvasElement.querySelector('[data-donor-progress]');
  await expect(progress).not.toHaveFocus();
  await userEvent.clear(input);
  await userEvent.type(input, '1.000000000000000001');
  await expect(input).toHaveFocus();
  await userEvent.click(canvas.getByRole('button', { name: 'Review sample approval' }));
  await waitFor(() => expect(progress).toHaveFocus());
  await userEvent.tab();
  await expect(canvas.getByRole('button', { name: 'Submit sample approval' })).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(progress).toHaveFocus());
  await expect(input).toBeDisabled();
  await expect(canvas.queryByRole('region', { name: 'Sample donation receipt' })).not.toBeInTheDocument();
  await userEvent.tab();
  await expect(canvas.getByRole('button', { name: 'Confirm sample approval' })).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  await expect(canvasElement.querySelector('[data-donor-progress]')).toHaveTextContent('no donation has been made');
  await waitFor(() => expect(canvas.getByRole('button', { name: 'Review sample donation' })).toHaveFocus());
  await expect(canvas.queryByRole('region', { name: 'Sample donation receipt' })).not.toBeInTheDocument();
  await userEvent.clear(input);
  await userEvent.type(input, '1.000000000000000001');
  await expect(input).toHaveFocus();
  await userEvent.click(canvas.getByRole('button', { name: 'Review sample donation' }));
  await userEvent.click(canvas.getByRole('button', { name: 'Submit sample donation' }));
  await expect(canvas.queryByRole('region', { name: 'Sample donation receipt' })).not.toBeInTheDocument();
  await userEvent.click(canvas.getByRole('button', { name: 'Confirm sample donation' }));
  const receipt = canvas.getByRole('region', { name: 'Sample donation receipt' });
  await expect(receipt).toHaveTextContent('1.000000000000000001 JPYC');
  await expect(receipt).toHaveTextContent('DEMO-DONATION-2');
  await expect(within(canvas.getByRole('region', { name: 'Demo transaction history' })).getAllByRole('listitem')).toHaveLength(2);
} };

export const InvalidAmount = { play: async ({ canvasElement }) => {
  const canvas = await hydrated(canvasElement);
  const input = canvas.getByRole('textbox', { name: 'Amount (JPYC)' });
  await userEvent.clear(input);
  await userEvent.type(input, '0.0000000000000000001');
  await userEvent.click(canvas.getByRole('button', { name: 'Review sample approval' }));
  await expect(canvas.getByRole('alert')).toHaveTextContent('up to 18 decimal places');
  await expect(canvas.queryByRole('button', { name: 'Submit sample approval' })).not.toBeInTheDocument();
} };

export const CancelDonation = { args: { sample: 'donationReview' }, play: async ({ canvasElement }) => {
  const canvas = await hydrated(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Cancel review' }));
  await expect(canvasElement.querySelector('[data-donor-progress]')).toHaveTextContent('cancelled before submission');
  await expect(canvas.queryByRole('region', { name: 'Sample donation receipt' })).not.toBeInTheDocument();
  await expect(canvas.getByRole('button', { name: 'Review sample donation' })).toBeEnabled();
  await waitFor(() => expect(canvas.getByRole('button', { name: 'Review sample donation' })).toHaveFocus());
} };

export const ResolveUnavailable = { args: { sample: 'donationUnavailable' }, play: async ({ canvasElement }) => {
  const canvas = await hydrated(canvasElement);
  await expect(canvas.getByRole('textbox', { name: 'Amount (JPYC)' })).toBeDisabled();
  await expect(canvas.queryByRole('button', { name: 'Review sample donation' })).not.toBeInTheDocument();
  await userEvent.click(canvas.getByRole('button', { name: 'Restore sample pending status' }));
  await expect(canvas.queryByRole('region', { name: 'Sample donation receipt' })).not.toBeInTheDocument();
  await userEvent.click(canvas.getByRole('button', { name: 'Confirm sample donation' }));
  await expect(canvas.getByRole('region', { name: 'Sample donation receipt' })).toBeVisible();
  await expect(within(canvas.getByRole('region', { name: 'Demo transaction history' })).getAllByRole('listitem')).toHaveLength(1);
} };
