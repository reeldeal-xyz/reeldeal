import { describe, expect, test } from 'bun:test';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import { CHAIN_ID, JPYC_EIP712_DOMAIN } from '@repo/shared';
import { walletSessionUserId } from '@/lib/siwe';
import { TRANSFER_WITH_AUTHORIZATION_TYPES } from './wallet-authorization';
import { defaultGetPinnedWallet, handleRelayTransfer, type HandleRelayTransferDeps, type RateLimiter } from './wallet-relay';

// A stand-in JPYC address for the domain -- doesn't need to be the real deployed address for these tests,
// only consistent between what's signed here and what `deps.jpycAddress` tells the handler to verify against.
const JPYC_ADDR = '0x1111111111111111111111111111111111111111' as Address;
const RECIPIENT = '0x3333333333333333333333333333333333333333' as Address;
const NONCE = ('0x' + '33'.repeat(32)) as Hex;
const NOW = 1_700_000_000;

// Deterministic test keys -- never used for anything but signing fixtures in this file.
const pinnedAccount = privateKeyToAccount(('0x' + '11'.repeat(32)) as Hex);
const otherAccount = privateKeyToAccount(('0x' + '22'.repeat(32)) as Hex);

interface SignedFixture {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
  signature: Hex;
}

async function signAs(
  account: PrivateKeyAccount,
  overrides: Partial<Omit<SignedFixture, 'signature'>> = {},
): Promise<SignedFixture> {
  const message = {
    from: overrides.from ?? account.address,
    to: overrides.to ?? RECIPIENT,
    value: overrides.value ?? 1_000n,
    validAfter: overrides.validAfter ?? 0n,
    validBefore: overrides.validBefore ?? BigInt(NOW + 600),
    nonce: overrides.nonce ?? NONCE,
  };
  const signature = await account.signTypedData({
    domain: { ...JPYC_EIP712_DOMAIN, chainId: CHAIN_ID, verifyingContract: JPYC_ADDR },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
  });
  return { ...message, signature };
}

function toBody(signed: SignedFixture) {
  return {
    to: signed.to,
    value: signed.value.toString(),
    validAfter: signed.validAfter.toString(),
    validBefore: signed.validBefore.toString(),
    nonce: signed.nonce,
    signature: signed.signature,
  };
}

const alwaysAllow: RateLimiter = { consume: () => true };

function makeDeps(
  overrides: {
    balance?: bigint;
    getPinnedWallet?: HandleRelayTransferDeps['getPinnedWallet'];
    now?: () => number;
    rateLimiter?: RateLimiter;
  } = {},
): { deps: HandleRelayTransferDeps; calls: { simulate: unknown[]; write: unknown[] } } {
  const calls = { simulate: [] as unknown[], write: [] as unknown[] };
  const balance = overrides.balance ?? 1_000_000n;

  const deps: HandleRelayTransferDeps = {
    getChainClients: () => ({
      publicClient: {
        readContract: (async () => balance) as never,
        simulateContract: (async (args: unknown) => {
          calls.simulate.push(args);
          return { request: args };
        }) as never,
        waitForTransactionReceipt: (async () => ({})) as never,
      },
      walletClient: {
        writeContract: (async (args: unknown) => {
          calls.write.push(args);
          return ('0x' + '44'.repeat(32)) as Hex;
        }) as never,
      },
      account: { address: '0x9999999999999999999999999999999999999999' } as never,
    }),
    jpycAddress: JPYC_ADDR,
    getPinnedWallet: overrides.getPinnedWallet ?? (() => pinnedAccount.address),
    now: overrides.now ?? (() => NOW),
    rateLimiter: overrides.rateLimiter ?? alwaysAllow,
  };
  return { deps, calls };
}

describe('handleRelayTransfer: request validation', () => {
  test('rejects a malformed body', async () => {
    const { deps } = makeDeps();
    expect((await handleRelayTransfer({}, 'U1', deps)).status).toBe(400);
    expect((await handleRelayTransfer(null, 'U1', deps)).status).toBe(400);
    expect((await handleRelayTransfer({ to: 'not-an-address' }, 'U1', deps)).status).toBe(400);
  });

  test('rate-limits repeated calls from the same LINE user', async () => {
    const { deps } = makeDeps({ rateLimiter: { consume: () => false } });
    const signed = await signAs(pinnedAccount);
    const res = await handleRelayTransfer(toBody(signed), 'U1', deps);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('rate_limited');
  });
});

