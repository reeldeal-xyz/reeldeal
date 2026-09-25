// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal ENSv2 read surface the pool needs. VERIFY every signature against the pinned ABIs
///         (contracts-v2 71a3b733) before relying on it — see issue "ENS on-chain reads".
interface IEnsV2Registry {
    function getSubregistry(string calldata label) external view returns (address);
    function getResolver(string calldata label) external view returns (address);
    function findOwner(string calldata label) external view returns (address); // TODO: confirm name/return on fork
}

interface IExtendedResolver {
    function resolve(bytes calldata dnsEncodedName, bytes calldata data) external view returns (bytes memory);
}
