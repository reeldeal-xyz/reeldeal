// Typed contract surface for the browser-wallet screens (issues #19/#20/#21). Addresses come from
// NEXT_PUBLIC_* env vars (see lib/env.ts publicEnv) rather than packages/shared's DEPLOYED, since DEPLOYED is
// only filled once #16 lands — until then every screen renders a "not deployed yet" state.
import type { Address } from 'viem';
import { ReliefPoolAbi, HumanRegistryAbi, JPYC, JPYC_DECIMALS, CHAIN_ID } from '@repo/shared';
import { Erc20Abi } from './erc20-abi';

export { ReliefPoolAbi, HumanRegistryAbi, Erc20Abi, JPYC, JPYC_DECIMALS, CHAIN_ID };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Narrows a possibly-unset env string to a checksum-agnostic Address, or undefined ("not deployed yet"). */
export const asAddress = (v: string | undefined | null): Address | undefined =>
  v && ADDRESS_RE.test(v) ? (v as Address) : undefined;
