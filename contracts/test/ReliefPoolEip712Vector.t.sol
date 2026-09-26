// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ReliefPool} from "../src/ReliefPool.sol";
import {IReliefPool} from "../src/interfaces/IReliefPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import {MockHumanRegistry} from "./mocks/MockHumanRegistry.sol";
import {MockPlotResolver} from "./mocks/MockPlotResolver.sol";
import {MockSlotResolver} from "./mocks/MockSlotResolver.sol";

/// @notice Cross-checks ReliefPool.triggerDigest against an independently computed viem `hashTypedData` vector,
///         so the on-chain EIP-712 encoding is verified against the exact TRIGGER_EIP712_TYPES + eip712Domain
///         the pipeline and keeper sign with (packages/shared/src/trigger.ts), not just against itself.
///
///         Regenerate EXPECTED_DIGEST with:
///           bun run packages/shared/scripts/print-trigger-digest.ts
///
///         The verifyingContract is never hardcoded: both sides derive it as the CREATE address for nonce 0 of
///         the well-known "private key 1" account, so `vm.addr(1)` here and `privateKeyToAccount(0x0...1)` in
///         the script always agree without either side needing a magic constant address.
contract ReliefPoolEip712VectorTest is Test {
    bytes32 internal constant EXPECTED_DIGEST = 0x92e856ebfd0d892545ec2386d8d9171473acdfcb9358ba71f03399d7c9daed58;

    function test_triggerDigest_matchesViemHashTypedDataVector() public {
        vm.chainId(11155111); // eip712Domain() in packages/shared/src/trigger.ts hardcodes Sepolia's chainId

        address deployer = vm.addr(1);
        address predictedPool = vm.computeCreateAddress(deployer, 0);

        ERC20Mock jpyc = new ERC20Mock();
        MockHumanRegistry humans = new MockHumanRegistry();
        MockPlotResolver resolver = new MockPlotResolver();
        MockSlotResolver slotResolver = new MockSlotResolver();

        vm.prank(deployer);
        ReliefPool pool = new ReliefPool(IERC20(address(jpyc)), humans, resolver, slotResolver, address(this));
        assertEq(address(pool), predictedPool, "pool address must match the offline CREATE(deployer, 0) prediction");

        IReliefPool.Trigger memory t;
        t.zoneId = keccak256(bytes("karakuwa-east"));
        t.speciesId = keccak256(bytes("scallop"));
        t.perilId = keccak256(bytes("HEAT25"));
        t.tier = 1;
        t.seasonLabel = "2026";
        t.windowStart = 1690848000; // 2023-08-01T00:00:00Z
        t.windowEnd = 1693526400; // 2023-09-01T00:00:00Z
        t.firedAt = 1691798400; // 2023-08-12T00:00:00Z
        t.index = 20;
        t.threshold = 14;
        t.dataHash = keccak256(bytes("eip712-vector-fixture"));
        t.deadline = 1735689600; // 2025-01-01T00:00:00Z

        assertEq(pool.triggerDigest(t), EXPECTED_DIGEST, "Solidity digest must match the viem hashTypedData vector");
    }
}
