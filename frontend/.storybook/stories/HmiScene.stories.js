import HmiScene from './HmiPageShowcase.astro';
import forecast from '../fixtures/hmi-forecast.json';
import plots from '../fixtures/hmi-plots.json';
import heat from '../fixtures/hmi-heat.json';
import species from '../fixtures/hmi-species.json';
import { expect, userEvent, waitFor, within } from 'storybook/test';

const initMap = async (canvasElement) => {
  const { initHmiMap } = await import('../../src/lib/hmi-map.client');
  initHmiMap(canvasElement);
};
const selectLayers = async (canvas) => {
  await userEvent.click(canvas.getByRole('button', { name: 'Layers' }));
  await waitFor(() => expect(canvas.getByRole('heading', { name: 'Layers' })).toBeVisible());
  await userEvent.click(canvas.getByRole('checkbox', { name: 'Sea temperature' }));
  await userEvent.click(canvas.getByRole('checkbox', { name: 'Temp anomaly' }));
  await expect(canvas.getByRole('checkbox', { name: 'Satellite' })).toBeChecked();
  await expect(canvas.getByRole('checkbox', { name: 'Sea temperature' })).toBeChecked();
  await expect(canvas.getByRole('checkbox', { name: 'Temp anomaly' })).toBeChecked();
};

export default {
  title: 'ReelDeal/04 Pages/Coastal map',
  component: HmiScene,
  parameters: { layout: 'fullscreen', backgrounds: { default: 'paper' } },
  args: {
    hmi: { status: 'available', plots },
    risk: { status: 'partial', data: heat },
    speciesInfo: { status: 'available', data: species },
    plotCode: 'p1213-001',
    season: '2025',
    requestedSpecies: 'scallop',
    metric: 'SST',
  },
};

