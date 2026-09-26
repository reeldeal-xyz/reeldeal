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
    await userEvent.click(canvas.getByRole('button', { name: 'Layers' }));
    await waitFor(() => expect(canvas.getByText('Map layers')).toBeVisible());
    await userEvent.click(canvas.getByRole('button', { name: 'Close layers' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Thresholds' }));
    await waitFor(() => expect(canvas.getByText('Species thresholds')).toBeVisible());
  },
};
export const Mobile320 = { globals: { viewport: { value: 'mobile320', isRotated: false } }, play: ({ canvasElement }) => initMap(canvasElement) };
export const Desktop1440 = { globals: { viewport: { value: 'desktop1440', isRotated: false } }, play: ({ canvasElement }) => initMap(canvasElement) };
