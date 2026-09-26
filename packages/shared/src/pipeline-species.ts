import { z } from 'zod';
import { MODULES, PERILS, SPECIES } from './ids';

// Payloads of the pipeline's /species routes (pipeline/README.md §5a). Reference values only: rules are for display
// (the app applies RULES itself) and responses are measured study points, never fitted curves.
const text = z.string().trim().min(1).max(500);
const version = z.string().regex(/^[a-z0-9-]+-\d+\.\d+\.\d+$/);
const monthDay = z.string().regex(/^\d{2}-\d{2}$/);
const kind = z.literal('reference');

export const pipelineSpeciesFactor = z.enum(['temperature', 'salinity', 'dissolved_oxygen', 'density']);
export const pipelineResponseStatus = z.enum(['measured', 'no_supported_data']);

export const pipelineSpeciesRule = z.object({
  species: z.enum(SPECIES),
  tier: z.union([z.literal(1), z.literal(2)]),
  peril: z.enum(PERILS),
  tempC: z.number().int().min(0).max(255).nullable(),
  threshold: z.number().int().positive(),
  window: z.object({ start: monthDay, end: monthDay }).strict().nullable(),
}).strict().refine((r) => r.peril === 'HEAT' ? r.tempC !== null && r.window !== null : r.tempC === null && r.window === null,
  'HEAT rules need tempC and window, other perils neither');

export const pipelineEvidence = z.object({
  id: text,
  url: z.string().url(),
  factors: z.array(pipelineSpeciesFactor).min(1),
  access: z.enum(['abstract', 'full_text']).nullable(),
  lifeStage: text.nullable(),
  size: text.nullable(),
  exposure: text.nullable(),
  endpoint: text.nullable(),
  testedRange: z.object({ min: z.number().finite(), max: z.number().finite(), unit: text }).strict().nullable(),
  xUnit: text.nullable(),
  yUnit: text.nullable(),
  points: z.array(z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    yErr: z.number().finite().nonnegative().nullable(),
    n: z.number().int().positive().nullable(),
  }).strict()).max(1000),
  note: text.nullable(),
  status: pipelineResponseStatus,
}).strict().refine((e) => (e.status === 'measured') === (e.points.length > 0), 'Status disagrees with points');

const profile = {
  id: z.enum(SPECIES),
  name: text,
  nameJa: text,
  group: z.enum(['seaweed', 'shellfish', 'finfish']),
  taxon: text,
  hazards: z.array(z.enum(MODULES)),
};

/** GET /species */
export const pipelineSpeciesList = z.object({
  kind,
  profile_version: version,
  rules_version: version,
  species: z.array(z.object({ ...profile, evidenceCount: z.number().int().nonnegative(), ruleCount: z.number().int().nonnegative() }).strict()),
}).strict();

/** GET /species/{id} */
export const pipelineSpeciesDetail = z.object({
  ...profile,
  kind,
  profile_version: version,
  rules_version: version,
  evidence: z.array(pipelineEvidence),
  rules: z.array(pipelineSpeciesRule),
}).strict();

/** GET /species/{id}/rules */
export const pipelineSpeciesRules = z.object({
  kind,
  species: z.enum(SPECIES),
  rules_version: version,
  rules: z.array(pipelineSpeciesRule),
}).strict();

/** GET /species/{id}/responses */
export const pipelineSpeciesResponses = z.object({
  kind,
  species: z.enum(SPECIES),
  profile_version: version,
  factor: pipelineSpeciesFactor.nullable(),
  status: pipelineResponseStatus,
  studies: z.array(pipelineEvidence),
}).strict();

export type PipelineSpeciesRule = z.infer<typeof pipelineSpeciesRule>;
export type PipelineEvidence = z.infer<typeof pipelineEvidence>;
export type PipelineSpeciesDetail = z.infer<typeof pipelineSpeciesDetail>;
export type PipelineSpeciesRules = z.infer<typeof pipelineSpeciesRules>;
