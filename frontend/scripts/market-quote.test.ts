/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { MAX_RELIEF_BPS, matchesDemoListing, parseQuoteRequest } from '../src/lib/chain/quote.server';
import { DEMO_LISTING } from '../src/fixtures/market-checkout-demo';

const valid = () => ({
  listingId: `0x${'a'.repeat(64)}`,
  buyer: '0x1111111111111111111111111111111111111111',
  seller: '0x2222222222222222222222222222222222222222',
  total: '12000000000000000000000',
  reliefBps: 500,
});

test('the signer only accepts the published Sepolia demo listing', () => {
  const request = parseQuoteRequest({
    listingId: DEMO_LISTING.listingId,
    buyer: '0x1111111111111111111111111111111111111111',
    seller: DEMO_LISTING.sellerAddress,
    total: DEMO_LISTING.totalWei.toString(),
    reliefBps: DEMO_LISTING.reliefBps,
  });
  expect(request.ok).toBe(true);
  if (!request.ok) return;
  expect(matchesDemoListing(request.value)).toBe(true);
  expect(matchesDemoListing({ ...request.value, seller: '0x2222222222222222222222222222222222222222' })).toBe(false);
  expect(matchesDemoListing({ ...request.value, total: 1n })).toBe(false);
});

describe('parseQuoteRequest', () => {
  test('accepts a well-formed request', () => {
    const result = parseQuoteRequest(valid());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.total).toBe(12_000n * 10n ** 18n);
      expect(result.value.reliefBps).toBe(500);
    }
  });

  test('rejects reliefBps above the router ceiling', () => {
    expect(MAX_RELIEF_BPS).toBe(1000);
    expect(parseQuoteRequest({ ...valid(), reliefBps: 1001 })).toEqual({ ok: false, error: 'invalid-reliefBps' });
    expect(parseQuoteRequest({ ...valid(), reliefBps: MAX_RELIEF_BPS }).ok).toBe(true);
  });

  test('rejects malformed listingId/addresses/total/reliefBps', () => {
    expect(parseQuoteRequest({ ...valid(), listingId: '0xnothex' })).toEqual({ ok: false, error: 'invalid-listingId' });
    expect(parseQuoteRequest({ ...valid(), listingId: '0xabc' })).toEqual({ ok: false, error: 'invalid-listingId' });
    expect(parseQuoteRequest({ ...valid(), buyer: 'not-an-address' })).toEqual({ ok: false, error: 'invalid-buyer' });
    expect(parseQuoteRequest({ ...valid(), seller: 'not-an-address' })).toEqual({ ok: false, error: 'invalid-seller' });
    expect(parseQuoteRequest({ ...valid(), total: '12.5' })).toEqual({ ok: false, error: 'invalid-total' });
    expect(parseQuoteRequest({ ...valid(), total: '0' })).toEqual({ ok: false, error: 'invalid-total' });
    expect(parseQuoteRequest({ ...valid(), total: '-5' })).toEqual({ ok: false, error: 'invalid-total' });
    expect(parseQuoteRequest({ ...valid(), reliefBps: -1 })).toEqual({ ok: false, error: 'invalid-reliefBps' });
    expect(parseQuoteRequest({ ...valid(), reliefBps: 1.5 })).toEqual({ ok: false, error: 'invalid-reliefBps' });
  });

  test('rejects a missing or non-object body', () => {
    expect(parseQuoteRequest(null)).toEqual({ ok: false, error: 'invalid-request' });
    expect(parseQuoteRequest('nope')).toEqual({ ok: false, error: 'invalid-request' });
    expect(parseQuoteRequest({})).toEqual({ ok: false, error: 'invalid-listingId' });
  });
});
