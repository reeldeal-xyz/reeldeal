import { react, solid } from '@storybook-astro/framework/integrations';

// Stories are Astro wrappers: hydrate through Astro's renderers, without
// loading a second CSF renderer (Solid's old entry-preview export was removed).
const integrations = [react({ include: ['**/react/**'] }), solid({ include: ['**/solid/**'] })];
for (const integration of integrations) integration.storybookEntryPreview = undefined;

export default {
  stories: ['../src/**/*.stories.@(js|ts)', './stories/**/*.stories.@(js|ts)'],
  framework: {
    name: '@storybook-astro/framework',
    options: {
      renderMode: 'static',
      integrations,
    },
  },
  staticDirs: ['../public'],
};
