import Wallet from './WalletShowcase.astro';
import { expect, userEvent, waitFor, within } from 'storybook/test';
export default { title: 'ReelDeal/03 Organisms/Wallet Preview', component: Wallet };
export const Disconnected = {};
export const Connected = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  // The SSR button exists before React attaches its click handler.
  await waitFor(() => expect(canvasElement.querySelector('astro-island')).not.toHaveAttribute('ssr'), { timeout: 5000 });
  await userEvent.click(await canvas.findByRole('button', { name: 'Connect demo wallet' }));
  await expect(await canvas.findByRole('status')).toHaveTextContent('Demo wallet connected');
} };
