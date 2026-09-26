// Schema <-> level mapping. Must match contracts/src/HumanRegistry.sol::_levelForSchema exactly:
// 11 -> level 1 (Selfie Check). 1, 9303, 9310 -> level 2 (Orb Proof of Human, passport, My Number Card).
import { env } from '@/lib/env';

export type WorldLevel = 'level1' | 'level2';

export const LEVEL1_SCHEMA = 11;
export const LEVEL2_SCHEMAS = [1, 9303, 9310] as const;

/** Credential identifiers IDKit returns for each level (see IDKit ResponseItemV4/SelfieCheckResponseItemV4). */
export const LEVEL1_IDENTIFIERS = ['selfie'] as const;
export const LEVEL2_IDENTIFIERS = ['mnc', 'passport', 'proof_of_human'] as const;

/** Maps a credential issuer_schema_id to the on-chain level, or null if unrecognized. */
export function levelForSchema(schemaId: number): 1 | 2 | null {
  if (schemaId === LEVEL1_SCHEMA) return 1;
  if ((LEVEL2_SCHEMAS as readonly number[]).includes(schemaId)) return 2;
  return null;
}

/** The World ID action string configured for a given level. */
export function actionForLevel(level: WorldLevel): string {
  return level === 'level1' ? env.worldAction() : env.worldActionL2();
}

/** The World ID credential identifiers IDKit may return for a given level's request. */
export function identifiersForLevel(level: WorldLevel): readonly string[] {
  return level === 'level1' ? LEVEL1_IDENTIFIERS : LEVEL2_IDENTIFIERS;
}
