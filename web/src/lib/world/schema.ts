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

// Bilingual label for level 2: the action intentionally accepts any of My Number Card, passport, or World ID
// (Orb) -- schemaId 1 (Proof of Human/Orb), 9303 (passport), 9310 (My Number Card), see LEVEL2_SCHEMAS above.
// Use this label everywhere level 2 is surfaced (badges, button copy, confirmation text) so the three
// accepted credentials are never implied to be just one of them.
export const LEVEL2_LABEL_JA = 'レベル2:マイナンバーカード・パスポート・World ID(Orb)';
export const LEVEL2_LABEL_EN = 'Level 2: My Number Card, passport or World ID (Orb)';
export const LEVEL2_LABEL_BILINGUAL = `${LEVEL2_LABEL_JA} / ${LEVEL2_LABEL_EN}`;

/** Bilingual label for which specific credential verified a wallet, keyed by issuer_schema_id. Null for an
 *  unrecognized/unset (0) schemaId -- see fetchWorldSchema in lib/liff/status.ts. */
export function credentialLabelForSchema(schemaId: number): { ja: string; en: string } | null {
  if (schemaId === LEVEL1_SCHEMA) return { ja: 'セルフィーチェック', en: 'Selfie Check' };
  if (schemaId === 1) return { ja: 'World ID (Orb)', en: 'World ID (Orb)' };
  if (schemaId === 9303) return { ja: 'パスポート', en: 'Passport' };
  if (schemaId === 9310) return { ja: 'マイナンバーカード', en: 'My Number Card' };
  return null;
}
