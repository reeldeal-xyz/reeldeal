// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal ENSv2 read surface the pool needs. Verified byte-for-byte against primary source for
///         issue #11 ("ReliefPool reads ENS on-chain"):
///           ensdomains/contracts-v2 @ 71a3b7339dbc55ab47667abdfe8303bac4f4c24e
///             contracts/src/registry/interfaces/IRegistry.sol            (getSubregistry, getResolver)
///             contracts/src/registry/interfaces/IOwnedRegistry.sol       (findOwner)
///             contracts/src/registry/interfaces/ITemporalRegistry.sol    (findExpiry)
///             contracts/src/registry/interfaces/IPermissionedRegistry.sol (Status, State, getState)
///
///         `PermissionedRegistry` (the contract behind `UserRegistryImpl`, and so every registry this repo
///         deploys — parent, branch, per-plot) implements `findOwner`/`findExpiry` as
///         `findX(label) = getX(LibLabel.id(label))`, where `getX` already folds in expiry: both (and
///         `getSubregistry`/`getResolver`) return zero once `block.timestamp >= expiry` — confirmed against
///         `PermissionedRegistry.getOwner`/`.getSubregistry`/`.getResolver`.
///
///         `EnsSlotResolver` deliberately does NOT use `findOwner`/`findExpiry` for the season-slot walk:
///         since `findOwner` already returns zero for anything past expiry, it cannot distinguish "expired"
///         from "never assigned" — both would read as `farmer == 0`, collapsing `ReliefPool`'s
///         `REASON_PLOT_EXPIRED` into `REASON_NO_FARMER` (compare `MockSlotResolver.setSlot`/
///         `ReliefPoolSettleTest._expiredSlot`, which deliberately keeps `farmer` nonzero with a past
///         `slotExpiry` so `_checkEligibility` can tell the two apart). `getState(anyId)` gives the RAW
///         `latestOwner` (zero only once the label is actually `unregister`'d/burned, not merely
///         time-expired — see `PermissionedRegistry.getState`/`.latestOwnerOf`) alongside the raw `expiry`,
///         letting `ReliefPool._checkEligibility`'s own `slotExpiry <= block.timestamp` check do the
///         expired/not-expired split, exactly as the mock does.
enum EnsRegistrationStatus {
    AVAILABLE,
    RESERVED,
    REGISTERED
}

struct EnsRegistrationState {
    EnsRegistrationStatus status;
    uint64 expiry;
    address latestOwner;
    uint256 tokenId;
    uint256 resource;
}

interface IEnsV2Registry {
    function getSubregistry(string calldata label) external view returns (address);
    function getResolver(string calldata label) external view returns (address);
    function findOwner(string calldata label) external view returns (address);
    function findExpiry(string calldata label) external view returns (uint64);

    /// @notice Raw registration state for a labelhash/tokenId/resource (`anyId` — see
    ///         `PermissionedRegistry`'s doc comment on the interchangeability of these three forms).
    ///         `latestOwner` is zero only if the label was actually unregistered/burned, regardless of
    ///         time-based expiry — see the adapter-selection rationale above.
    function getState(uint256 anyId) external view returns (EnsRegistrationState memory);
}

interface IExtendedResolver {
    function resolve(bytes calldata dnsEncodedName, bytes calldata data) external view returns (bytes memory);
}
