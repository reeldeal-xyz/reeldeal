import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import solid from '@astrojs/solid-js';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    react({ include: ['**/react/**'] }),
    solid({ include: ['**/solid/**'] }),
  ],
  env: {
    schema: {
      PUBLIC_CHAIN_ID: envField.number({ context: 'client', access: 'public', default: 11155111 }),
      LEGACY_WEB_ORIGIN: envField.string({ context: 'server', access: 'secret', optional: true, url: true }),
      PIPELINE_API_URL: envField.string({ context: 'server', access: 'secret', optional: true, url: true }),
      DATABASE_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});
