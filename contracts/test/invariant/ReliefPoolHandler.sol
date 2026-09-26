// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ReliefPool} from "../../src/ReliefPool.sol";
import {IReliefPool} from "../../src/interfaces/IReliefPool.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import {MockHumanRegistry} from "../mocks/MockHumanRegistry.sol";
import {MockPlotResolver} from "../mocks/MockPlotResolver.sol";
import {MockSlotResolver} from "../mocks/MockSlotResolver.sol";

/// @notice Bounded-random driver for `ReliefPoolInvariant.t.sol`. Exercises attest/settle/claimHeld/sweep/warp
///         across a small fixed universe of plots designed to hit every hold reason (ZONE_MISMATCH, NO_FARMER,
///         PLOT_EXPIRED, UNVERIFIED, CAP) plus straight payouts, then tracks a ghost ledger of every JPYC unit
///         that has left `reserved` (via Paid, Claimed or Swept) so the invariant test can assert
///         `pool.reserved() == totalReservedAtAttest - ghostReservedOut` after arbitrary call sequences.
contract ReliefPoolHandler is Test {
    ReliefPool public immutable pool;
    ERC20Mock internal immutable jpyc;
    MockHumanRegistry internal immutable humans;
    MockPlotResolver internal immutable plotResolver;
    MockSlotResolver internal immutable slotResolver;

    address internal immutable signer1;
    uint256 internal immutable signer1Key;
    address internal immutable signer2;
    uint256 internal immutable signer2Key;

    bytes32 internal immutable zoneId = keccak256(bytes("karakuwa-east"));
    bytes32 internal immutable speciesId = keccak256(bytes("scallop"));
    bytes32 internal immutable perilId = keccak256(bytes("HEAT25"));

    // Fixed plot universe: p0-p3 -> farmerA (level 1, cap 3, so p3 always CAP-holds within an event);
    // p4 -> farmerB (level 2, cap 12); p5 -> enrolled under a different zone (always ZONE_MISMATCH);
    // p6 -> never has a slot set (always NO_FARMER); p7 -> farmerC, never bound (always UNVERIFIED);
    // p8 -> farmerD, bound, but the slot is always set already-expired (always PLOT_EXPIRED).
    string[] internal plotLabels;
    address internal farmerA = address(0xA11CE);
    address internal farmerB = address(0xB0B);
    address internal farmerD = address(0xD00D);
    bytes32 internal nullifierA = keccak256("handler-nullifier-a");
    bytes32 internal nullifierB = keccak256("handler-nullifier-b");
    bytes32 internal nullifierD = keccak256("handler-nullifier-d");

    bytes32[] public eventIds;
    uint256 public totalReservedAtAttest;
    uint256 public ghostReservedOut; // sum of perUnit for every plot that left Held/Unsettled into Paid/Claimed/Swept

    uint256 internal eventCounter;

    constructor(
        ReliefPool pool_,
        ERC20Mock jpyc_,
        MockHumanRegistry humans_,
        MockPlotResolver plotResolver_,
        MockSlotResolver slotResolver_,
        address signer1_,
        uint256 signer1Key_,
        address signer2_,
        uint256 signer2Key_
    ) {
        pool = pool_;
        jpyc = jpyc_;
        humans = humans_;
        plotResolver = plotResolver_;
        slotResolver = slotResolver_;
        signer1 = signer1_;
        signer1Key = signer1Key_;
        signer2 = signer2_;
        signer2Key = signer2Key_;

        plotLabels = ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];

        // p0-p3: zoneId/speciesId, farmerA (level 1)
        for (uint256 i = 0; i < 4; ++i) {
            plotResolver.setPlot(plotLabels[i], zoneId, speciesId);
            pool.enroll(plotLabels[i]);
        }
        // p4: zoneId/speciesId, farmerB (level 2)
        plotResolver.setPlot(plotLabels[4], zoneId, speciesId);
        pool.enroll(plotLabels[4]);
        // p5: a different zone entirely -> always ZONE_MISMATCH against events attested for zoneId/speciesId
        bytes32 otherZone = keccak256(bytes("kesennuma-bay"));
        plotResolver.setPlot(plotLabels[5], otherZone, speciesId);
        pool.enroll(plotLabels[5]);
        // p6: enrolled correctly but never gets a slot -> NO_FARMER
        plotResolver.setPlot(plotLabels[6], zoneId, speciesId);
        pool.enroll(plotLabels[6]);
        // p7: enrolled correctly, farmerC slot set later (per-event) but never bound -> UNVERIFIED
        plotResolver.setPlot(plotLabels[7], zoneId, speciesId);
        pool.enroll(plotLabels[7]);
        // p8: enrolled correctly, farmerD bound, slot always expired -> PLOT_EXPIRED
        plotResolver.setPlot(plotLabels[8], zoneId, speciesId);
        pool.enroll(plotLabels[8]);

        humans.setHuman(farmerA, 1, nullifierA, 11, 500);
        humans.setHuman(farmerB, 2, nullifierB, 1, 500);
        humans.setHuman(farmerD, 1, nullifierD, 11, 500);
    }

    // ---------------------------------------------------------------------
    // Handler actions (all bounded; all wrapped so a legitimate contract revert never halts the fuzzer)
    // ---------------------------------------------------------------------

    function donate(uint256 amount) public {
        amount = bound(amount, 0, 1_000_000e18);
        if (amount == 0) return;
        jpyc.mint(address(this), amount);
        jpyc.approve(address(pool), amount);
        try pool.donate(amount, "") {} catch {}
    }

    /// @dev Attests a brand-new event (fresh seasonLabel => fresh eventId, even reusing zone/species/peril/tier)
    ///      and wires up per-event slot data for the fixed plot universe.
    function attestNext() public {
        // Keep the pool flush so tierAmount, not free balance, is always the pro-rata bound — this makes
        // perUnit a known constant (`unitTierAmount`) rather than something the handler would otherwise have
        // to re-derive from `free / eligibleUnits` after every donate/attest.
        uint256 topUp = 10_000_000e18;
        jpyc.mint(address(this), topUp);
        jpyc.approve(address(pool), topUp);
        try pool.donate(topUp, "") {} catch {}

        string memory season = string(abi.encodePacked("evt-", vm.toString(eventCounter)));
        eventCounter += 1;

        uint64 expiredTs = uint64(block.timestamp) > 0 ? uint64(block.timestamp - 1) : 0;
        uint64 activeExpiry = uint64(block.timestamp) + 365 days;
        slotResolver.setSlot(plotLabels[0], season, farmerA, address(0), activeExpiry);
        slotResolver.setSlot(plotLabels[1], season, farmerA, address(0), activeExpiry);
        slotResolver.setSlot(plotLabels[2], season, farmerA, address(0), activeExpiry);
        slotResolver.setSlot(plotLabels[3], season, farmerA, address(0), activeExpiry);
        slotResolver.setSlot(plotLabels[4], season, farmerB, address(0), activeExpiry);
        // p5: zone-mismatched, no need to set a slot
        // p6: intentionally left with no slot (NO_FARMER)
        slotResolver.setSlot(plotLabels[7], season, address(0xC0FFEE), address(0), activeExpiry); // unbound farmer
        slotResolver.setSlot(plotLabels[8], season, farmerD, address(0), expiredTs); // already expired

        IReliefPool.Trigger memory t;
        t.zoneId = zoneId;
        t.speciesId = speciesId;
        t.perilId = perilId;
        t.tier = 1;
        t.seasonLabel = season;
        t.windowStart = uint64(block.timestamp) > 30 days ? uint64(block.timestamp - 30 days) : 0;
        t.windowEnd = uint64(block.timestamp) > 0 ? uint64(block.timestamp - 1) : 0;
        t.firedAt = t.windowEnd;
        t.index = 1;
        t.threshold = 1;
        t.dataHash = keccak256(abi.encodePacked(season));
        t.deadline = uint64(block.timestamp) + 365 days;

        bytes32 digest = pool.triggerDigest(t);
        bytes[] memory sigs = new bytes[](2);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(signer1Key, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(signer2Key, digest);
        sigs[0] = abi.encodePacked(r1, s1, v1);
        sigs[1] = abi.encodePacked(r2, s2, v2);

        try pool.attest(t, sigs) returns (bytes32 eventId) {
            eventIds.push(eventId);
            (,,,,, uint256 reservedAmount,,) = pool.attestations(eventId);
            totalReservedAtAttest += reservedAmount;
        } catch {}
    }

    function settleSome(uint256 eventSeed, uint256 plotMask) public {
        if (eventIds.length == 0) return;
        bytes32 eventId = eventIds[bound(eventSeed, 0, eventIds.length - 1)];

        // Pick a random non-empty subset of the 9 plots via bitmask.
        plotMask = bound(plotMask, 1, (1 << plotLabels.length) - 1);
        uint256 n = 0;
        for (uint256 i = 0; i < plotLabels.length; ++i) {
            if ((plotMask >> i) & 1 == 1) n++;
        }
        string[] memory batch = new string[](n);
        uint256 j = 0;
        for (uint256 i = 0; i < plotLabels.length; ++i) {
            if ((plotMask >> i) & 1 == 1) {
                batch[j] = plotLabels[i];
                j++;
            }
        }

        uint256 perUnit = _perUnitOf(eventId);
        ReliefPool.PlotStatus[] memory before = new ReliefPool.PlotStatus[](batch.length);
        for (uint256 i = 0; i < batch.length; ++i) {
            (before[i],) = pool.plotSettlements(eventId, batch[i]);
        }

        try pool.settle(eventId, batch) {
            for (uint256 i = 0; i < batch.length; ++i) {
                (ReliefPool.PlotStatus afterStatus,) = pool.plotSettlements(eventId, batch[i]);
                if (before[i] == ReliefPool.PlotStatus.Unsettled && afterStatus == ReliefPool.PlotStatus.Paid) {
                    ghostReservedOut += perUnit;
                }
            }
        } catch {}
    }

    function claimOne(uint256 eventSeed, uint256 plotSeed) public {
        if (eventIds.length == 0) return;
        bytes32 eventId = eventIds[bound(eventSeed, 0, eventIds.length - 1)];
        string memory plotLabel = plotLabels[bound(plotSeed, 0, plotLabels.length - 1)];

        (ReliefPool.PlotStatus statusBefore,) = pool.plotSettlements(eventId, plotLabel);
        if (statusBefore != ReliefPool.PlotStatus.Held) return;

        uint256 perUnit = _perUnitOf(eventId);
        try pool.claimHeld(eventId, plotLabel) {
            ghostReservedOut += perUnit;
        } catch {}
    }

    function sweepOne(uint256 eventSeed, uint256 plotSeed) public {
        if (eventIds.length == 0) return;
        bytes32 eventId = eventIds[bound(eventSeed, 0, eventIds.length - 1)];
        string memory plotLabel = plotLabels[bound(plotSeed, 0, plotLabels.length - 1)];

        (ReliefPool.PlotStatus statusBefore,) = pool.plotSettlements(eventId, plotLabel);
        if (statusBefore != ReliefPool.PlotStatus.Held) return;

        uint256 perUnit = _perUnitOf(eventId);
        try pool.sweep(eventId, plotLabel) {
            ghostReservedOut += perUnit;
        } catch {}
    }

    function warp(uint256 secondsForward) public {
        secondsForward = bound(secondsForward, 1, 120 days);
        vm.warp(block.timestamp + secondsForward);
    }

    // ---------------------------------------------------------------------
    // Ghost-ledger helpers
    // ---------------------------------------------------------------------

    function _perUnitOf(bytes32 eventId) internal view returns (uint256 perUnit) {
        (,,,, perUnit,,,) = pool.attestations(eventId);
    }
}
