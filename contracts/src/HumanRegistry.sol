// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IHumanRegistry} from "./interfaces/IHumanRegistry.sol";

/// @notice Scaffold. Implementation tracked in the "HumanRegistry" issue.
contract HumanRegistry is IHumanRegistry {
    error NotImplemented();

    address public immutable admin;
    address public binder;

    constructor(address admin_, address binder_) {
        admin = admin_;
        binder = binder_;
    }

    function bind(address, bytes32, uint16, uint16, uint64, bytes32) external pure { revert NotImplemented(); }
    function upgrade(address, bytes32, uint16, bytes32) external pure { revert NotImplemented(); }
    function rebind(bytes32, address) external pure { revert NotImplemented(); }
    function levelOf(address) external pure returns (uint8) { return 0; }
    function humanOf(address) external pure returns (Human memory h) { return h; }
    function walletOf(bytes32) external pure returns (address) { return address(0); }
}
