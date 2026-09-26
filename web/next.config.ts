import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@repo/shared'],
  // Reown AppKit's wagmi adapter pulls in @wagmi/connectors' Coinbase Smart Wallet connector (baseAccount),
  // which in turn pulls in @coinbase/cdp-sdk's optional x402 payment support -- dynamic imports of
  // `@x402/*` packages this repo never installs (we never use Coinbase's x402 payment flow, only plain
  // wallet connect + SIWE). Left un-bundled, the build tries to statically resolve those dynamic imports
  // and fails; marking the package external defers resolution to actual runtime, where that code path is
  // never reached.
  serverExternalPackages: ['@coinbase/cdp-sdk'],
};
export default config;
