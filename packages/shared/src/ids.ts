// Canonical identifiers shared by contracts, pipeline and web.
// On-chain these are keccak256(utf8(label)); off-chain we use the labels.
import { keccak256, toBytes, encodeAbiParameters, type Hex } from 'viem';
import type { Trigger } from './trigger';

export const ZONES = ['karakuwa-east', 'kesennuma-bay'] as const;
export type Zone = (typeof ZONES)[number];

export const SPECIES = ['scallop', 'hoya', 'oyster'] as const;
export type Species = (typeof SPECIES)[number];

// Perils: day counts at or above a sea-surface temperature, or consecutive weeks under a toxin ban.
export const PERILS = ['HEAT24', 'HEAT25', 'HEAT26', 'BANWEEKS'] as const;
export type Peril = (typeof PERILS)[number];

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
