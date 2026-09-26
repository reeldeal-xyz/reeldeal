import MarketplaceDiscovery from '../../src/components/organisms/marketplace/MarketplaceDiscovery.astro';
import { expect, userEvent, waitFor, within } from 'storybook/test';

async function hydratedCanvas(canvasElement) {
  await waitFor(() => expect(canvasElement.querySelector('astro-island')).not.toHaveAttribute('ssr'), { timeout: 5000 });
  return within(canvasElement);
}

async function recoverSamples({ canvasElement }) {
  const canvas = await hydratedCanvas(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Load sample inventory' }));
  await expect(canvas.getByRole('status')).toHaveTextContent('3 sample lots shown');
  await expect(canvas.getByRole('searchbox', { name: 'Search fish' })).toBeEnabled();
}

export default {
  title: 'ReelDeal/03 Organisms/Marketplace Discovery',
  component: MarketplaceDiscovery,
  parameters: { layout: 'fullscreen' },
};

export const English = {};
export const Japanese = { args: { initialLocale: 'ja' } };
export const Sold = { args: { initialAvailability: 'sold' } };
export const EmptySearch = { args: { initialQuery: 'no matching fish' } };
export const Loading = { args: { initialState: 'loading' } };
export const Unavailable = { args: { initialState: 'unavailable' } };
export const RecoverSamples = { args: { initialState: 'unavailable' }, play: recoverSamples };
export const InteractiveFilters = { play: async ({ canvasElement }) => {
  const canvas = await hydratedCanvas(canvasElement);
  await userEvent.type(canvas.getByRole('searchbox', { name: 'Search fish' }), 'saba');
  await expect(canvas.getByRole('status')).toHaveTextContent('1 sample lots shown');
  await userEvent.click(canvas.getByRole('button', { name: '日本語' }));
  await expect(canvas.getByRole('searchbox', { name: '魚を検索' })).toHaveValue('saba');
  await expect(canvas.getByRole('status')).toHaveTextContent('1 件のサンプルを表示');
  await expect(await canvas.findByRole('link', { name: '詳細' })).toBeVisible();
  await userEvent.selectOptions(canvas.getByRole('combobox', { name: '販売状況' }), 'open');
  await expect(canvas.getByRole('status')).toHaveTextContent('0 件のサンプルを表示');
  await userEvent.click(canvas.getByRole('button', { name: '絞り込みを解除' }));
  await expect(canvas.getByRole('status')).toHaveTextContent('3 件のサンプルを表示');
  await userEvent.selectOptions(canvas.getByRole('combobox', { name: '魚種' }), 'sanma');
  await userEvent.selectOptions(canvas.getByRole('combobox', { name: '販売状況' }), 'reserved');
  await expect(canvas.getByRole('status')).toHaveTextContent('1 件のサンプルを表示');
  await userEvent.click(await canvas.findByRole('link', { name: '詳細' }));
  const detail = canvasElement.querySelector('#market-preview-detail-RD-LOT-002');
  await expect(detail).toHaveAttribute('open');
  await expect(within(detail).getByText('318 mm')).toBeVisible();
} };
