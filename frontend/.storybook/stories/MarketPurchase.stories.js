import MarketPurchase from './MarketPurchaseShowcase.astro';
import { expect, userEvent, within } from 'storybook/test';

export default {
  title: 'ReelDeal/04 Pages/Market purchase',
  component: MarketPurchase,
  parameters: { layout: 'fullscreen' },
};

const review = async ({ canvasElement }) => {
  const { initMarketCheckout } = await import('../../src/lib/market.client');
  initMarketCheckout();
  const canvas = within(canvasElement);
  const button = canvas.getByRole('button', { name: 'Review Karakuwa scallops' });
  await userEvent.click(button);
  const dialog = canvas.getByRole('dialog', { name: 'Review purchase' });
  await expect(dialog).toBeVisible();
  const checkout = within(dialog);
  await expect(checkout.getByText('3,040 JPYC', { exact: true })).toBeVisible();
  await expect(checkout.getByText('160 JPYC', { exact: true })).toBeVisible();
  await expect(checkout.getByRole('button', { name: 'Connect wallet & pay' })).toBeDisabled();
  const rect = dialog.getBoundingClientRect();
  await expect(rect.left).toBeGreaterThanOrEqual(0);
  await expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
  await expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
  await expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  await userEvent.click(checkout.getByRole('button', { name: 'Close checkout' }));
  await expect(button).toHaveFocus();
  await userEvent.click(canvas.getByRole('button', { name: 'Review Sea pineapple (hoya)' }));
  await expect(checkout.getByText('90 JPYC', { exact: true })).toBeVisible();
};
export const IPhoneReview = { globals: { viewport: { value: 'iphone17', isRotated: false } }, play: review };
export const IPadReview = { globals: { viewport: { value: 'ipad', isRotated: false } }, play: review };
export const DesktopReview = { globals: { viewport: { value: 'desktop1440', isRotated: false } }, play: review };
