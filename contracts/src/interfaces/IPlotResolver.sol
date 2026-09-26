// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Plot -> (zone, species) lookup used by `enroll`/`reindex` to cache what a plot grows. Backed by a
///         mock in tests until "ReliefPool reads ENS on-chain" wires the real ENSv2 branch -> plot walk
///         (see interfaces/IEnsV2.sol). The season-slot owner/expiry lookup needed by `payoutTarget` is a
///         separate concern, added by that work together with "settle, hold reasons, claimHeld, sweep".
interface IPlotResolver {
    /// @notice Returns keccak256(label) ids for the plot's zone and species (mirrors @repo/shared idOf), or
    ///         zero for a plot that does not resolve.
    function zoneAndSpeciesOf(string calldata plotLabel) external view returns (bytes32 zoneId, bytes32 speciesId);
}
