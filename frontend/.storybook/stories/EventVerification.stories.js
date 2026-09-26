import EventVerificationShowcase from './EventVerificationShowcase.astro';
import { expect, userEvent, within } from 'storybook/test';

export default {
  title: 'ReelDeal/03 Organisms/Event Verification',
  component: EventVerificationShowcase,
  args: { sample: 'matching' },
};

export const Matching = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Fixture comparisons match')).toBeVisible();
    const provenance = canvas.getByText('Source and provenance');
    await userEvent.click(provenance);
    await expect(canvas.getByText('Synthetic temperature bytes')).toBeVisible();
  },
};
export const Mismatched = { args: { sample: 'mismatched' } };
export const Unavailable = { args: { sample: 'unavailable' } };
export const ObservedReplay = { args: { sample: 'observedReplay' } };
export const AdvisoryOnly = {
  args: { sample: 'advisory' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText('Fixture comparisons match')).not.toBeInTheDocument();
    await expect(canvas.getByText('No payment record applies to this forecast preview.')).toBeVisible();
  },
};
export const IncompleteEvidence = {
  args: { sample: 'incomplete' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Evidence review unavailable')).toBeVisible();
    await expect(canvas.queryByText('Fixture comparisons match')).not.toBeInTheDocument();
  },
};
export const WrongDeployment = { args: { sample: 'wrongDeployment' } };
