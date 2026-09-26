import { describe, expect, test } from 'bun:test';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import type { IDKitResult } from '@worldcoin/idkit-core';
import { pickCredential } from './credential';

const WALLET = '0x00000000000000000000000000000000000000aa';
const OTHER_WALLET = '0x00000000000000000000000000000000000000bb';

function v4Result(responses: unknown[], overrides: Partial<{ action: string; environment: string }> = {}): IDKitResult {
  return {
    protocol_version: '4.0',
    nonce: 'test-nonce',
    action: overrides.action ?? 'bind-payout-wallet',
    environment: overrides.environment ?? 'production',
    responses,
  } as unknown as IDKitResult;
}

describe('pickCredential', () => {
  test('matches a level1 selfie response with correct signal_hash and schema 11', () => {
    const result = v4Result([
      {
        identifier: 'selfie',
        signal_hash: hashSignal(WALLET),
        proof: ['0x1', '0x2', '0x3', '0x4', '0x5'],
        nullifier: '0xabc123',
        issuer_schema_id: 11,
        expires_at_min: 0,
        sybil_score: 42,
      },
    ]);

    const credential = pickCredential(result, 'level1', WALLET);
    expect(credential).not.toBeNull();
    expect(credential?.level).toBe(1);
    expect(credential?.identifier).toBe('selfie');
    expect(credential?.nullifier).toBe('0xabc123');
    expect(credential?.sybilScoreBps).toBe(42);
  });

  test('matches a level2 Orb (proof_of_human) response and defaults sybilScoreBps to 0 (no score field)', () => {
    const result = v4Result([
      {
        identifier: 'proof_of_human',
        signal_hash: hashSignal(WALLET),
        proof: ['0x1', '0x2', '0x3', '0x4', '0x5'],
        nullifier: '0xdef456',
        issuer_schema_id: 1,
        expires_at_min: 0,
      },
    ]);

    const credential = pickCredential(result, 'level2', WALLET);
    expect(credential).not.toBeNull();
    expect(credential?.level).toBe(2);
    expect(credential?.sybilScoreBps).toBe(0);
  });

  test('rejects when signal_hash does not match the wallet', () => {
    const result = v4Result([
      {
        identifier: 'selfie',
        signal_hash: hashSignal(OTHER_WALLET),
        proof: [],
        nullifier: '0xabc',
        issuer_schema_id: 11,
        expires_at_min: 0,
        sybil_score: 1,
      },
    ]);
    expect(pickCredential(result, 'level1', WALLET)).toBeNull();
  });

  test('rejects when signal_hash is missing entirely', () => {
    const result = v4Result([
      { identifier: 'selfie', proof: [], nullifier: '0xabc', issuer_schema_id: 11, expires_at_min: 0, sybil_score: 1 },
    ]);
    expect(pickCredential(result, 'level1', WALLET)).toBeNull();
  });

  test('rejects an identifier not valid for the requested level', () => {
    const result = v4Result([
      {
        identifier: 'passport',
        signal_hash: hashSignal(WALLET),
        proof: [],
        nullifier: '0xabc',
        issuer_schema_id: 9303,
        expires_at_min: 0,
      },
    ]);
    expect(pickCredential(result, 'level1', WALLET)).toBeNull();
  });

  test('rejects My Number Card and passport responses for level2 (not integrated)', () => {
    for (const [identifier, issuer_schema_id] of [['mnc', 9310], ['passport', 9303]] as const) {
      const result = v4Result([
        { identifier, signal_hash: hashSignal(WALLET), proof: [], nullifier: '0xabc', issuer_schema_id, expires_at_min: 0 },
      ]);
      expect(pickCredential(result, 'level2', WALLET)).toBeNull();
    }
  });

  test('rejects a v3 legacy result', () => {
    const result = { protocol_version: '3.0', nonce: 'n', responses: [] } as unknown as IDKitResult;
    expect(pickCredential(result, 'level1', WALLET)).toBeNull();
  });

  test('rejects a session proof result', () => {
    const result = {
      protocol_version: '4.0',
      nonce: 'n',
      session_id: 'session_abc',
      environment: 'production',
      responses: [],
    } as unknown as IDKitResult;
    expect(pickCredential(result, 'level1', WALLET)).toBeNull();
  });

  test('clamps an out-of-range sybil_score into uint16 bounds', () => {
    const result = v4Result([
      {
        identifier: 'selfie',
        signal_hash: hashSignal(WALLET),
        proof: [],
        nullifier: '0xabc',
        issuer_schema_id: 11,
        expires_at_min: 0,
        sybil_score: 999999,
      },
    ]);
    const credential = pickCredential(result, 'level1', WALLET);
    expect(credential?.sybilScoreBps).toBe(65535);
  });
});
