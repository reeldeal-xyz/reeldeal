// The Trigger is the only thing the pipeline hands to the chain. Field order and types MUST match ReliefPool.Trigger.
import type { Hex, Address } from 'viem';

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
  dataHash: Hex;       // sha256 of the pinned input CSV, 0x-prefixed
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
    { name: 'dataHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const;

export const eip712Domain = (verifyingContract: Address) =>
  ({ name: 'UmiRelief', version: '1', chainId: 11155111, verifyingContract }) as const;

export interface SignedTrigger {
  trigger: Trigger;
  signatures: { signer: Address; signature: Hex }[];
}
