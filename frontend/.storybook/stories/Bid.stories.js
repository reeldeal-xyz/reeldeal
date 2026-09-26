import Bid from './BidShowcase.astro';
import { expect, userEvent, within } from 'storybook/test';

async function sendOffer({ canvasElement }) {
  const canvas = within(canvasElement);
  const connect = await canvas.findByRole('button', { name: 'Connect wallet' });
  await userEvent.click(connect);
  const submit = await canvas.findByRole('button', { name: 'Sign demo offer' });
  await expect(submit).toBeEnabled();
  await userEvent.click(submit);
  return canvas;
}

export default { title: 'ReelDeal/03 Organisms/Bid', component: Bid, args: { scenario: 'ready' } };
export const NoWallet = {};
export const WalletCancelled = { args: { scenario: 'cancelled' }, play: async context => { const canvas = await sendOffer(context); await expect(await canvas.findByRole('alert')).toHaveTextContent('Cancelled in your wallet'); } };
export const OfferReceived = { play: async context => { const canvas = await sendOffer(context); await expect(await canvas.findByText('Offer received')).toBeVisible(); } };
export const Retry = { args: { scenario: 'timeout' }, play: async context => {
  const canvas = await sendOffer(context);
  await expect(await canvas.findByRole('alert')).toHaveTextContent('Retry sending the same signature');
  const retry = await canvas.findByRole('button', { name: 'Retry same signature' });
  await expect(retry).toBeEnabled();
  await expect(canvas.getByRole('textbox', { name: 'Your offer · JPY' })).toBeDisabled();
  await userEvent.click(retry);
  await expect(await canvas.findByText('Offer received')).toBeVisible();
} };
export const Pending = { args: { scenario: 'pending' }, play: sendOffer };
export const Closed = { args: { scenario: 'closed' } };
export const Unavailable = { args: { scenario: 'unavailable' } };
export const InvalidAmount = { play: async context => {
  const canvas = within(context.canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: 'Connect wallet' }));
  const input = canvas.getByRole('textbox', { name: 'Your offer · JPY' });
  await userEvent.clear(input); await userEvent.type(input, '0');
  await userEvent.click(canvas.getByRole('button', { name: 'Sign demo offer' }));
  await expect(await canvas.findByRole('alert')).toHaveTextContent('greater than zero');
} };
