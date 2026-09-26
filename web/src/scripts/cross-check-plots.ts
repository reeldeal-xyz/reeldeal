// Cheap read-only cross-check for the db/postgres-plots work: does the plot list this migration
// seeds (docs/INTERFACE.md's p1213-001..015) match what's actually enrolled on the live ReliefPool?
// `plots(label)` is a public mapping getter -- 15 `eth_call`s against a public RPC, no gas, no tx.
// Informational only: an unenrolled label just means issue #16's `enroll()` calls for it haven't
// landed yet, not that the demo plot list is wrong.
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { ReliefPoolAbi } from '@repo/shared';

const rpcUrl = process.env.SEPOLIA_RPC_URL;
const poolAddress = process.env.RELIEF_POOL_ADDRESS;

if (!rpcUrl || !poolAddress) {
  console.log('[cross-check] SEPOLIA_RPC_URL or RELIEF_POOL_ADDRESS not set -- skipping (nothing to check).');
  process.exit(0);
}

const PLOT_LABELS = Array.from({ length: 15 }, (_, i) => `p1213-${String(i + 1).padStart(3, '0')}`);

const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

let enrolled = 0;
for (const label of PLOT_LABELS) {
  const [zoneId, speciesId, isEnrolled] = await client.readContract({
    address: poolAddress as `0x${string}`,
    abi: ReliefPoolAbi,
    functionName: 'plots',
    args: [label],
  });
  if (isEnrolled) enrolled += 1;
  console.log(`${label}: enrolled=${isEnrolled} zoneId=${zoneId} speciesId=${speciesId}`);
}

console.log(`\n[cross-check] ${enrolled}/${PLOT_LABELS.length} of the bootstrap's plot labels are enrolled on ReliefPool at ${poolAddress}.`);
console.log('[cross-check] Not enrolled yet just means issue #16 enroll() calls have not been made for that label -- the demo plot list itself is still docs/INTERFACE.md p1213-001..015.');
