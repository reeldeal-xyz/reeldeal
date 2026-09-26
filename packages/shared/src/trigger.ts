// The Trigger is what the chain pays on. Field order and types MUST match ReliefPool.Trigger.
// Built app-side: the keeper reads index values from the pipeline feed (feed.ts), applies RULES, and sets
// index/threshold/tempC/firedAt from them and dataHash from the value's source.sha256. The pipeline never builds Triggers.
import type { Hex, Address } from 'viem';
import { z } from 'zod';

export interface Trigger {
  zoneId: Hex;       // idOf(zone)
  speciesId: Hex;    // idOf(species)
  perilId: Hex;      // idOf(peril)
  tier: number;      // uint8
  seasonLabel: string; // which season slot gets paid, e.g. "2026"
  windowStart: bigint; // unix seconds
  windowEnd: bigint;
  firedAt: bigint;     // unix seconds of the day the index crossed the threshold
  index: number;       // uint32
  threshold: number;   // uint32
  tempC: number;       // uint8, HEAT: day counts when SST >= tempC (whole °C); 0 for other perils. Copied from the rule.
  dataHash: Hex;       // source.sha256 of the pipeline index value, 0x-prefixed
  deadline: bigint;    // signature validity, unix seconds
}

export const TRIGGER_EIP712_TYPES = {
  Trigger: [
    { name: 'zoneId', type: 'bytes32' },
    { name: 'speciesId', type: 'bytes32' },
    { name: 'perilId', type: 'bytes32' },
    { name: 'tier', type: 'uint8' },
    { name: 'seasonLabel', type: 'string' },
    { name: 'windowStart', type: 'uint64' },
    { name: 'windowEnd', type: 'uint64' },
    { name: 'firedAt', type: 'uint64' },
    { name: 'index', type: 'uint32' },
    { name: 'threshold', type: 'uint32' },
    { name: 'tempC', type: 'uint8' },
    { name: 'dataHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const;

export const eip712Domain = (verifyingContract: Address) =>
  ({ name: 'ReliefPool', version: '2', chainId: 11155111, verifyingContract }) as const;

/** JSON form of a Trigger (bigints and hex as strings), for the keeper and /verify pages. */
export const TriggerJson = z.object({
  zoneId: z.string(), speciesId: z.string(), perilId: z.string(),
  tier: z.number().int(), seasonLabel: z.string(),
  windowStart: z.string(), windowEnd: z.string(), firedAt: z.string(),
  index: z.number().int(), threshold: z.number().int(), tempC: z.number().int().min(0).max(255),
  dataHash: z.string(), deadline: z.string(),
});
export type TriggerJson = z.infer<typeof TriggerJson>;

export interface SignedTrigger {
  trigger: Trigger;
  signatures: { signer: Address; signature: Hex }[];
}
