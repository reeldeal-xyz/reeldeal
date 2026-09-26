import HmiScene from '../../src/components/HmiScene.astro';
import plots from '../fixtures/hmi-plots.json';
import zones from '../fixtures/hmi-zones.json';
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
    hmi: { status: 'available', plots, zones },
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
    await waitFor(() => expect(canvas.getByText('Species thresholds')).toBeVisible());
    await expect(canvas.getByRole('radio', { name: 'Nori' })).toBeDisabled();
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
    await waitFor(() => expect(canvas.getByText('Forecast data is unavailable. The map and chart show observed conditions.')).toBeVisible());
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
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Open the app to buy' })).toBeDisabled());
  },
};
export const Desktop1440 = { globals: { viewport: { value: 'desktop1440', isRotated: false } }, play: ({ canvasElement }) => initMap(canvasElement) };
