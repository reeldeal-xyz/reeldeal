// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ReliefPool} from "../src/ReliefPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import {MockHumanRegistry} from "./mocks/MockHumanRegistry.sol";
import {MockPlotResolver} from "./mocks/MockPlotResolver.sol";
import {MockSlotResolver} from "./mocks/MockSlotResolver.sol";
import {ReliefPoolHandler} from "./invariant/ReliefPoolHandler.sol";

/// @notice Issue #8's required invariant: `reserved` is never anything other than the JPYC still committed to
///         plots that are pending (never settled) or Held. Every unit that becomes Paid, Claimed or Swept must
///         leave `reserved` — this is checked by fuzzing arbitrary attest/settle/claimHeld/sweep/warp sequences
///         (via ReliefPoolHandler, which hits every hold reason plus straight payouts) and comparing
///         `pool.reserved()` against an independent ghost ledger after every call.
contract ReliefPoolInvariantTest is Test {
    ERC20Mock internal jpyc;
    MockHumanRegistry internal humans;
    MockPlotResolver internal plotResolver;
    MockSlotResolver internal slotResolver;
    ReliefPool internal pool;
    ReliefPoolHandler internal handler;

    function setUp() public {
        vm.warp(1_700_000_000);

        jpyc = new ERC20Mock();
        humans = new MockHumanRegistry();
        plotResolver = new MockPlotResolver();
        slotResolver = new MockSlotResolver();
        pool = new ReliefPool(IERC20(address(jpyc)), humans, plotResolver, slotResolver, address(this));

        (address signer1, uint256 signer1Key) = makeAddrAndKey("inv-signer1");
        (address signer2, uint256 signer2Key) = makeAddrAndKey("inv-signer2");
        address[] memory sset = new address[](2);
        sset[0] = signer1;
        sset[1] = signer2;
        pool.setSigners(sset, 2);
        pool.setTierAmount(keccak256(bytes("HEAT")), keccak256(bytes("scallop")), 1, 1_000e18);

        handler = new ReliefPoolHandler(
            pool, jpyc, humans, plotResolver, slotResolver, signer1, signer1Key, signer2, signer2Key
        );

        // Restrict the fuzzer to the handler's bounded action methods. Without this, Foundry also calls every
        // other public function on the handler — including auto-generated array getters like
        // `eventIds(uint256)`, which revert on an out-of-bounds index (the common case before enough attest
        // calls have run) and would spuriously fail runs under fail_on_revert = true for reasons that have
        // nothing to do with ReliefPool's actual invariants.
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = ReliefPoolHandler.donate.selector;
        selectors[1] = ReliefPoolHandler.attestNext.selector;
        selectors[2] = ReliefPoolHandler.settleSome.selector;
        selectors[3] = ReliefPoolHandler.claimOne.selector;
        selectors[4] = ReliefPoolHandler.sweepOne.selector;
        selectors[5] = ReliefPoolHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// @notice Core reserve invariant: reserved == pending + held, i.e. everything attested minus everything
    ///         that has actually left the reserve (Paid + Claimed + Swept).
    function invariant_reservedEqualsAttestedMinusLeftReserve() public view {
        assertEq(pool.reserved(), handler.totalReservedAtAttest() - handler.ghostReservedOut());
    }

    /// @notice Solvency: the pool can never have reserved more JPYC than it actually holds.
    function invariant_reservedNeverExceedsBalance() public view {
        assertLe(pool.reserved(), jpyc.balanceOf(address(pool)));
    }
}
