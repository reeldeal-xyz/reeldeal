// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ISlotResolver} from "../interfaces/ISlotResolver.sol";
import {IEnsV2Registry, EnsRegistrationState} from "../interfaces/IEnsV2.sol";

/// @notice Issue #11 — real ISlotResolver adapter: walks branch -> plot -> season slot on the ENSv2
///         deployment issue #10 creates.
///
///         `branchRegistry.getSubregistry(plotLabel)` gives the plot's own per-plot `UserRegistry` (a
///         `VerifiableFactory` proxy of `UserRegistryImpl`, deployed and registered by
///         `DeployEnsPlots.s.sol`); that registry's `getState(labelhash(seasonLabel))` gives the season
///         slot's raw owner and expiry in one call.
///
///         Uses `getState`/`latestOwner`, NOT `findOwner` — `findOwner` already returns zero once a label's
///         expiry has elapsed, so it cannot tell "expired" apart from "never assigned"; both would surface
///         as `ReliefPool.REASON_NO_FARMER`, never `REASON_PLOT_EXPIRED`. `latestOwner` stays the last real
///         owner across a time-based expiry (it only zeroes once the label is actually
///         `unregister`'d/burned), so `ReliefPool._checkEligibility`'s own `slotExpiry <= block.timestamp`
///         check can do the expired/unassigned split — see `IEnsV2.sol` for the full rationale.
///
///         Season slots are:
///           - expiring: ENSv2's own per-registration `expiry` (set at `register()`, e.g. 2027-03-31 for
///             the "2026" fiscal-year slot);
///           - non-transferable: issued with `roleBitmap 0`, so the farmer never holds
///             `RegistryRolesLib.ROLE_CAN_TRANSFER_ADMIN` — `PermissionedRegistry._update` reverts
///             `TransferDisallowed` on any transfer attempt of that token, by anyone, forever (that role is
///             "not grantable" after the fact — see `RegistryRolesLib.sol`).
///
///         A plot with no per-plot registry yet (unknown/never-created plot), or a season label that was
///         never registered on one, resolves to `(farmer: 0, plotRegistry: ..., slotExpiry: 0)`, which
///         `ReliefPool._checkEligibility` treats as `NO_FARMER`.
contract EnsSlotResolver is ISlotResolver {
    IEnsV2Registry public immutable branchRegistry;

    constructor(IEnsV2Registry branchRegistry_) {
        branchRegistry = branchRegistry_;
    }

    /// @inheritdoc ISlotResolver
    function slotOwnerOf(string calldata plotLabel, string calldata seasonLabel)
        external
        view
        returns (address farmer, address plotRegistry, uint64 slotExpiry)
    {
        plotRegistry = branchRegistry.getSubregistry(plotLabel);
        if (plotRegistry == address(0)) {
            return (address(0), address(0), 0);
        }

        EnsRegistrationState memory state =
            IEnsV2Registry(plotRegistry).getState(uint256(keccak256(bytes(seasonLabel))));
        farmer = state.latestOwner;
        slotExpiry = state.expiry;
    }
}
