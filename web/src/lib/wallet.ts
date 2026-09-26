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

/** Backup ("Show recovery key"): returns the raw private key for this device's wallet. Callers must gate
 *  this behind an explicit confirm step and a strong warning -- see components/liff/WalletPanel.tsx. Never
 *  logged, never sent to the server. */
export function exportPrivateKey(): Hex {
  requireBrowser();
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (!existing) throw new Error('no wallet on this device');
  return existing as Hex;
}

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** Import: restores a wallet on a new device from a raw private key (e.g. after reinstalling the app).
 *  Overwrites whatever key was already on this device -- callers should confirm the resulting address
 *  matches the session's pinned wallet before treating the import as successful. Throws on a malformed key. */
export function importPrivateKey(privateKey: string): Hex {
  requireBrowser();
  const trimmed = privateKey.trim();
  if (!PRIVATE_KEY_PATTERN.test(trimmed)) {
    throw new Error('recovery key must be 32 bytes of hex, prefixed with 0x');
  }
  // Throws if the key isn't a valid secp256k1 scalar (e.g. zero or >= curve order).
  const account = privateKeyToAccount(trimmed as Hex);
  window.localStorage.setItem(STORAGE_KEY, trimmed);
  return account.address;
}
