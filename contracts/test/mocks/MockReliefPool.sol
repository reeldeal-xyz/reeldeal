// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IReliefPoolDonate} from "../../src/interfaces/ISaleRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal IReliefPoolDonate double: pulls `amount` from the caller (mirroring ReliefPool.donate's
///         `safeTransferFrom(msg.sender, address(this), amount)`) and records the last call for assertions.
///         SaleRouter tests use this instead of the real ReliefPool so they depend only on the `donate`
///         surface SaleRouter actually calls; the real integration is covered by the fork dryRun script
///         against the live v2 pool.
contract MockReliefPool is IReliefPoolDonate {
    IERC20 public immutable jpyc;

    address public lastFrom;
    uint256 public lastAmount;
    string public lastMemo;
    uint256 public donateCallCount;

    constructor(IERC20 jpyc_) {
        jpyc = jpyc_;
    }

    function donate(uint256 amount, string calldata memo) external {
        require(amount > 0, "MockReliefPool: zero amount");
        jpyc.transferFrom(msg.sender, address(this), amount);
        lastFrom = msg.sender;
        lastAmount = amount;
        lastMemo = memo;
        donateCallCount += 1;
    }
}
