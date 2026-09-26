// Canonical identifiers shared by contracts, pipeline and web.
// On-chain these are keccak256(utf8(label)); off-chain we use the labels.
import { keccak256, toBytes, encodeAbiParameters, type Hex } from 'viem';
import type { Trigger } from './trigger';

// Zones are the on-chain payout unit: a sea area. Coverage is national; the full list will be generated from
// pipeline/data/ref/sea_areas (pipeline/README.md Q7). These are the Kesennuma / Karakuwa demo zones.
export const ZONES = ['karakuwa-east', 'kesennuma-bay'] as const;
export type Zone = (typeof ZONES)[number];

export const SPECIES = [
  'nori', 'wakame', 'kombu',                                  // seaweed
  'scallop', 'oyster', 'hoya',                                // shellfish
  'yellowtail', 'sea-bream', 'salmon', 'bluefin-tuna',        // finfish
] as const;
export type Species = (typeof SPECIES)[number];

export const GEARS = ['longline', 'raft', 'cage'] as const;
export type Gear = (typeof GEARS)[number];

// Hazard modules of the pipeline. Each publishes index values only; thresholds live in rules.ts and on chain.
export const MODULES = ['heat', 'hab', 'storm'] as const;
export type Module = (typeof MODULES)[number];

// Index names published by each module (pipeline/README.md §6-§8). SST is the primary heat index; HEAT{t} is an
// on-request convenience (days with SST >= t °C), not a fixed set. `{h}` is written into the name: HS_HOURS3 = hours with Hs >= 3 m.
export const INDEX_PATTERNS = {
  heat: ['SST', 'SST_ANOM', 'T_D{z}', 'MHW_DAYS', 'MHW_INTENSITY', 'HEAT{t}'],
  hab: ['BANWEEKS', 'BAN_ACTIVE', 'REDTIDE_DAYS', 'CHL', 'CHL_Z', 'MLD'],
  storm: ['MAX_SURGE', 'MAX_WATER_LEVEL', 'MAX_HS', 'HS_HOURS{h}', 'MAX_WAVE_POWER', 'MAX_CURRENT', 'MAX_WIND', 'TC_DIST'],
} as const satisfies Record<Module, readonly string[]>;

// Perils: what the chain pays on. HEAT = days with SST at or above the rule's tempC (rules.ts), counted app-side from
// the pipeline's SST series; the temperature belongs to the rule, so there is one HEAT peril, not one per temperature.
export const PERILS = ['HEAT', 'BANWEEKS'] as const;
export type Peril = (typeof PERILS)[number];

export const PERIL_MODULE: Record<Peril, Module> = { HEAT: 'heat', BANWEEKS: 'hab' };

export const idOf = (label: string): Hex => keccak256(toBytes(label));

/** eventId = keccak256(abi.encode(zoneId, speciesId, perilId, tier, seasonLabel)); mirrors ReliefPool. */
export const eventIdOf = (zone: Zone, species: Species, peril: Peril, tier: number, seasonLabel: string): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint8' }, { type: 'string' }],
      [idOf(zone), idOf(species), idOf(peril), tier, seasonLabel],
    ),
  );

/** Same formula as `eventIdOf`, but taken directly from a (fetched or built) Trigger's own already-hashed
 *  fields instead of zone/species/peril labels -- used by the keeper (issue #17) to cross-check that a
 *  Trigger it's about to `attest` really matches the eventId it expected before spending gas on it. */
export const triggerEventId = (t: Pick<Trigger, 'zoneId' | 'speciesId' | 'perilId' | 'tier' | 'seasonLabel'>): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint8' }, { type: 'string' }],
      [t.zoneId, t.speciesId, t.perilId, t.tier, t.seasonLabel],
    ),
  );
