// Cross-checks ReliefPool's Solidity EIP-712 digest against viem's `hashTypedData`, using the exact
// TRIGGER_EIP712_TYPES + eip712Domain from ../src/trigger.ts. Run with `bun run packages/shared/scripts/print-trigger-digest.ts`.
//
// The verifyingContract address is the CREATE address for nonce 0 of the well-known "private key 1" account
// (0x0000...0001), so a Foundry test can recompute the same address with `vm.addr(1)` + `computeCreateAddress`
// without either side hardcoding a magic address. Only the resulting digest needs to be copied into the
// Foundry test (contracts/test/ReliefPoolEip712Vector.t.sol) â€” regenerate it there if this fixture ever changes.
import { getContractAddress, hashTypedData, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { eip712Domain, TRIGGER_EIP712_TYPES, type Trigger } from '../src/trigger';

const DEPLOYER_PRIVATE_KEY = `0x${'0'.repeat(63)}1` as const; // == vm.addr(1) in Foundry
const deployer = privateKeyToAccount(DEPLOYER_PRIVATE_KEY).address;
const verifyingContract = getContractAddress({ from: deployer, nonce: 0n });

const idOf = (label: string) => keccak256(toBytes(label));

const trigger: Trigger = {
  zoneId: idOf('karakuwa-east'),
  speciesId: idOf('scallop'),
  perilId: idOf('HEAT'),
  tier: 1,
  seasonLabel: '2026',
  windowStart: 1690848000n, // 2023-08-01T00:00:00Z
  windowEnd: 1693526400n, // 2023-09-01T00:00:00Z
  firedAt: 1691798400n, // 2023-08-12T00:00:00Z
  index: 20,
  threshold: 14,
  tempC: 25, // RULES: scallop tier 1
  dataHash: keccak256(toBytes('eip712-vector-fixture')),
  deadline: 1735689600n, // 2025-01-01T00:00:00Z
};

const digest = hashTypedData({
  domain: eip712Domain(verifyingContract),
  types: TRIGGER_EIP712_TYPES,
  primaryType: 'Trigger',
  message: trigger,
});

console.log(
  JSON.stringify(
    {
      deployer,
      verifyingContract,
      digest,
      trigger: {
        ...trigger,
        windowStart: trigger.windowStart.toString(),
        windowEnd: trigger.windowEnd.toString(),
        firedAt: trigger.firedAt.toString(),
        deadline: trigger.deadline.toString(),
      },
    },
    null,
    2,
  ),
);
