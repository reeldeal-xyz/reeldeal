// In-app wallet for the LIFF app (issue #13): a viem private key generated on-device and kept in
// localStorage. No seed phrase is ever shown to the farmer.
//
// TODO (before real funds / mainnet): this stores the raw private key in plaintext localStorage,
// which is fine for a Sepolia demo but not a real custody model. Upgrade path: wrap the key with a
// WebAuthn-derived secret, or move to a proper embedded-wallet provider, before this holds value
// anyone would miss.
'use client';

import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { Hex } from 'viem';

const STORAGE_KEY = 'umi.wallet.privateKey';

function requireBrowser(): void {
  if (typeof window === 'undefined') {
    throw new Error('wallet.ts must run in the browser');
  }
}

function loadOrCreatePrivateKey(): Hex {
  requireBrowser();
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing as Hex;

  const created = generatePrivateKey();
  window.localStorage.setItem(STORAGE_KEY, created);
  return created;
}

/** Returns the on-device account, creating a fresh wallet on first run. */
export function getOrCreateWalletAccount(): PrivateKeyAccount {
  return privateKeyToAccount(loadOrCreatePrivateKey());
}

/** Convenience: just the address, for display. */
export function getOrCreateWalletAddress(): Hex {
  return getOrCreateWalletAccount().address;
}

/** True if a wallet already exists on this device (doesn't create one). */
export function hasWallet(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEY) !== null;
}
