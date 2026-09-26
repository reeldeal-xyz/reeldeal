// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IHumanRegistry} from "../../src/interfaces/IHumanRegistry.sol";

/// @notice Settable test double for IHumanRegistry. HumanRegistry (issue #4) is built in parallel on another
///         branch; ReliefPool core tests depend only on the interface, never on that implementation, so this
///         mock also gives "settle, hold reasons, claimHeld, sweep" (issue #8) a way to fix a wallet's level.
contract MockHumanRegistry is IHumanRegistry {
    mapping(address => Human) internal _humans;
    mapping(bytes32 => address) internal _wallets;
    mapping(address => uint8) internal _levels;

    /// @dev Test helper only; the real registry writes via `bind`/`upgrade` after server-side World ID verify.
    function setHuman(address wallet, uint8 level, bytes32 nullifier, uint16 schemaId, uint16 sybilScoreBps)
        external
    {
        _levels[wallet] = level;
        _humans[wallet] = Human(nullifier, schemaId, sybilScoreBps, uint64(block.timestamp), bytes32(0));
        _wallets[nullifier] = wallet;
    }

    function bind(address, bytes32, uint16, uint16, uint64, bytes32) external pure {
        revert("MockHumanRegistry: unused by ReliefPool core");
    }

    function upgrade(address, bytes32, uint16, bytes32) external pure {
        revert("MockHumanRegistry: unused by ReliefPool core");
    }

    function rebind(bytes32, address) external pure {
        revert("MockHumanRegistry: unused by ReliefPool core");
    }

    function levelOf(address wallet) external view returns (uint8) {
        return _levels[wallet];
    }

    function humanOf(address wallet) external view returns (Human memory) {
        return _humans[wallet];
    }

    function walletOf(bytes32 nullifier) external view returns (address) {
        return _wallets[nullifier];
    }
}
