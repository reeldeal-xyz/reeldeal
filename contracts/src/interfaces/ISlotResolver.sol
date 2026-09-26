// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Season-slot owner/expiry lookup used by `ReliefPool.settle`/`claimHeld` and exposed read-only via
///         `payoutTarget`. Backed by a mock in tests until "ReliefPool reads ENS on-chain" (issue #11) wires the
///         real ENSv2 branch -> plot -> slot walk (see IEnsV2.sol): branch registry `getSubregistry(plotLabel)`
///         gives the plot's per-plot registry (`plotRegistry` here), which owns the expiring, non-transferable
///         season slots; `findOwner`/expiry on that registry give `farmer`/`slotExpiry`.
/// @dev Return shape mirrors `IReliefPool.payoutTarget` exactly so #11 can implement this interface once and
///      plug it into both the pool's constructor and its own tests without adding a second lookup surface.
interface ISlotResolver {
    /// @notice Returns the wallet owning `plotLabel`'s `seasonLabel` season slot, the address of the plot's
    ///         per-plot ENSv2 registry, and the slot's expiry (unix seconds).
    /// @dev `farmer == address(0)` means the plot/season slot does not resolve to an owner (unassigned or
    ///      unknown plot) — callers treat this as "no farmer" and must not pay. `slotExpiry <= block.timestamp`
    ///      means the slot has expired even if `farmer` is nonzero (e.g. a stale/cached owner) — callers must
    ///      treat this as "expired" and must not pay. `plotRegistry` is informational (not consumed by
    ///      `settle`'s eligibility checks).
    function slotOwnerOf(string calldata plotLabel, string calldata seasonLabel)
        external
        view
        returns (address farmer, address plotRegistry, uint64 slotExpiry);
}
