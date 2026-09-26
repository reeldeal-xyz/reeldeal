// Typed adapter for every ENSv2 call the holder/co-op screens need (issues #19/#20).
//
// Two different confidence levels live here:
//   - setText/setAddress on the resolver, and the branch registry's read surface (getSubregistry/getResolver/
//     findOwner), are CONFIRMED: #7 transcribed them byte-for-byte from ensdomains/contracts-v2 into
//     contracts/script/ens/EnsV2.sol (IPermissionedResolverWrite, IEnsV2Registry) and contracts/src/interfaces/
//     IEnsV2.sol. This file mirrors those two interfaces exactly.
//   - register/unregister on a *per-plot* season-slot registry are a BEST GUESS: #10 (per-plot registries +
//     expiring season slots) hasn't landed yet. `register`'s shape borrows IUserRegistryWrite.register (the
//     same ABI the branch UserRegistry already uses, per #7's comment that ETHRegistry/RootRegistry/UserRegistry
//     all share it) since #10's per-plot registries are documented as UserRegistry proxies too; `unregister`
//     is inferred from RegistryRoles.ROLE_UNREGISTER existing but its exact signature isn't confirmed anywhere
//     yet. TODO(#10): replace both the moment the real per-plot registry ships — nothing outside this file
//     imports an ENSv2 ABI directly, so that's a one-file swap.
import type { Address, Hex } from 'viem';
import { toHex } from 'viem';
import { packetToBytes } from 'viem/ens';
import type { Config } from 'wagmi';
import { readContract, writeContract, waitForTransactionReceipt } from 'wagmi/actions';
import { SEASON_LABEL } from './plots';

export interface EnsAddresses {
  /** Branch UserRegistry for karakuwa.<parent>.eth (#7). Plot subnames (#10) register as owner here, so this
   *  also answers "who holds this plot". */
  parentRegistry?: Address;
  /** PermissionedResolver proxy plots/slots resolve text/address records against (#7). */
  plotResolver?: Address;
  /** Per-plot UserRegistry the holder issues/revokes this season's slot on (#10). #10 deploys one per plot via
   *  VerifiableFactory; until then this single address stands in for all 15 plots so the UI has something to
   *  call end to end. */
  slotRegistry?: Address;
}

export const ensCapabilities = (a: EnsAddresses) => ({
  canIssueSlots: Boolean(a.slotRegistry),
  canReadHolders: Boolean(a.parentRegistry),
  canEditRecords: Boolean(a.plotResolver),
});

// ---------------------------------------------------------------------------------------------------------
// Branch registry read surface — confirmed (contracts/src/interfaces/IEnsV2.sol, IEnsV2Registry).
// ---------------------------------------------------------------------------------------------------------

