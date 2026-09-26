// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IReliefPoolDonate} from "../../src/interfaces/ISaleRouter.sol";

/// @notice Trivial IReliefPoolDonate implementation that always reverts on `donate`. Used to prove
///         SaleRouter.checkout's donate leg failing reverts the whole atomic checkout, including the seller
///         payment that already happened earlier in the same call.
contract MockRevertingReliefPool is IReliefPoolDonate {
    function donate(uint256, string calldata) external pure {
        revert("MockRevertingReliefPool: donate always reverts");
    }
}
