// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice ENSv2 Sepolia deployment addresses used by the branch-registration script/tests (issue #7).
///
///         Source of truth is `packages/shared/src/addresses.ts` — keep these in sync with it, and
///         re-pull both from a fresh ENSv2 deploy before the demo if Sepolia has redeployed (CLAUDE.md:
///         "ENSv2 Sepolia redeploys monthly").
///
///         Verified primary sources (2026-09-26):
///         - ensdomains/contracts-v2 @ 71a3b7339dbc55ab47667abdfe8303bac4f4c24e
///           `contracts/deployments/sepolia/addresses.md` (deploy timestamp 2026-09-15T09:46:38.513Z,
///           branch `deploy/sepolia-migration-20260915`) — every address below matches that file
///           byte-for-byte.
///         - `cast code <addr> --rpc-url https://ethereum-sepolia-rpc.publicnode.com` returns non-empty
///           bytecode for every address below (checked 2026-09-26).
///
///         `UNIVERSAL_RESOLVER` here is ENSv2's `UpgradableUniversalResolverProxy`, which
///         `packages/shared/src/addresses.ts` labels `UniversalResolverV2Proxy`.
library EnsV2Sepolia {
    address internal constant ETH_REGISTRAR = 0xAbe76F6C8DFcEd81AA5A2bB8034202A7136b94ca;
    address internal constant ETH_REGISTRY = 0x657eA849311d3D5823348ddEd7C2AaAFb3EDE09E;
    address internal constant ROOT_REGISTRY = 0x9703DBD26dAB89504490994138cF2c575251a9cE;
    address internal constant VERIFIABLE_FACTORY = 0x9e726Eb570beb6BCEb495AB8cdA7df517d4e841C;
    address internal constant PERMISSIONED_RESOLVER_IMPL = 0x14F09Fd05d4585759e54844DC9B00147131Cf243;
    address internal constant USER_REGISTRY_IMPL = 0xA80338aAA8D23831cEa25E858D1774534aBb0263;
    address internal constant MOCK_USDC = 0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e;
    address internal constant UNIVERSAL_RESOLVER = 0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe;
}