export const EnsRegistryReadAbi = [
  {
    type: 'function',
    name: 'getSubregistry',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getResolver',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'findOwner', // upstream TODO in IEnsV2.sol: "confirm name/return on fork"
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

// ---------------------------------------------------------------------------------------------------------
// Per-plot season-slot registry — TODO(#10): confirm once the real per-plot UserRegistry ships.
// ---------------------------------------------------------------------------------------------------------

/** `register`'s shape is confirmed (IUserRegistryWrite in contracts/script/ens/EnsV2.sol, transcribed from
 *  ensdomains/contracts-v2's IStandardRegistry) and #10's per-plot registries are documented as sharing it.
 *  `unregister` is not yet defined anywhere — inferred only from RegistryRoles.ROLE_UNREGISTER existing. */
export const PlotRegistryAbi = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'registry', type: 'address' }, // subregistry for this name; 0x0 — a season slot is a leaf
      { name: 'resolver', type: 'address' },
      { name: 'roleBitmap', type: 'uint256' }, // 0 => non-transferable (issue #10)
      { name: 'expiry', type: 'uint64' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
  {
    // TODO(#10): unconfirmed name/signature — best guess, mirrors `register`'s label-based calling convention.
    type: 'function',
    name: 'unregister',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [],
  },
  {
    type: 'error',
    name: 'EACUnauthorizedAccountRoles',
    inputs: [
      { name: 'resource', type: 'uint256' },
      { name: 'roleBitmap', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
  },
] as const;

// ---------------------------------------------------------------------------------------------------------
// PermissionedResolver write surface — confirmed (IPermissionedResolverWrite in EnsV2.sol, transcribed from
// ensdomains/contracts-v2). Both take the DNS-wire-encoded full name, not a bare label or bytes32 node.
// ---------------------------------------------------------------------------------------------------------

export const PlotResolverAbi = [
  {
    type: 'function',
    name: 'setText',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'bytes' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setAddress',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'bytes' },
      { name: 'coinType', type: 'uint256' },
      { name: 'addressBytes', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'error',
    name: 'EACUnauthorizedAccountRoles',
    inputs: [
      { name: 'resource', type: 'uint256' },
      { name: 'roleBitmap', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
  },
] as const;

/** ENSIP-11 coinType for a plain EVM/ETH address record. */
const ETH_COIN_TYPE = 60n;

// ---------------------------------------------------------------------------------------------------------
// Name derivation
// ---------------------------------------------------------------------------------------------------------

/** TODO(#7): <parent>.eth isn't recorded in packages/shared/src/addresses.ts yet (DEPLOYED is still zero —
 *  #16 fills it in), so this assumes a placeholder TLD purely so setText/setAddress have a name to DNS-encode.
 *  Re-derive from the real dotted name (`p1213-NNN.karakuwa.<parent>.eth`) the moment it's committed. */
export const getPlotDnsName = (plotLabel: string): Hex => toHex(packetToBytes(`${plotLabel}.karakuwa.eth`));

// ---------------------------------------------------------------------------------------------------------
// Adapter functions
// ---------------------------------------------------------------------------------------------------------

export interface EnsWriteResult {
  ok: boolean;
  hash?: Hex;
  /** Populated when `ok` is false — includes the on-chain revert reason for a denied write (issue #20). */
  error?: string;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/** Issues this season's slot to a farmer (issue #19: `register("2026", farmer, ...)`). */
export async function issueSeasonSlot(
  config: Config,
  addresses: EnsAddresses,
  params: { plotLabel: string; farmer: Address; seasonLabel?: string; expires: bigint },
): Promise<EnsWriteResult> {
  if (!addresses.slotRegistry) return { ok: false, error: 'ENS slot registry not deployed yet (see #10)' };
  try {
    const hash = await writeContract(config, {
      address: addresses.slotRegistry,
      abi: PlotRegistryAbi,
      functionName: 'register',
      args: [
        params.seasonLabel ?? SEASON_LABEL,
        params.farmer,
        ZERO_ADDRESS, // no subregistry — a season slot is a leaf name
        addresses.plotResolver ?? ZERO_ADDRESS,
        0n, // roleBitmap 0 => non-transferable
        params.expires,
      ],
    });
    await waitForTransactionReceipt(config, { hash });
    return { ok: true, hash };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Revokes this season's slot (issue #19: revoke via `unregister`). */
export async function revokeSeasonSlot(
  config: Config,
  addresses: EnsAddresses,
  seasonLabel: string = SEASON_LABEL,
): Promise<EnsWriteResult> {
  if (!addresses.slotRegistry) return { ok: false, error: 'ENS slot registry not deployed yet (see #10)' };
  try {
    const hash = await writeContract(config, {
      address: addresses.slotRegistry,
      abi: PlotRegistryAbi,
      functionName: 'unregister',
      args: [seasonLabel],
    });
    await waitForTransactionReceipt(config, { hash });
    return { ok: true, hash };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Reads a plot's licence holder off the branch registry (`findOwner`). Undefined if not deployed/unresolved. */
export async function getPlotHolder(config: Config, addresses: EnsAddresses, plotLabel: string): Promise<Address | undefined> {
  if (!addresses.parentRegistry) return undefined;
  try {
    const owner = await readContract(config, {
      address: addresses.parentRegistry,
      abi: EnsRegistryReadAbi,
      functionName: 'findOwner',
      args: [plotLabel],
    });
    return owner === ZERO_ADDRESS ? undefined : owner;
  } catch {
    return undefined;
  }
}

/** Science key writes `zone` (issue #20: "edits zone successfully"). Expected to succeed — the science key
 *  holds `ROLE_SET_TEXT` scoped to the `zone` resource via #7's `grantSetterRoles`. */
export async function setPlotZone(config: Config, addresses: EnsAddresses, plotLabel: string, zone: string): Promise<EnsWriteResult> {
  if (!addresses.plotResolver) return { ok: false, error: 'ENS plot resolver not deployed yet (see #7)' };
  try {
    const hash = await writeContract(config, {
      address: addresses.plotResolver,
      abi: PlotResolverAbi,
      functionName: 'setText',
      args: [getPlotDnsName(plotLabel), 'zone', zone],
    });
    await waitForTransactionReceipt(config, { hash });
    return { ok: true, hash };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Science key attempts `setAddress` (issue #20: "is denied on setAddress ... shows the revert"). This call is
 *  *expected* to fail with `EACUnauthorizedAccountRoles` — #7 only grants the science key `setText` roles
 *  scoped to `zone`/`species`, never `ROLE_SET_ADDRESS`. A screen showing `ok: false` here with that revert is
 *  the passing case, not an error state. */
export async function attemptScienceKeySetAddress(
  config: Config,
  addresses: EnsAddresses,
  plotLabel: string,
  address: Address,
): Promise<EnsWriteResult> {
  if (!addresses.plotResolver) return { ok: false, error: 'ENS plot resolver not deployed yet (see #7)' };
  try {
    const hash = await writeContract(config, {
      address: addresses.plotResolver,
      abi: PlotResolverAbi,
      functionName: 'setAddress',
      args: [getPlotDnsName(plotLabel), ETH_COIN_TYPE, address],
    });
    await waitForTransactionReceipt(config, { hash });
    return { ok: true, hash }; // if this ever succeeds, #7's role grant is wrong
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
