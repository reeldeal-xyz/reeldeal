// Picks the credential response that actually satisfies our request out of a verified IDKit result,
// and enforces the signal (wallet) binding server-side -- IDKit lets a client submit any JSON, so this
// is the check that actually ties a proof to the wallet it claims to be for.
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import type { IDKitResult } from '@worldcoin/idkit-core';
import { identifiersForLevel, levelForSchema, type WorldLevel } from './schema';

export interface MatchedCredential {
  identifier: string;
  nullifier: string;
  issuerSchemaId: number;
  level: 1 | 2;
  /** 0-65535. Only Selfie Check (level 1) credentials carry a score; level 2 credentials get 0. */
  sybilScoreBps: number;
}

function clampToUint16(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(65535, Math.max(0, Math.round(n)));
}

/**
 * Returns the first response in `result.responses` that:
 * - is a World ID 4.0 uniqueness proof (not a v3 legacy proof, not a session proof)
 * - has an identifier expected for `level` (selfie for level1; mnc/passport/proof_of_human for level2)
 * - carries a signal_hash equal to hashSignal(wallet)
 * - has an issuer_schema_id that maps to the requested level
 *
 * Returns null if the result doesn't satisfy the request -- callers should treat that as rejected.
 */
export function pickCredential(result: IDKitResult, level: WorldLevel, wallet: string): MatchedCredential | null {
  if (result.protocol_version !== '4.0' || 'session_id' in result) return null;

  const expectedIdentifiers = identifiersForLevel(level);
  const expectedNumericLevel = level === 'level1' ? 1 : 2;
  const expectedSignalHash = hashSignal(wallet).toLowerCase();

  for (const item of result.responses) {
    if (!expectedIdentifiers.includes(item.identifier)) continue;
    if (!item.signal_hash || item.signal_hash.toLowerCase() !== expectedSignalHash) continue;

    const schemaLevel = levelForSchema(item.issuer_schema_id);
    if (schemaLevel !== expectedNumericLevel) continue;

    const sybilScore = item.identifier === 'selfie' && 'sybil_score' in item ? item.sybil_score : 0;

    return {
      identifier: item.identifier,
      nullifier: item.nullifier,
      issuerSchemaId: item.issuer_schema_id,
      level: schemaLevel,
      sybilScoreBps: clampToUint16(sybilScore),
    };
  }

  return null;
}
