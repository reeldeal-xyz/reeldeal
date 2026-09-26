import { beforeEach, describe, expect, test } from 'bun:test';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import {
  _resetSiweNoncesForTests,
  buildSiweMessage,
  issueNonce,
  parseSiweMessage,
  verifySiweMessage,
  walletFromSessionUserId,
  walletSessionUserId,
  type SiweMessageFields,
} from './siwe';

const account = privateKeyToAccount(('0x' + '42'.repeat(32)) as Hex);
const DOMAIN = 'app.reeldeal.example';
const CHAIN_ID = 11155111;
const NOW = 1_800_000_000_000; // fixed instant (ms) so "expired"/"issued at" math is deterministic

function baseFields(overrides: Partial<SiweMessageFields> = {}, nonce = issueNonce(() => NOW)): SiweMessageFields {
  return {
    domain: DOMAIN,
    address: account.address,
    statement: 'Sign in to Reel Deal.',
    uri: `https://${DOMAIN}/app`,
    version: '1',
    chainId: CHAIN_ID,
    nonce,
    issuedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

async function signedMessage(overrides: Partial<SiweMessageFields> = {}, nonce?: string) {
  const fields = baseFields(overrides, nonce ?? issueNonce(() => NOW));
  const message = buildSiweMessage(fields);
  const signature = await account.signMessage({ message });
  return { message, signature };
}

beforeEach(() => {
  _resetSiweNoncesForTests();
});

describe('walletSessionUserId / walletFromSessionUserId', () => {
  test('round-trips an address', () => {
    const userId = walletSessionUserId(account.address);
    expect(userId).toBe(`wallet:${account.address.toLowerCase()}`);
    expect(walletFromSessionUserId(userId)).toBe(account.address.toLowerCase() as `0x${string}`);
  });

  test('returns null for a non-wallet-session userId', () => {
    expect(walletFromSessionUserId('U1234567890abcdef')).toBeNull();
  });
});

describe('parseSiweMessage', () => {
  test('round-trips buildSiweMessage output', () => {
    const fields = baseFields();
    const parsed = parseSiweMessage(buildSiweMessage(fields));
    expect(parsed).toEqual(fields);
  });

  test('rejects garbage input', () => {
    expect(parseSiweMessage('not a siwe message')).toBeNull();
  });
});

describe('verifySiweMessage', () => {
  test('accepts a good signature', async () => {
    const { message, signature } = await signedMessage();
    const result = await verifySiweMessage({
      message,
      signature,
      expectedDomain: DOMAIN,
      expectedChainId: CHAIN_ID,
      now: () => NOW,
    });
    expect(result).toEqual({ ok: true, address: account.address });
  });

  test('rejects a wrong domain', async () => {
    const { message, signature } = await signedMessage({ domain: 'evil.example' });
    const result = await verifySiweMessage({
      message,
      signature,
      expectedDomain: DOMAIN,
      expectedChainId: CHAIN_ID,
      now: () => NOW,
    });
    expect(result).toEqual({ ok: false, error: 'wrong_domain' });
  });

  test('rejects a wrong chain id', async () => {
    const { message, signature } = await signedMessage({ chainId: 1 }); // mainnet, not Sepolia
    const result = await verifySiweMessage({
      message,
      signature,
      expectedDomain: DOMAIN,
      expectedChainId: CHAIN_ID,
      now: () => NOW,
    });
    expect(result).toEqual({ ok: false, error: 'wrong_chain' });
  });

  test('rejects an expired message', async () => {
    const { message, signature } = await signedMessage({ expirationTime: new Date(NOW - 1000).toISOString() });
    const result = await verifySiweMessage({
      message,
      signature,
      expectedDomain: DOMAIN,
      expectedChainId: CHAIN_ID,
      now: () => NOW,
    });
    expect(result).toEqual({ ok: false, error: 'expired' });
  });

  test('rejects a tampered signature', async () => {
    const { message, signature } = await signedMessage();
    // Flip one nibble well inside the `r` component (not the trailing `v` byte -- v is only 27/28/0/1 and
    // some recovery paths treat those as equivalent encodings of the same two recovery ids, which made an
    // earlier version of this test flaky: flipping v sometimes re-encoded the *same* recovery id instead of
    // producing a different one). XOR-ing a nibble always changes it, so this always invalidates the sig.
    const idx = 10;
    const original = parseInt(signature[idx]!, 16);
    const flipped = (original ^ 0x1).toString(16);
    const tampered = (signature.slice(0, idx) + flipped + signature.slice(idx + 1)) as Hex;
    const result = await verifySiweMessage({
      message,
      signature: tampered,
      expectedDomain: DOMAIN,
      expectedChainId: CHAIN_ID,
      now: () => NOW,
    });
    expect(result).toEqual({ ok: false, error: 'invalid_signature' });
  });

  test('rejects a reused nonce (single-use)', async () => {
    const { message, signature } = await signedMessage();
    const first = await verifySiweMessage({ message, signature, expectedDomain: DOMAIN, expectedChainId: CHAIN_ID, now: () => NOW });
    expect(first.ok).toBe(true);

    const replay = await verifySiweMessage({ message, signature, expectedDomain: DOMAIN, expectedChainId: CHAIN_ID, now: () => NOW });
    expect(replay).toEqual({ ok: false, error: 'invalid_nonce' });
  });

  test('rejects an unknown nonce', async () => {
    const fields = baseFields({}, 'deadbeef'.repeat(4));
    const message = buildSiweMessage(fields);
    const signature = await account.signMessage({ message });
    const result = await verifySiweMessage({ message, signature, expectedDomain: DOMAIN, expectedChainId: CHAIN_ID, now: () => NOW });
    expect(result).toEqual({ ok: false, error: 'invalid_nonce' });
  });
});
