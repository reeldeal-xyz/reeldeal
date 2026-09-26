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

/// @notice Issue #8: settle, hold reasons (NO_FARMER, PLOT_EXPIRED, UNVERIFIED, CAP, ZONE_MISMATCH), claimHeld,
///         sweep, and per-level unit caps (L1=3, L2=12 via HumanRegistry.levelOf, capped per nullifier per
///         event). The real ENSv2 slot walk behind ISlotResolver is issue #11 — this suite drives ReliefPool
///         entirely through MockSlotResolver.
contract ReliefPoolSettleTest is Test {
    ERC20Mock internal jpyc;
    MockHumanRegistry internal humans;
    MockPlotResolver internal plotResolver;
    MockSlotResolver internal slotResolver;
    ReliefPool internal pool;

    address internal admin = makeAddr("admin");
    address internal donor = makeAddr("donor");
    address internal keeper = makeAddr("keeper"); // settle/claimHeld/sweep are permissionless; any caller works

    address internal signer1;
    uint256 internal signer1Key;
    address internal signer2;
    uint256 internal signer2Key;
    address internal signer3;
    uint256 internal signer3Key;

    bytes32 internal zoneId = keccak256(bytes("karakuwa-east"));
    bytes32 internal speciesId = keccak256(bytes("scallop"));
    bytes32 internal perilId = keccak256(bytes("HEAT25"));
    string internal seasonLabel = "2026";

    address internal farmerA = makeAddr("farmerA");
    address internal farmerB = makeAddr("farmerB");
    bytes32 internal nullifierA = keccak256("nullifier-a");
    bytes32 internal nullifierB = keccak256("nullifier-b");

    uint256 internal perUnit = 20_000e18;

    function setUp() public {
        vm.warp(1_700_000_000);

        jpyc = new ERC20Mock();
        humans = new MockHumanRegistry();
        plotResolver = new MockPlotResolver();
        slotResolver = new MockSlotResolver();
        pool = new ReliefPool(IERC20(address(jpyc)), humans, plotResolver, slotResolver, admin);

        (signer1, signer1Key) = makeAddrAndKey("signer1");
        (signer2, signer2Key) = makeAddrAndKey("signer2");
        (signer3, signer3Key) = makeAddrAndKey("signer3");

        address[] memory sset = new address[](3);
        sset[0] = signer1;
        sset[1] = signer2;
        sset[2] = signer3;
        vm.prank(admin);
        pool.setSigners(sset, 2);

        vm.prank(admin);
        pool.setTierAmount(perilId, speciesId, 1, perUnit);

        jpyc.mint(donor, 10_000_000e18);
        vm.prank(donor);
        jpyc.approve(address(pool), type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    function _enroll(string memory plotLabel, bytes32 zId, bytes32 spId) internal {
        plotResolver.setPlot(plotLabel, zId, spId);
        pool.enroll(plotLabel);
    }

    function _trigger(uint32 index_, uint64 deadline_) internal view returns (IReliefPool.Trigger memory t) {
        t.zoneId = zoneId;
        t.speciesId = speciesId;
        t.perilId = perilId;
        t.tier = 1;
        t.seasonLabel = seasonLabel;
        t.windowStart = uint64(block.timestamp - 30 days);
        t.windowEnd = uint64(block.timestamp - 1);
        t.firedAt = uint64(block.timestamp - 2);
        t.index = index_;
        t.threshold = 14;
        t.dataHash = keccak256("data");
        t.deadline = deadline_;
    }

    function _sign(uint256 key, IReliefPool.Trigger memory t) internal view returns (bytes memory) {
        bytes32 digest = pool.triggerDigest(t);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _sign2of3(IReliefPool.Trigger memory t) internal view returns (bytes[] memory sigs) {
        sigs = new bytes[](2);
        sigs[0] = _sign(signer1Key, t);
        sigs[1] = _sign(signer2Key, t);
    }

    function _attest(uint256 units) internal returns (bytes32 eventId) {
        vm.prank(donor);
        pool.donate(units * perUnit * 10, ""); // generous free balance so tierAmount is always binding
        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        eventId = pool.attest(t, _sign2of3(t));
    }

    function _plots(string memory a) internal pure returns (string[] memory arr) {
        arr = new string[](1);
        arr[0] = a;
    }

    function _bindLevel1(address wallet, bytes32 nullifier) internal {
        humans.setHuman(wallet, 1, nullifier, 11, 500);
    }

    function _bindLevel2(address wallet, bytes32 nullifier) internal {
        humans.setHuman(wallet, 2, nullifier, 1, 500);
    }

    function _activeSlot(string memory plotLabel, address farmer) internal {
        slotResolver.setSlot(plotLabel, seasonLabel, farmer, address(0), uint64(block.timestamp + 365 days));
    }

    function _expiredSlot(string memory plotLabel, address farmer) internal {
        slotResolver.setSlot(plotLabel, seasonLabel, farmer, address(0), uint64(block.timestamp - 1));
    }

    // ---------------------------------------------------------------------
    // settle: happy path
    // ---------------------------------------------------------------------
    function test_settle_paysVerifiedFarmerAndDecrementsReserved() public {
        _enroll("p1", zoneId, speciesId);
        _bindLevel1(farmerA, nullifierA);
        _activeSlot("p1", farmerA);

        bytes32 eventId = _attest(1);
        uint256 reservedBefore = pool.reserved();

        vm.expectEmit(true, true, true, true, address(pool));
        emit IReliefPool.Paid(eventId, "p1", farmerA, nullifierA, perUnit);

        vm.prank(keeper);
        pool.settle(eventId, _plots("p1"));

        assertEq(jpyc.balanceOf(farmerA), perUnit);
        assertEq(pool.reserved(), reservedBefore - perUnit);
        (ReliefPool.PlotStatus status, bytes32 reason) = pool.plotSettlements(eventId, "p1");
        assertEq(uint8(status), uint8(ReliefPool.PlotStatus.Paid));
        assertEq(reason, bytes32(0));
        assertEq(pool.unitsPaid(eventId, nullifierA), 1);
    }

    function test_settle_isIdempotent_secondCallNoOps() public {
        _enroll("p1", zoneId, speciesId);
        _bindLevel1(farmerA, nullifierA);
        _activeSlot("p1", farmerA);
        bytes32 eventId = _attest(1);

        pool.settle(eventId, _plots("p1"));
        uint256 balAfterFirst = jpyc.balanceOf(farmerA);
        uint256 reservedAfterFirst = pool.reserved();

        pool.settle(eventId, _plots("p1")); // no-op: already Paid

        assertEq(jpyc.balanceOf(farmerA), balAfterFirst);
        assertEq(pool.reserved(), reservedAfterFirst);
    }

    function test_settle_batchMixesFreshAndAlreadySettledPlotsWithoutReverting() public {
        _enroll("p1", zoneId, speciesId);
        _enroll("p2", zoneId, speciesId);
        _bindLevel1(farmerA, nullifierA);
        _bindLevel2(farmerB, nullifierB);
        _activeSlot("p1", farmerA);
        _activeSlot("p2", farmerB);
        bytes32 eventId = _attest(2);

        pool.settle(eventId, _plots("p1")); // p1 already Paid before the batch below

        string[] memory batch = new string[](2);
        batch[0] = "p1";
        batch[1] = "p2";
        pool.settle(eventId, batch);

        (ReliefPool.PlotStatus s1,) = pool.plotSettlements(eventId, "p1");
        (ReliefPool.PlotStatus s2,) = pool.plotSettlements(eventId, "p2");
        assertEq(uint8(s1), uint8(ReliefPool.PlotStatus.Paid));
        assertEq(uint8(s2), uint8(ReliefPool.PlotStatus.Paid));
        assertEq(jpyc.balanceOf(farmerA), perUnit);
        assertEq(jpyc.balanceOf(farmerB), perUnit);
    }

    function test_settle_revertsForUnknownEvent() public {
        vm.expectRevert(abi.encodeWithSelector(ReliefPool.UnknownEvent.selector, bytes32(uint256(1))));
        pool.settle(bytes32(uint256(1)), _plots("p1"));
    }

    // ---------------------------------------------------------------------
    // settle: hold reasons
    // ---------------------------------------------------------------------
    function test_settle_holdsZoneMismatch_forNeverEnrolledPlot() public {
        _enroll("p1", zoneId, speciesId); // 1 eligible unit so attest succeeds
        bytes32 eventId = _attest(1);

        vm.expectEmit(true, false, false, true, address(pool));
        emit IReliefPool.Held(eventId, "ghost-plot", pool.REASON_ZONE_MISMATCH());
        pool.settle(eventId, _plots("ghost-plot"));

        (ReliefPool.PlotStatus status, bytes32 reason) = pool.plotSettlements(eventId, "ghost-plot");
        assertEq(uint8(status), uint8(ReliefPool.PlotStatus.Held));
        assertEq(reason, pool.REASON_ZONE_MISMATCH());
    }

    function test_settle_holdsZoneMismatch_forPlotReindexedAway() public {
        _enroll("p1", zoneId, speciesId);
        bytes32 eventId = _attest(1);

        bytes32 hoyaId = keccak256(bytes("hoya"));
        plotResolver.setPlot("p1", zoneId, hoyaId);
        pool.reindex("p1"); // p1 no longer part of (zoneId, speciesId)

        pool.settle(eventId, _plots("p1"));
        (, bytes32 reason) = pool.plotSettlements(eventId, "p1");
        assertEq(reason, pool.REASON_ZONE_MISMATCH());
    }

    function test_settle_holdsNoFarmer() public {
        _enroll("p1", zoneId, speciesId);
        // no slot set: farmer defaults to address(0)
        bytes32 eventId = _attest(1);

        vm.expectEmit(true, false, false, true, address(pool));
        emit IReliefPool.Held(eventId, "p1", pool.REASON_NO_FARMER());
        pool.settle(eventId, _plots("p1"));

        (, bytes32 reason) = pool.plotSettlements(eventId, "p1");
        assertEq(reason, pool.REASON_NO_FARMER());
    }

    function test_settle_holdsPlotExpired() public {
        _enroll("p1", zoneId, speciesId);
        _bindLevel1(farmerA, nullifierA);
        _expiredSlot("p1", farmerA);
        bytes32 eventId = _attest(1);

        vm.expectEmit(true, false, false, true, address(pool));
        emit IReliefPool.Held(eventId, "p1", pool.REASON_PLOT_EXPIRED());
        pool.settle(eventId, _plots("p1"));

        (, bytes32 reason) = pool.plotSettlements(eventId, "p1");
        assertEq(reason, pool.REASON_PLOT_EXPIRED());
        assertEq(jpyc.balanceOf(farmerA), 0);
    }

    function test_settle_holdsUnverified_forUnboundFarmer() public {
        _enroll("p1", zoneId, speciesId);
        _activeSlot("p1", farmerA); // farmerA never bound in HumanRegistry
        bytes32 eventId = _attest(1);

        vm.expectEmit(true, false, false, true, address(pool));
        emit IReliefPool.Held(eventId, "p1", pool.REASON_UNVERIFIED());
        pool.settle(eventId, _plots("p1"));

        (, bytes32 reason) = pool.plotSettlements(eventId, "p1");
        assertEq(reason, pool.REASON_UNVERIFIED());
    }

    function test_settle_holdsCap_afterLevel1FarmerExceedsThreeUnits() public {
        // 4 plots, all owned by the same level-1 (cap 3) farmer/nullifier.
        _enroll("p1", zoneId, speciesId);
        _enroll("p2", zoneId, speciesId);
        _enroll("p3", zoneId, speciesId);
        _enroll("p4", zoneId, speciesId);
        _bindLevel1(farmerA, nullifierA);
        _activeSlot("p1", farmerA);
        _activeSlot("p2", farmerA);
        _activeSlot("p3", farmerA);
        _activeSlot("p4", farmerA);

        bytes32 eventId = _attest(4);

        string[] memory batch = new string[](4);
        batch[0] = "p1";
        batch[1] = "p2";
        batch[2] = "p3";
        batch[3] = "p4";

        vm.expectEmit(true, false, false, true, address(pool));
        emit IReliefPool.Held(eventId, "p4", pool.REASON_CAP());
        pool.settle(eventId, batch);

        assertEq(pool.unitsPaid(eventId, nullifierA), 3);
        (ReliefPool.PlotStatus s4, bytes32 reason4) = pool.plotSettlements(eventId, "p4");
        assertEq(uint8(s4), uint8(ReliefPool.PlotStatus.Held));
        assertEq(reason4, pool.REASON_CAP());
        assertEq(jpyc.balanceOf(farmerA), perUnit * 3);
    }

    function test_settle_level2FarmerCappedAtTwelve() public {
        assertEq(pool.unitCap(2), 12);

        string[] memory batch = new string[](13);
        for (uint256 i = 0; i < 13; ++i) {
            string memory label = string(abi.encodePacked("plot-", vm.toString(i)));
            _enroll(label, zoneId, speciesId);
            _activeSlot(label, farmerB);
            batch[i] = label;
        }
        _bindLevel2(farmerB, nullifierB);

        bytes32 eventId = _attest(13);
        pool.settle(eventId, batch);

        assertEq(pool.unitsPaid(eventId, nullifierB), 12);
        (ReliefPool.PlotStatus lastStatus, bytes32 lastReason) = pool.plotSettlements(eventId, "plot-12");
        assertEq(uint8(lastStatus), uint8(ReliefPool.PlotStatus.Held));
        assertEq(lastReason, pool.REASON_CAP());
    }

    function test_settle_capIsPerNullifierNotPerWallet() public {
        // Two different farmer wallets sharing one nullifier (e.g. rebind mid-event in the real registry) —
        // MockHumanRegistry lets us construct this directly to prove the cap keys off nullifier, not wallet.
        _enroll("p1", zoneId, speciesId);
        _enroll("p2", zoneId, speciesId);
        _enroll("p3", zoneId, speciesId);
        _enroll("p4", zoneId, speciesId);
        _bindLevel1(farmerA, nullifierA);
        address farmerA2 = makeAddr("farmerA-secondWallet");
        humans.setHuman(farmerA2, 1, nullifierA, 11, 500);

        _activeSlot("p1", farmerA);
        _activeSlot("p2", farmerA);
        _activeSlot("p3", farmerA);
        _activeSlot("p4", farmerA2); // same nullifier, different wallet

        bytes32 eventId = _attest(4);
        string[] memory batch = new string[](4);
        batch[0] = "p1";
        batch[1] = "p2";
        batch[2] = "p3";
        batch[3] = "p4";
        pool.settle(eventId, batch);

        assertEq(pool.unitsPaid(eventId, nullifierA), 3);
        (ReliefPool.PlotStatus s4, bytes32 reason4) = pool.plotSettlements(eventId, "p4");
        assertEq(uint8(s4), uint8(ReliefPool.PlotStatus.Held));
        assertEq(reason4, pool.REASON_CAP());
    }

    function test_settle_checkOrder_zoneMismatchBeatsOtherReasons() public {
        // p1 is enrolled under a different zone AND would also fail NO_FARMER (no slot set) — ZONE_MISMATCH
        // must win since it's checked first and doesn't need a slot lookup at all.
        bytes32 otherZone = keccak256(bytes("kesennuma-bay"));
        _enroll("p1", otherZone, speciesId); // wrong zone for the event we attest below
        _enroll("p2", zoneId, speciesId); // gives the event an eligible unit
        bytes32 eventId = _attest(1);

        pool.settle(eventId, _plots("p1"));
        (, bytes32 reason) = pool.plotSettlements(eventId, "p1");
        assertEq(reason, pool.REASON_ZONE_MISMATCH());
    }

    // ---------------------------------------------------------------------
    // claimHeld
    // ---------------------------------------------------------------------
    function test_claimHeld_paysAfterFarmerBecomesVerified() public {
        _enroll("p1", zoneId, speciesId);
        _activeSlot("p1", farmerA); // unbound at settle time -> UNVERIFIED
        bytes32 eventId = _attest(1);
        pool.settle(eventId, _plots("p1"));

        (ReliefPool.PlotStatus statusBefore,) = pool.plotSettlements(eventId, "p1");
        assertEq(uint8(statusBefore), uint8(ReliefPool.PlotStatus.Held));

        _bindLevel1(farmerA, nullifierA); // farmer verifies after the hold
        uint256 reservedBefore = pool.reserved();

        vm.expectEmit(true, false, false, true, address(pool));
        emit IReliefPool.Claimed(eventId, "p1", farmerA, perUnit);

        vm.prank(keeper);
        pool.claimHeld(eventId, "p1");

        assertEq(jpyc.balanceOf(farmerA), perUnit);
        assertEq(pool.reserved(), reservedBefore - perUnit);
        (ReliefPool.PlotStatus statusAfter, bytes32 reasonAfter) = pool.plotSettlements(eventId, "p1");
        assertEq(uint8(statusAfter), uint8(ReliefPool.PlotStatus.Claimed));
        assertEq(reasonAfter, bytes32(0));
        assertEq(pool.unitsPaid(eventId, nullifierA), 1);
    }

    function test_claimHeld_revertsIfStillIneligible() public {
        _enroll("p1", zoneId, speciesId);
        // no slot at all -> NO_FARMER
        bytes32 eventId = _attest(1);
        pool.settle(eventId, _plots("p1"));

        vm.expectRevert(
            abi.encodeWithSelector(ReliefPool.StillIneligible.selector, eventId, "p1", pool.REASON_NO_FARMER())
        );
        pool.claimHeld(eventId, "p1");

        // still Held, reason unchanged
        (ReliefPool.PlotStatus status, bytes32 reason) = pool.plotSettlements(eventId, "p1");
        assertEq(uint8(status), uint8(ReliefPool.PlotStatus.Held));
        assertEq(reason, pool.REASON_NO_FARMER());
    }

    function test_claimHeld_revertReasonReflectsCurrentCheckEvenThoughStorageIsUnwound() public {
        _enroll("p1", zoneId, speciesId);
        // no slot -> NO_FARMER at settle time
        bytes32 eventId = _attest(1);
        pool.settle(eventId, _plots("p1"));
        (, bytes32 reasonAtSettle) = pool.plotSettlements(eventId, "p1");
        assertEq(reasonAtSettle, pool.REASON_NO_FARMER());

        // now a farmer exists but is unverified -> the *revert* reports UNVERIFIED (today's failing check)...
        _activeSlot("p1", farmerA);
        vm.expectRevert(
            abi.encodeWithSelector(ReliefPool.StillIneligible.selector, eventId, "p1", pool.REASON_UNVERIFIED())
        );
        pool.claimHeld(eventId, "p1");

        // ...but a revert unwinds every state change from the call, so the stored reason is untouched: it still
        // reflects the reason `settle` originally recorded, not this failed reclaim attempt's reason.
        (, bytes32 reasonAfter) = pool.plotSettlements(eventId, "p1");
        assertEq(reasonAfter, pool.REASON_NO_FARMER());
    }

    function test_claimHeld_revertsIfNotHeld() public {
        _enroll("p1", zoneId, speciesId);
        _bindLevel1(farmerA, nullifierA);
        _activeSlot("p1", farmerA);
        bytes32 eventId = _attest(1);
        pool.settle(eventId, _plots("p1")); // pays directly, never Held

        vm.expectRevert(abi.encodeWithSelector(ReliefPool.NotHeld.selector, eventId, "p1"));
        pool.claimHeld(eventId, "p1");
    }

    function test_claimHeld_revertsAfterWindowElapsed() public {
        _enroll("p1", zoneId, speciesId);
        _activeSlot("p1", farmerA);
        bytes32 eventId = _attest(1);
        pool.settle(eventId, _plots("p1")); // UNVERIFIED hold

        _bindLevel1(farmerA, nullifierA);
        vm.warp(block.timestamp + 90 days + 1); // past claimWindow

        (,,,,,, , uint64 claimDeadline) = pool.attestations(eventId);
        vm.expectRevert(
            abi.encodeWithSelector(ReliefPool.ClaimWindowElapsed.selector, claimDeadline, uint64(block.timestamp))
        );
        pool.claimHeld(eventId, "p1");
    }

    function test_claimHeld_revertsForUnknownEvent() public {
        vm.expectRevert(abi.encodeWithSelector(ReliefPool.UnknownEvent.selector, bytes32(uint256(42))));
        pool.claimHeld(bytes32(uint256(42)), "p1");
    }

    // ---------------------------------------------------------------------
    // sweep
    // ---------------------------------------------------------------------
    function test_sweep_releasesReserveAfterWindowElapses() public {
        _enroll("p1", zoneId, speciesId);
        // no slot -> NO_FARMER, stays Held forever in this test
        bytes32 eventId = _attest(1);
        pool.settle(eventId, _plots("p1"));

        uint256 reservedBefore = pool.reserved();
        uint256 poolBalanceBefore = jpyc.balanceOf(address(pool));

        vm.warp(block.timestamp + 90 days + 1);

        vm.expectEmit(true, false, false, true, address(pool));
        emit IReliefPool.Swept(eventId, "p1", perUnit);

        vm.prank(keeper);
        pool.sweep(eventId, "p1");

        assertEq(pool.reserved(), reservedBefore - perUnit);
        assertEq(jpyc.balanceOf(address(pool)), poolBalanceBefore); // no tokens move on sweep
        (ReliefPool.PlotStatus status,) = pool.plotSettlements(eventId, "p1");
        assertEq(uint8(status), uint8(ReliefPool.PlotStatus.Swept));
    }

    function test_sweep_revertsBeforeWindowElapses() public {
        _enroll("p1", zoneId, speciesId);
        bytes32 eventId = _attest(1);
        pool.settle(eventId, _plots("p1")); // NO_FARMER hold

        (,,,,,, , uint64 claimDeadline) = pool.attestations(eventId);
        vm.expectRevert(
            abi.encodeWithSelector(ReliefPool.ClaimWindowActive.selector, claimDeadline, uint64(block.timestamp))
        );
        pool.sweep(eventId, "p1");
    }

    function test_sweep_revertsIfNotHeld() public {
        _enroll("p1", zoneId, speciesId);
        _bindLevel1(farmerA, nullifierA);
        _activeSlot("p1", farmerA);
        bytes32 eventId = _attest(1);
        pool.settle(eventId, _plots("p1")); // Paid, never Held

        vm.warp(block.timestamp + 90 days + 1);
        vm.expectRevert(abi.encodeWithSelector(ReliefPool.NotHeld.selector, eventId, "p1"));
        pool.sweep(eventId, "p1");
    }

    function test_sweep_revertsForUnknownEvent() public {
        vm.expectRevert(abi.encodeWithSelector(ReliefPool.UnknownEvent.selector, bytes32(uint256(7))));
        pool.sweep(bytes32(uint256(7)), "p1");
    }

    function test_sweep_thenSettleAgainIsStillIdempotentNoOp() public {
        _enroll("p1", zoneId, speciesId);
        bytes32 eventId = _attest(1);
        pool.settle(eventId, _plots("p1")); // NO_FARMER hold
        vm.warp(block.timestamp + 90 days + 1);
        pool.sweep(eventId, "p1");

        uint256 reservedAfterSweep = pool.reserved();
        pool.settle(eventId, _plots("p1")); // Swept is terminal; settle must not touch it again
        (ReliefPool.PlotStatus status,) = pool.plotSettlements(eventId, "p1");
        assertEq(uint8(status), uint8(ReliefPool.PlotStatus.Swept));
        assertEq(pool.reserved(), reservedAfterSweep);
    }

    // ---------------------------------------------------------------------
    // payoutTarget delegates to ISlotResolver
    // ---------------------------------------------------------------------
    function test_payoutTarget_delegatesToSlotResolver() public {
        address plotRegistry = makeAddr("plotRegistry");
        slotResolver.setSlot("p1", seasonLabel, farmerA, plotRegistry, uint64(block.timestamp + 100));

        (address farmer, address registry, uint64 expiry) = pool.payoutTarget("p1", seasonLabel);
        assertEq(farmer, farmerA);
        assertEq(registry, plotRegistry);
        assertEq(expiry, uint64(block.timestamp + 100));
    }

    function test_payoutTarget_returnsZeroForUnknownSlot() public view {
        (address farmer, address registry, uint64 expiry) = pool.payoutTarget("nope", seasonLabel);
        assertEq(farmer, address(0));
        assertEq(registry, address(0));
        assertEq(expiry, 0);
    }

    // ---------------------------------------------------------------------
    // Reserve invariant across a mixed settle/claim/sweep sequence
    // ---------------------------------------------------------------------
    function test_reservedInvariant_afterMixedPaidHeldClaimedSweptSequence() public {
        _enroll("paid", zoneId, speciesId);
        _enroll("claimed", zoneId, speciesId);
        _enroll("swept", zoneId, speciesId);

        _bindLevel1(farmerA, nullifierA);
        _activeSlot("paid", farmerA);
        // "claimed": unverified at settle time, verified before claiming
        address farmerC = makeAddr("farmerC");
        bytes32 nullifierC = keccak256("nullifier-c");
        _activeSlot("claimed", farmerC);
        // "swept": no farmer, ever

        bytes32 eventId = _attest(3);
        (,,,,, uint256 reservedAmount,,) = pool.attestations(eventId);
        assertEq(pool.reserved(), reservedAmount);

        string[] memory batch = new string[](3);
        batch[0] = "paid";
        batch[1] = "claimed";
        batch[2] = "swept";
        pool.settle(eventId, batch);
        // paid -> Paid, claimed -> Held(UNVERIFIED), swept -> Held(NO_FARMER)
        assertEq(pool.reserved(), reservedAmount - perUnit);

        _bindLevel1(farmerC, nullifierC);
        pool.claimHeld(eventId, "claimed");
        assertEq(pool.reserved(), reservedAmount - (2 * perUnit));

        vm.warp(block.timestamp + 90 days + 1);
        pool.sweep(eventId, "swept");
        assertEq(pool.reserved(), reservedAmount - (3 * perUnit));
        assertEq(pool.reserved(), 0);

        (ReliefPool.PlotStatus sPaid,) = pool.plotSettlements(eventId, "paid");
        (ReliefPool.PlotStatus sClaimed,) = pool.plotSettlements(eventId, "claimed");
        (ReliefPool.PlotStatus sSwept,) = pool.plotSettlements(eventId, "swept");
        assertEq(uint8(sPaid), uint8(ReliefPool.PlotStatus.Paid));
        assertEq(uint8(sClaimed), uint8(ReliefPool.PlotStatus.Claimed));
        assertEq(uint8(sSwept), uint8(ReliefPool.PlotStatus.Swept));
    }
}
