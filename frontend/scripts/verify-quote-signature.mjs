#!/usr/bin/env bun
// Local-only signature check for POST /api/market/quote (not part of `bun test` -- reads a real secret
// from the environment). Run after `cp` -ing QUOTE_SIGNER_PRIVATE_KEY into frontend/.env (never commit it):
//
//   bun run frontend/scripts/verify-quote-signature.mjs
//
// Builds a quote with the same `signQuoteRequest` the API route calls, then uses viem's
// `recoverTypedDataAddress` to confirm the signature recovers to the configured co-op signer address.
import assert from 'node:assert/strict';
import { recoverTypedDataAddress } from 'viem';
import { QUOTE_EIP712_TYPES, saleRouterEip712Domain, DEPLOYED } from '@repo/shared';
import { parseQuoteRequest, signQuoteRequest } from '../src/lib/chain/quote.server.ts';

const privateKey = process.env.QUOTE_SIGNER_PRIVATE_KEY;
const rpcUrl = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const expectedSigner = process.env.EXPECTED_QUOTE_SIGNER ?? '0x5f445Ff80F2Ec863eE9d0C78c39112916f30DEF2';

if (!privateKey) {
  console.error('Set QUOTE_SIGNER_PRIVATE_KEY (see frontend/.env) before running this script.');
  process.exit(1);
}

const parsed = parseQuoteRequest({
  listingId: `0x${'a'.repeat(64)}`,
  buyer: '0x1111111111111111111111111111111111111111',
  seller: '0x2222222222222222222222222222222222222222',
  total: (12_000n * 10n ** 18n).toString(),
  reliefBps: 500,
});
assert(parsed.ok, 'fixture quote request failed validation');

const signed = await signQuoteRequest(parsed.value, privateKey, DEPLOYED.SaleRouter, rpcUrl);

const recovered = await recoverTypedDataAddress({
  domain: saleRouterEip712Domain(DEPLOYED.SaleRouter),
  types: QUOTE_EIP712_TYPES,
  primaryType: 'Quote',
  message: {
    orderId: signed.quote.orderId,
    listingId: signed.quote.listingId,
    buyer: signed.quote.buyer,
    seller: signed.quote.seller,
    total: BigInt(signed.quote.total),
    reliefBps: signed.quote.reliefBps,
    nonce: BigInt(signed.quote.nonce),
    expiry: BigInt(signed.quote.expiry),
  },
  signature: signed.signature,
});

assert.equal(recovered.toLowerCase(), expectedSigner.toLowerCase(), `recovered ${recovered}, expected ${expectedSigner}`);
console.log(`OK: signature recovers to the expected co-op signer (${recovered}).`);
