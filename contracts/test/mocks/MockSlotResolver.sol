// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ISlotResolver} from "../../src/interfaces/ISlotResolver.sol";

/// @notice Settable test double for ISlotResolver. Stands in for the ENSv2 branch -> plot -> season-slot walk
///         until issue #11 ("ReliefPool reads ENS on-chain") wires the real adapter.
contract MockSlotResolver is ISlotResolver {
    struct Slot {
        address farmer;
        address plotRegistry;
        uint64 slotExpiry;
    }

    mapping(bytes32 => Slot) internal _slots;

    function setSlot(string calldata plotLabel, string calldata seasonLabel, address farmer, address plotRegistry, uint64 slotExpiry)
        external
    {
        _slots[_key(plotLabel, seasonLabel)] = Slot(farmer, plotRegistry, slotExpiry);
    }

    function slotOwnerOf(string calldata plotLabel, string calldata seasonLabel)
        external
        view
        returns (address farmer, address plotRegistry, uint64 slotExpiry)
    {
        Slot memory s = _slots[_key(plotLabel, seasonLabel)];
        return (s.farmer, s.plotRegistry, s.slotExpiry);
    }

    function _key(string calldata plotLabel, string calldata seasonLabel) internal pure returns (bytes32) {
        return keccak256(abi.encode(plotLabel, seasonLabel));
    }
}