describe('handleRelayTransfer: pinned wallet', () => {
  test('rejects when this LINE user has no pinned wallet yet', async () => {
    const { deps } = makeDeps({ getPinnedWallet: () => null });
    const signed = await signAs(pinnedAccount);
    const res = await handleRelayTransfer(toBody(signed), 'U1', deps);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('no_pinned_wallet');
  });
});

describe('defaultGetPinnedWallet (session-kind derivation)', () => {
  test('decodes a wallet session id straight to its address -- no LINE directory lookup', async () => {
    const resolved = await defaultGetPinnedWallet(walletSessionUserId(pinnedAccount.address));
    expect(resolved).toBe(pinnedAccount.address.toLowerCase());
  });

  test('falls through to the LINE pinned-wallet directory for a non-wallet-session id', async () => {
    // No wallet has ever been pinned for this made-up LINE sub, so the directory correctly returns null
    // rather than misreading it as a wallet session.
    const resolved = await defaultGetPinnedWallet('U-some-line-sub-that-was-never-pinned');
    expect(resolved).toBeNull();
  });
});

describe('handleRelayTransfer: end-to-end with a wallet session', () => {
  test('relays a validly-signed transfer using the wallet session itself as the pinned wallet', async () => {
    const { deps, calls } = makeDeps({ getPinnedWallet: defaultGetPinnedWallet });
    const signed = await signAs(pinnedAccount);
    const res = await handleRelayTransfer(toBody(signed), walletSessionUserId(pinnedAccount.address), deps);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(calls.simulate.length).toBe(1);
  });
});

describe('handleRelayTransfer: signature verification', () => {
  test('relays a validly-signed transfer from the pinned wallet', async () => {
    const { deps, calls } = makeDeps();
    const signed = await signAs(pinnedAccount);
    const res = await handleRelayTransfer(toBody(signed), 'U1', deps);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.txHash).toBe('0x' + '44'.repeat(32));
    expect(calls.simulate.length).toBe(1);
    expect(calls.write.length).toBe(1);
  });

  test('rejects a signature that does not recover to the pinned wallet', async () => {
    // A different device's own key, self-consistently signing its own address as `from` -- the server
    // always reconstructs the message with `from: <pinned wallet>`, so this signature can never validate
    // against it (see handleRelayTransfer's doc comment on why the signer check is the safety boundary).
    const { deps } = makeDeps({ getPinnedWallet: () => pinnedAccount.address });
    const signed = await signAs(otherAccount);
    const res = await handleRelayTransfer(toBody(signed), 'U1', deps);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('signer_mismatch');
  });
});

describe('handleRelayTransfer: amount and window checks', () => {
  test('rejects an amount over the on-chain balance', async () => {
    const { deps } = makeDeps({ balance: 500n });
    const signed = await signAs(pinnedAccount, { value: 1_000n });
    const res = await handleRelayTransfer(toBody(signed), 'U1', deps);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('insufficient_balance');
  });

  test('rejects an expired authorization', async () => {
    const { deps } = makeDeps();
    const signed = await signAs(pinnedAccount, { validBefore: BigInt(NOW - 10) });
    const res = await handleRelayTransfer(toBody(signed), 'U1', deps);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('expired');
  });

  test('rejects an authorization not yet valid', async () => {
    const { deps } = makeDeps();
    const signed = await signAs(pinnedAccount, { validAfter: BigInt(NOW + 100) });
    const res = await handleRelayTransfer(toBody(signed), 'U1', deps);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('not_yet_valid');
  });

  test('rejects a validBefore window that is unreasonably long', async () => {
    const { deps } = makeDeps();
    const signed = await signAs(pinnedAccount, { validBefore: BigInt(NOW + 60 * 60 * 24) });
    const res = await handleRelayTransfer(toBody(signed), 'U1', deps);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('window_too_long');
  });

  test('rejects a zero amount and a self-transfer', async () => {
    const { deps } = makeDeps();
    const zero = await signAs(pinnedAccount, { value: 0n });
    expect((await handleRelayTransfer(toBody(zero), 'U1', deps)).body.error).toBe('invalid_amount');

    const self = await signAs(pinnedAccount, { to: pinnedAccount.address });
    expect((await handleRelayTransfer(toBody(self), 'U1', deps)).body.error).toBe('self_transfer');
  });
});
