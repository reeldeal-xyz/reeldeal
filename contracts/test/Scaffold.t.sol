// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ReliefPool} from "../src/ReliefPool.sol";
import {HumanRegistry} from "../src/HumanRegistry.sol";
import {IReliefPool} from "../src/interfaces/IReliefPool.sol";
import {IPlotResolver} from "../src/interfaces/IPlotResolver.sol";
import {ISlotResolver} from "../src/interfaces/ISlotResolver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ScaffoldTest is Test {
    function test_eventIdMatchesSharedEncoding() public {
        HumanRegistry humans = new HumanRegistry(address(this), address(this));
        ReliefPool pool = new ReliefPool(
            IERC20(address(0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29)),
            humans,
            IPlotResolver(address(0)),
            ISlotResolver(address(0)),
            address(this)
        );
        IReliefPool.Trigger memory t;
        t.zoneId = keccak256("karakuwa-east");
        t.speciesId = keccak256("scallop");
        t.perilId = keccak256("HEAT");
        t.tier = 2;
        t.tempC = 26;
        t.seasonLabel = "2026";
        assertEq(pool.eventIdOf(t), keccak256(abi.encode(t.zoneId, t.speciesId, t.perilId, t.tier, t.seasonLabel)));
    }
}
