// Public Sepolia addresses. ENSv2 redeploys roughly monthly: re-pull from docs.ens.domains before the demo.
export const CHAIN_ID = 11155111 as const;

export const JPYC = '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29' as const; // 18 decimals, faucet: https://faucet.jpyc.co.jp
export const JPYC_DECIMALS = 18 as const;

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
  HumanRegistry: '0x0000000000000000000000000000000000000000',
  ReliefPool: '0x0000000000000000000000000000000000000000',
} as const;
