import { beforeEach, describe, expect, test } from 'bun:test';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { CHAIN_ID } from '@repo/shared';
import { _resetSiweNoncesForTests, buildSiweMessage, issueNonce, walletSessionUserId } from './siwe';
import { handleWalletAuthVerify } from './wallet-auth';

const account = privateKeyToAccount(('0x' + '77'.repeat(32)) as Hex);
const DOMAIN = 'app.reeldeal.example';
const NOW = 1_800_000_000_000;

beforeEach(() => {
  _resetSiweNoncesForTests();
});

async function goodBody(now = NOW) {
  const message = buildSiweMessage({
    domain: DOMAIN,
    address: account.address,
    uri: `https://${DOMAIN}/app`,
    version: '1',
    chainId: CHAIN_ID,
    nonce: issueNonce(() => now),
    issuedAt: new Date(now).toISOString(),
  });
  const signature = await account.signMessage({ message });
  return { message, signature };
}

describe('handleWalletAuthVerify', () => {
  test('mints a wallet-kind session on a good signature', async () => {
    const body = await goodBody();
    const res = await handleWalletAuthVerify(body, DOMAIN, () => NOW);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, wallet: account.address });
    expect(res.session).toEqual({ userId: walletSessionUserId(account.address), kind: 'wallet', iat: Math.floor(NOW / 1000) });
  });

  test('rejects a missing message/signature', async () => {
    expect((await handleWalletAuthVerify({}, DOMAIN)).status).toBe(400);
    expect((await handleWalletAuthVerify({ message: 'x' }, DOMAIN)).status).toBe(400);
    expect((await handleWalletAuthVerify(null, DOMAIN)).status).toBe(400);
  });

  test('rejects a non-hex signature', async () => {
    const res = await handleWalletAuthVerify({ message: 'anything', signature: 'not-hex' }, DOMAIN);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  test('propagates the domain mismatch from the wrong request host', async () => {
    const body = await goodBody();
    const res = await handleWalletAuthVerify(body, 'attacker.example', () => NOW);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('wrong_domain');
    expect(res.session).toBeUndefined();
  });
});
