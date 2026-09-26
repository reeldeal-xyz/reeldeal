/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { claimPreviewState } from '../src/components/organisms/farmer-relief/claim-preview';
import { farmerReliefPreviews as previews } from '../src/fixtures/farmer-relief-preview';
import type { FarmerReliefProps } from '../src/components/organisms/farmer-relief/props';

describe('farmer claim preview guard', () => {
  test('permits a demo only with the relevant hold and current identity, slot and wallet', () => {
    expect(claimPreviewState(previews.verifiedHeld)).toBe('ready');
    expect(claimPreviewState({ ...previews.verifiedHeld, identityLevel: 2 })).toBe('ready');
    expect(claimPreviewState(previews.claimPending)).toBe('ready');
  });
  test('a historical UNVERIFIED hold cannot bypass current slot restrictions', () => {
    const slots: FarmerReliefProps['slot'][] = ['expired', 'revoked', 'unissued', 'requested', 'unavailable'];
    for (const slot of slots) expect(claimPreviewState({ ...previews.verifiedHeld, slot })).toBe('slot-required');
  });
  test('missing or malformed recipient wallets cannot expose a claim control', () => {
    for (const wallet of [undefined, '', '0x1234', `0x${'g'.repeat(40)}`, `0x${'0'.repeat(40)}`]) {
      expect(claimPreviewState({ ...previews.verifiedHeld, wallet })).toBe('wallet-unavailable');
    }
  });
  test('current unknown identity does not become an unverified or eligible identity', () => {
    expect(claimPreviewState(previews.heldUnverified)).toBe('identity-required');
    expect(claimPreviewState(previews.heldIdentityUnavailable)).toBe('identity-unavailable');
  });
  test('other holds, payment, expiry and absent outcomes never expose this action', () => {
    for (const sample of ['heldNoFarmer', 'heldPlotExpired', 'heldCap', 'heldZoneMismatch', 'paid', 'claimWindowElapsed', 'verified', 'unavailable'] as const) {
      expect(claimPreviewState(previews[sample])).toBe('not-applicable');
    }
  });
});
