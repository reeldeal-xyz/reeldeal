import FarmerRelief from './FarmerReliefShowcase.astro';
import { expect, userEvent, waitFor, within } from 'storybook/test';

export default {
  title: 'ReelDeal/03 Organisms/Farmer Relief',
  component: FarmerRelief,
  parameters: { layout: 'padded' },
};

export const Unverified = { args: { sample: 'unverified' } };
export const Verified = { args: { sample: 'verified' } };
export const VerifiedLevelTwo = { args: { sample: 'verifiedLevelTwo' } };
export const SlotRequestPending = { args: { sample: 'requestPending' } };
export const Paid = { args: { sample: 'paid' } };
export const HeldUnverified = { args: { sample: 'heldUnverified' } };
export const VerifiedHeld = { args: { sample: 'verifiedHeld' } };
export const ClaimPending = { args: { sample: 'claimPending' } };
export const VerifiedHeldExpiredSlot = { args: { sample: 'verifiedHeldExpiredSlot' } };
export const VerifiedHeldRevokedSlot = { args: { sample: 'verifiedHeldRevokedSlot' } };
export const VerifiedHeldNoWallet = { args: { sample: 'verifiedHeldNoWallet' } };
export const HeldIdentityUnavailable = { args: { sample: 'heldIdentityUnavailable' } };
export const HeldNoFarmer = { args: { sample: 'heldNoFarmer' } };
export const HeldPlotExpired = { args: { sample: 'heldPlotExpired' } };
export const HeldCap = { args: { sample: 'heldCap' } };
export const HeldZoneMismatch = { args: { sample: 'heldZoneMismatch' } };
export const ClaimWindowElapsed = { args: { sample: 'claimWindowElapsed' } };
export const SlotExpired = { args: { sample: 'slotExpired' } };
export const SlotRevoked = { args: { sample: 'slotRevoked' } };
export const Unavailable = { args: { sample: 'unavailable' } };
export const VerificationCancelled = { args: { sample: 'verificationCancelled' } };

async function waitForHydration(canvasElement) {
  await waitFor(async () => {
    const islands = canvasElement.querySelectorAll('astro-island');
    await expect(islands.length).toBeGreaterThan(0);
    for (const island of islands) await expect(island).not.toHaveAttribute('ssr');
  }, { timeout: 5000 });
}

export const CancelIdentityCheck = {
  args: { sample: 'heldUnverified' },
  play: async ({ canvasElement }) => {
    await waitForHydration(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Preview identity check' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Cancel demo check' }));
    await expect(await canvas.findByRole('status')).toHaveTextContent('Identity check cancelled');
    await expect(canvas.getByText('Unverified · Level 0')).toBeVisible();
    await expect(canvas.getByText('Held', { exact: true })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Preview claim request' })).not.toBeInTheDocument();
  },
};

export const ClaimRequestStaysHeld = {
  args: { sample: 'verifiedHeld' },
  play: async ({ canvasElement }) => {
    await waitForHydration(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Preview claim request' }));
    await expect(await canvas.findByRole('status')).toHaveTextContent('no payment is confirmed');
    await expect(canvas.getByText('Held', { exact: true })).toBeVisible();
    await expect(canvas.queryByText('Paid', { exact: true })).not.toBeInTheDocument();
  },
};
