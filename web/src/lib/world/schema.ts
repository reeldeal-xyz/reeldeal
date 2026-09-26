// Schema <-> level mapping. 11 -> level 1 (Selfie Check). 1 -> level 2 (World ID Orb, Proof of Human).
// The deployed HumanRegistry also recognises 9303/9310 (passport / My Number Card) as level 2, but the app
// never requests or accepts them: we haven't integrated or tested those credentials, so level 2 is Orb only.
import { env } from '@/lib/env';

export type WorldLevel = 'level1' | 'level2';

export const LEVEL1_SCHEMA = 11;
export const LEVEL2_SCHEMAS = [1] as const;

/** Credential identifiers IDKit returns for each level (see IDKit ResponseItemV4/SelfieCheckResponseItemV4). */
export const LEVEL1_IDENTIFIERS = ['selfie'] as const;
export const LEVEL2_IDENTIFIERS = ['proof_of_human'] as const;

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

// Bilingual label for level 2 (World ID Orb, schemaId 1). Use it everywhere level 2 is surfaced (badges,
// button copy, confirmation text).
export const LEVEL2_LABEL_JA = 'レベル2:World ID(Orb)';
export const LEVEL2_LABEL_EN = 'Level 2: World ID (Orb)';
export const LEVEL2_LABEL_BILINGUAL = `${LEVEL2_LABEL_JA} / ${LEVEL2_LABEL_EN}`;

/** Bilingual label for which specific credential verified a wallet, keyed by issuer_schema_id. Null for an
 *  unrecognized/unset (0) schemaId -- see fetchWorldSchema in lib/liff/status.ts. */
export function credentialLabelForSchema(schemaId: number): { ja: string; en: string } | null {
  if (schemaId === LEVEL1_SCHEMA) return { ja: 'セルフィーチェック', en: 'Selfie Check' };
  if (schemaId === 1) return { ja: 'World ID (Orb)', en: 'World ID (Orb)' };
  return null;
}
