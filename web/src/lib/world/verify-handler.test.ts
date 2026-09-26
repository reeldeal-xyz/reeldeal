import { describe, expect, test } from 'bun:test';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import type { IDKitResult } from '@worldcoin/idkit-core';

process.env.WORLD_RP_ID = 'rp_test0000000000';
process.env.WORLD_ACTION = 'bind-payout-wallet';
process.env.WORLD_ACTION_L2 = 'upgrade-level-2';
process.env.WORLD_ENVIRONMENT = 'production';

import { handleWorldVerify } from './verify-handler';
import { WorldVerifyError } from './verify-client';
import { WorldBindError } from './binder';

const WALLET = '0x00000000000000000000000000000000000000aa';

function selfieResult(overrides: Partial<{ action: string; environment: string; signalHash: string }> = {}): IDKitResult {
  return {
    protocol_version: '4.0',
    nonce: 'n',
    action: overrides.action ?? 'bind-payout-wallet',
    environment: overrides.environment ?? 'production',
    responses: [
      {
        identifier: 'selfie',
        signal_hash: overrides.signalHash ?? hashSignal(WALLET),
        proof: ['0x1', '0x2', '0x3', '0x4', '0x5'],
        nullifier: '0xabc123',
        issuer_schema_id: 11,
        expires_at_min: 0,
        sybil_score: 5,
      },
    ],
  } as unknown as IDKitResult;
}

const okCallWorldVerify = async () => undefined;
const okBind = async () => ({ txHash: ('0x' + '22'.repeat(32)) as `0x${string}`, call: 'bind' as const });

describe('handleWorldVerify: request validation', () => {
  test('rejects a malformed body', async () => {
    const res = await handleWorldVerify({ level: 'level1' }, { callWorldVerify: okCallWorldVerify, bindOrUpgradeOnChain: okBind });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  test('rejects a non-address wallet', async () => {
    const res = await handleWorldVerify(
      { level: 'level1', wallet: 'not-an-address', result: {} },
      { callWorldVerify: okCallWorldVerify, bindOrUpgradeOnChain: okBind },
    );
    expect(res.status).toBe(400);
  });
});

describe('handleWorldVerify: client-side failures (no proof produced)', () => {
  test('user_rejected logs/returns as a cancellation, not an error', async () => {
    const res = await handleWorldVerify(
      { level: 'level1', wallet: WALLET, clientError: 'user_rejected' },
      { callWorldVerify: okCallWorldVerify, bindOrUpgradeOnChain: okBind },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('user_rejected');
    expect(typeof res.body.message).toBe('string');
  });

  test('nullifier_replayed is reported', async () => {
    const res = await handleWorldVerify(
      { level: 'level2', wallet: WALLET, clientError: 'nullifier_replayed' },
      { callWorldVerify: okCallWorldVerify, bindOrUpgradeOnChain: okBind },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('nullifier_replayed');
  });
});

describe('handleWorldVerify: proof path', () => {
  test('rejects when the World verify endpoint rejects the proof', async () => {
    const res = await handleWorldVerify(
      { level: 'level1', wallet: WALLET, result: selfieResult() },
      {
        callWorldVerify: async () => {
          throw new WorldVerifyError('world_verify_rejected', 400, { error: 'invalid_proof' });
        },
        bindOrUpgradeOnChain: okBind,
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('proof_rejected');
  });

  test('rejects on action/environment scope mismatch', async () => {
    const res = await handleWorldVerify(
      { level: 'level1', wallet: WALLET, result: selfieResult({ action: 'some-other-action' }) },
      { callWorldVerify: okCallWorldVerify, bindOrUpgradeOnChain: okBind },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('scope_mismatch');
  });

  test('rejects when no response matches the wallet signal', async () => {
    const res = await handleWorldVerify(
      { level: 'level1', wallet: WALLET, result: selfieResult({ signalHash: hashSignal('0x00000000000000000000000000000000000000bb') }) },
      { callWorldVerify: okCallWorldVerify, bindOrUpgradeOnChain: okBind },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_matching_credential');
  });

  test('binds on-chain and returns the tx hash on a valid level1 proof', async () => {
    let bindArgs: unknown;
    const res = await handleWorldVerify(
      { level: 'level1', wallet: WALLET, result: selfieResult() },
      {
        callWorldVerify: okCallWorldVerify,
        bindOrUpgradeOnChain: async (params) => {
          bindArgs = params;
          return { txHash: ('0x' + '33'.repeat(32)) as `0x${string}`, call: 'bind' as const };
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.call).toBe('bind');
    expect(res.body.level).toBe(1);
    expect((bindArgs as { sybilScoreBps: number }).sybilScoreBps).toBe(5);
  });

  test('maps a duplicate on-chain outcome to 409', async () => {
    const res = await handleWorldVerify(
      { level: 'level1', wallet: WALLET, result: selfieResult() },
      {
        callWorldVerify: okCallWorldVerify,
        bindOrUpgradeOnChain: async () => {
          throw new WorldBindError('nullifier_already_bound', 'This World ID is already linked to a different wallet.');
        },
      },
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('nullifier_already_bound');
  });

  test('maps an unexpected on-chain failure to 502', async () => {
    const res = await handleWorldVerify(
      { level: 'level1', wallet: WALLET, result: selfieResult() },
      {
        callWorldVerify: okCallWorldVerify,
        bindOrUpgradeOnChain: async () => {
          throw new Error('rpc down');
        },
      },
    );
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('bind_failed');
  });
});
