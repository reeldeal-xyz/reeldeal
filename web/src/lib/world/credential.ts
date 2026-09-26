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
 * - has an identifier expected for `level` (selfie for level1; proof_of_human (Orb) for level2)
 * - carries a signal_hash equal to hashSignal(wallet)
 * - has an issuer_schema_id that maps to the requested level
 *
 * Returns null if the result doesn't satisfy the request -- callers should treat that as rejected.
 */
export function pickCredential(result: IDKitResult, level: WorldLevel, wallet: string): MatchedCredential | null {
  if (result.protocol_version !== '4.0' || 'session_id' in result) return null;

  // Simulator (staging/sandbox) proofs: there is no Selfie Check credential, so a level-1 bind accepts the
  // simulator's Human (Orb) credential and binds it at its real level (2). Production is unchanged.
  const simulator = (result as { environment?: string }).environment !== undefined && (result as { environment?: string }).environment !== 'production';
  const expectedIdentifiers = simulator && level === 'level1' ? [...identifiersForLevel(level), 'proof_of_human'] : identifiersForLevel(level);
  const expectedNumericLevel = level === 'level1' ? 1 : 2;
  const expectedSignalHash = hashSignal(wallet).toLowerCase();

  for (const item of result.responses) {
    if (!expectedIdentifiers.includes(item.identifier)) continue;
    if (!item.signal_hash || item.signal_hash.toLowerCase() !== expectedSignalHash) continue;

    const schemaLevel = levelForSchema(item.issuer_schema_id);
    if (schemaLevel === null) continue;
    if (schemaLevel !== expectedNumericLevel && !(simulator && schemaLevel > expectedNumericLevel)) continue;

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
