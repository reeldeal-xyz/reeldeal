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
      // Same public Reown project ID as the existing /app wallet entry. Unset: injected wallets still work.
      NEXT_PUBLIC_REOWN_PROJECT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      LEGACY_WEB_ORIGIN: envField.string({ context: 'server', access: 'secret', optional: true, url: true }),
      PIPELINE_API_URL: envField.string({ context: 'server', access: 'secret', optional: true, url: true }),
      DATABASE_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Sepolia RPC for server-side ReliefPool/SaleRouter reads (frontend/src/lib/chain). The default is a
      // public, non-secret endpoint; override for a private/rate-limited RPC in production.
      SEPOLIA_RPC_URL: envField.string({
        context: 'server', access: 'secret', optional: true,
        default: 'https://ethereum-sepolia-rpc.publicnode.com',
      }),
    },
  },
});
