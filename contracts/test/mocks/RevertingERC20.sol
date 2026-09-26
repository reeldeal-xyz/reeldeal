// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";

/// @notice ERC20Mock with a switch to make `transfer()` to one specific address revert, while every other
///         transfer/transferFrom keeps working normally. Used to prove SaleRouter.checkout's seller-payment
///         leg failing reverts the whole atomic checkout (nothing left half-done), without needing a second
///         mock just for that one scenario.
contract RevertingERC20 is ERC20Mock {
    address public blockedTransferTo;

    function setBlockedTransferTo(address to) external {
        blockedTransferTo = to;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (to == blockedTransferTo) revert("RevertingERC20: blocked transfer");
        return super.transfer(to, value);
    }
}
