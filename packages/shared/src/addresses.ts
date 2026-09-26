// Public Sepolia addresses. ENSv2 redeploys roughly monthly: re-pull from docs.ens.domains before the demo.
export const CHAIN_ID = 11155111 as const;

export const JPYC = '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29' as const; // 18 decimals, faucet: https://faucet.jpyc.co.jp
export const JPYC_DECIMALS = 18 as const;

// EIP-712 domain for JPYC's EIP-3009 (transferWithAuthorization) and EIP-2612 (permit) signatures.
// JPYC's DOMAIN_SEPARATOR() and eip712Domain() (EIP-5267) both revert on this proxy -- it doesn't expose
// either getter -- so this domain is NOT read from the contract; it's a literal hardcoded from a live
// verification (2026-09-26, Sepolia): a `transferWithAuthorization(..., value: 0)` signed with
// {name: "JPY Coin", version: "1", chainId: 11155111, verifyingContract: JPYC} recovers correctly (the
// eth_call simulation returns `0x`, i.e. no revert); the identical message signed with version "2" instead
// reverts "EIP3009: invalid signature". name()/symbol()/decimals() on-chain: "JPY Coin"/"JPYC"/18, matching
// jcam1/JPYCv2's FiatTokenV1.initialize(), which hardcodes VERSION = "1". verifyingContract is this proxy
// address (JPYC above), not its EIP-1967 implementation (0xafac17fc3936a29ca2d2787ced3c5d1c52007d2e on
// Sepolia at time of verification) -- the proxy is what farmers and the keeper actually call.
export const JPYC_EIP712_DOMAIN = {
  name: 'JPY Coin',
  version: '1',
} as const;

// ENSv2 Sepolia, contracts-v2 71a3b7339dbc55ab47667abdfe8303bac4f4c24e (deploy/sepolia-migration-20260915,
// deployed 2026-09-15T09:46:38Z; re-verified against contracts/deployments/sepolia/addresses.md at that
// commit and live `cast code` on Sepolia, checked 2026-09-26 — still current, no redeploy since)
export const ENS = {
  ETHRegistrar: '0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca',
  ETHRegistry: '0x657ea849311d3d5823348dded7c2aaafb3ede09e',
  RootRegistry: '0x9703dbd26dab89504490994138cf2c575251a9ce',
  VerifiableFactory: '0x9e726eb570beb6bceb495ab8cda7df517d4e841c',
  PermissionedResolverImpl: '0x14f09fd05d4585759e54844dc9b00147131cf243',
  UserRegistryImpl: '0xa80338aaa8d23831cea25e858d1774534abb0263',
  MockUSDC: '0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e',
  UniversalResolverV2Proxy: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe',
} as const;

// Filled after deploy (issue: deploy to public Sepolia).
export const DEPLOYED = {
  HumanRegistry: '0xc713c174b33B071f7Bf6dC571E3dd7BfB441D4F8',
  ReliefPool: '0x560E8404be74DCB7F3877835F374CF1B1B696D32',
  ReliefPoolDeployBlock: 11785370,
  EnsPlotResolver: '0x5Fd09356151DfF3DFca06B1270e5DDAF11DaF89b',
  EnsSlotResolver: '0xbf91d74c0010ba727bD3B251B3fc5700835c80Ec',
} as const;