export const Mobile390 = {
  globals: { viewport: { value: 'mobile390', isRotated: false } },
  play: async ({ canvasElement }) => {
    await initMap(canvasElement);
    const canvas = within(canvasElement);
    await selectLayers(canvas);
    await userEvent.click(canvas.getByRole('button', { name: 'Close layers' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Thresholds' }));
    await waitFor(() => expect(canvas.getByText('Relief thresholds')).toBeVisible());
    await expect(canvas.queryByRole('radio', { name: /^Nori/ })).toBeNull();
  },
};
export const MobileLayers = {
  globals: { viewport: { value: 'mobile390', isRotated: false } },
  play: async ({ canvasElement }) => {
    await initMap(canvasElement);
    await selectLayers(within(canvasElement));
  },
};
export const Mobile320 = { globals: { viewport: { value: 'mobile320', isRotated: false } }, play: ({ canvasElement }) => initMap(canvasElement) };
export const Mobile320Layers = {
  globals: { viewport: { value: 'mobile320', isRotated: false } },
  play: async ({ canvasElement }) => {
    await initMap(canvasElement);
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Layers' }));
  },
};
export const MobileCatalogue = {
  globals: { viewport: { value: 'mobile390', isRotated: false } },
  play: async ({ canvasElement }) => {
    await initMap(canvasElement);
    canvasElement.querySelector('.species-picker')?.scrollTo({ left: 205 });
  },
};
export const MobileForecast = {
  globals: { viewport: { value: 'mobile390', isRotated: false } },
  play: async ({ canvasElement }) => {
    await initMap(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Forecast' }));
    await waitFor(() => expect(canvas.getByText('Forecast fetching is disabled in previews.')).toBeVisible());
  },
};
export const MobileMarket = {
  globals: { viewport: { value: 'mobile390', isRotated: false } },
  play: async ({ canvasElement }) => {
    await initMap(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Fish market' }));
    await waitFor(() => expect(canvas.getByRole('heading', { name: 'Fish market' })).toBeVisible());
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Connect wallet' })).toBeVisible());
    await expect(canvas.getByRole('heading', { name: 'Skipjack tuna (katsuo)' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: /buy|checkout/i })).toBeNull();
  },
};
export const Desktop1440 = { globals: { viewport: { value: 'desktop1440', isRotated: false } }, play: ({ canvasElement }) => initMap(canvasElement) };

// Japanese copy, the JAXA chl-a HAB layer and area analysis (#131). Tiles don't load in Storybook; the controls,
// legend chip and caveat do.
const HAB_LAYER = {
  module: 'hab', layer: 'chla_sgli_monthly', cadence: 'monthly', date: '2025-08-01', region: 'miyagi',
  product: 'GCOM-C_SGLI_L3-CHLA.daytime.v3.monthly', variable: 'CHL', unit: 'mg/m3', bbox: [140.8, 37.7, 142.0, 39.1],
  validFraction: 0.586, tileUrl: '/hab/tiles/miyagi/monthly/2025-08/chla_sgli_monthly/{z}/{x}/{y}.png',
  tileScale: { kind: 'log', min: 0.1, max: 30, unit: 'mg/m3', colors: ['#2c1c7a', '#2a4fb8', '#2294c9', '#2fc0b0', '#7ad86b', '#d7e24a', '#f6a93b', '#d8412f'] },
  zarrUrl: null, sha256: '1e7778b1ea5b45ebc3ac6389def4e2be104775021f61ba20234c258f09bee895',
};
export const MobileJapaneseHab = {
  globals: { viewport: { value: 'mobile390', isRotated: false } },
  args: { lang: 'ja', hab: { status: 'available', layer: HAB_LAYER }, habMonth: '08' },
  play: async ({ canvasElement }) => {
    await initMap(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'レイヤー' }));
    await userEvent.click(canvas.getByRole('checkbox', { name: 'HAB指標（JAXA）' }));
    await userEvent.click(canvas.getByRole('button', { name: 'レイヤーを閉じる' }));
    await waitFor(() => expect(canvasElement.querySelector('[data-hab-chip]')).toBeVisible());
    await expect(canvas.getByText('藻類量の指標。貝毒・出荷規制を示すものではありません。')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '範囲' }));
    await userEvent.click(canvas.getByRole('button', { name: '範囲を描く' }));
    await expect(canvas.getByRole('button', { name: '描画を終了' })).toHaveAttribute('aria-pressed', 'true');
  },
};

const fits = (canvasElement) => {
  const panel = canvasElement.querySelector('.map-shelf[data-open]');
  const map = canvasElement.querySelector('#hmi-map').getBoundingClientRect();
  const rect = panel.getBoundingClientRect();
  expect(rect.left).toBeGreaterThanOrEqual(map.left);
  expect(rect.right).toBeLessThanOrEqual(map.right + 1);
  expect(rect.bottom).toBeLessThanOrEqual(canvasElement.querySelector('.coast-dock').getBoundingClientRect().top);
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
};
const playForecast = async ({ canvasElement }) => {
  await initMap(canvasElement);
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Forecast', exact: true }));
  const { renderForecast } = await import('../../src/lib/weather-forecast.client');
  const target = canvasElement.querySelector('[data-weather-content]');
  const playback = renderForecast(target, forecast, 'en', forecast.fetchedAt, { species: 'scallop' });
  canvasElement.querySelector('[data-weather-status]').textContent = 'Recorded forecast · 26 Sep 2026';
  const slider = canvas.getByRole('slider', { name: 'Forecast hour · JST' });
  await userEvent.click(canvas.getByRole('button', { name: 'Play', exact: true }));
  await waitFor(() => expect(Number(slider.value)).toBeGreaterThan(0));
  await userEvent.click(canvas.getByRole('button', { name: 'Pause', exact: true }));
  slider.value = '24'; slider.dispatchEvent(new Event('input', { bubbles: true }));
  await expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('JST'));
  await expect(canvas.getByRole('button', { name: 'Play', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const unit = canvas.getByRole('combobox', { name: 'Unit' });
  unit.value = '°F'; unit.dispatchEvent(new Event('change', { bubbles: true }));
  await expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('°F'));
  fits(canvasElement);
  playback.pause();
};
export const IPhoneForecastPlayer = { globals: { viewport: { value: 'iphone17', isRotated: false } }, play: playForecast };
export const IPadForecastPlayer = { globals: { viewport: { value: 'ipad', isRotated: false } }, play: playForecast };
export const IPadLandscape = { globals: { viewport: { value: 'ipadLandscape', isRotated: false } }, play: playForecast };
export const PanelKeyboard = {
  globals: { viewport: { value: 'iphone17', isRotated: false } },
  play: async ({ canvasElement }) => {
    await initMap(canvasElement); const canvas = within(canvasElement);
    for (const name of ['Layers', 'Thresholds', 'Forecast', 'Area', 'Observations ↑']) {
      const button = canvas.getByRole('button', { name, exact: true });
      await userEvent.click(button);
      const panel = canvasElement.querySelector('.map-shelf[data-open]');
      await expect(panel.querySelector('[data-close-shelf]')).toHaveFocus();
      fits(canvasElement);
      await userEvent.keyboard('{Escape}');
      await expect(button).toHaveFocus();
      await expect(button).toHaveAttribute('aria-expanded', 'false');
    }
  },
};
