import MarketplaceDiscovery from '../../src/components/organisms/marketplace/MarketplaceDiscovery.astro';
import { marketplacePreviewItems } from '../../src/fixtures/marketplace-preview';
import { expect, userEvent, waitFor, within } from 'storybook/test';

async function hydratedCanvas(canvasElement) {
  await waitFor(() => expect(canvasElement.querySelector('astro-island')).not.toHaveAttribute('ssr'), { timeout: 5000 });
  return within(canvasElement);
}

async function recoverSamples({ canvasElement }) {
  const canvas = await hydratedCanvas(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Load sample inventory' }));
  await expect(canvas.getByRole('status')).toHaveTextContent(`${marketplacePreviewItems.length} sample lots shown`);
  await expect(canvas.getByRole('searchbox', { name: 'Search fish' })).toBeEnabled();
}

export default {
  title: 'ReelDeal/03 Organisms/Marketplace Discovery',
  component: MarketplaceDiscovery,
  parameters: { layout: 'fullscreen' },
};

export const English = {};
export const Japanese = { args: { initialLocale: 'ja' } };
export const Storefront = {
  args: { live: true },
  globals: { viewport: { value: 'iphone17', isRotated: false } },
  play: async ({ canvasElement, globals }) => {
    const canvas = await hydratedCanvas(canvasElement);
    const viewportWidth = { iphone17: 402, ipad: 820, desktop1440: 1440 }[globals.viewport.value];
    await waitFor(() => expect(window.innerWidth).toBe(viewportWidth));
    const oysterCard = canvasElement.querySelector('[data-market-preview-item="KARAKUWA-OYSTERS"]');
    const review = within(oysterCard).getByRole('button', { name: 'Review purchase' });
    const cardWidth = oysterCard.getBoundingClientRect().width;
    await userEvent.click(review);
    const purchase = canvas.getByRole('dialog', { name: 'Oyster' });
    await expect(purchase).toBeVisible();
    await waitFor(() => expect(purchase.querySelector('astro-island')).not.toHaveAttribute('ssr'), { timeout: 5000 });
    expect(purchase.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    expect(purchase.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(oysterCard.getBoundingClientRect().width).toBe(cardWidth);
    await expect(within(purchase).getByText('Relief fund · 5%')).toBeVisible();
    await userEvent.click(within(purchase).getByRole('button', { name: 'Close purchase' }));
    await expect(purchase).not.toHaveAttribute('open');
    await expect(review).toHaveFocus();
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search fish' }), 'saba');
    await expect(canvas.getByRole('status')).toHaveTextContent('1 item');
    await expect(canvas.getByRole('heading', { name: 'Chub mackerel' })).toBeVisible();
    const detail = canvasElement.querySelector('#market-preview-detail-RD-LOT-003');
    await userEvent.click(canvas.getByRole('button', { name: 'Review purchase' }));
    await expect(detail).toHaveAttribute('open');
    await expect(within(detail).getByText('Relief fund · 5%')).toBeVisible();
    await userEvent.click(within(detail).getByRole('button', { name: 'Close purchase' }));
    await userEvent.click(canvas.getByRole('button', { name: '日本語' }));
    await expect(canvas.getByRole('heading', { name: 'サバ' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '購入内容を確認' }));
    await expect(await within(detail).findByRole('button', { name: 'ウォレットで支払う' })).toBeVisible();
    await userEvent.click(within(detail).getByRole('button', { name: '閉じる' }));
    const grid = canvasElement.querySelector('.marketplace-preview__grid');
    expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth + 1);
    if (grid.clientWidth > 600) expect(detail.closest('[data-market-preview-item]').getBoundingClientRect().width).toBeLessThan(grid.clientWidth / 1.5);
  },
};
export const StorefrontIPad = { args: { live: true }, globals: { viewport: { value: 'ipad', isRotated: false } }, play: Storefront.play };
export const StorefrontDesktop = { args: { live: true }, globals: { viewport: { value: 'desktop1440', isRotated: false } }, play: Storefront.play };
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
  await expect(canvas.getByRole('status')).toHaveTextContent(`${marketplacePreviewItems.length} 件のサンプルを表示`);
  await userEvent.selectOptions(canvas.getByRole('combobox', { name: '魚種' }), 'sanma');
  await userEvent.selectOptions(canvas.getByRole('combobox', { name: '販売状況' }), 'reserved');
  await expect(canvas.getByRole('status')).toHaveTextContent('1 件のサンプルを表示');
  await userEvent.click(await canvas.findByRole('link', { name: '詳細' }));
  const detail = canvasElement.querySelector('#market-preview-detail-RD-LOT-002');
  await expect(detail).toHaveAttribute('open');
  await expect(within(detail).getByText('318 mm')).toBeVisible();
} };
