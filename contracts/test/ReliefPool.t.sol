// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ReliefPool} from "../src/ReliefPool.sol";
import {IReliefPool} from "../src/interfaces/IReliefPool.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import {MockHumanRegistry} from "./mocks/MockHumanRegistry.sol";
import {MockPlotResolver} from "./mocks/MockPlotResolver.sol";
import {MockSlotResolver} from "./mocks/MockSlotResolver.sol";

/// @notice ReliefPool core: donate, enroll/reindex, attest (2-of-3 EIP-712) + pro-rata reserve snapshot.
///         settle/claimHeld/sweep/payoutTarget behavior lives in ReliefPoolSettle.t.sol (issue #8); the real
///         ENSv2 slot walk behind ISlotResolver is issue #11.
contract ReliefPoolTest is Test {
    ERC20Mock internal jpyc;
    MockHumanRegistry internal humans;
    MockPlotResolver internal resolver;
    MockSlotResolver internal slotResolver;
    ReliefPool internal pool;

    address internal admin = makeAddr("admin");
    address internal donor = makeAddr("donor");

    address internal signer1;
    uint256 internal signer1Key;
    address internal signer2;
    uint256 internal signer2Key;
    address internal signer3;
    uint256 internal signer3Key;
    address internal outsider;
    uint256 internal outsiderKey;

    bytes32 internal zoneId = keccak256(bytes("karakuwa-east"));
    bytes32 internal speciesId = keccak256(bytes("scallop"));
    bytes32 internal perilId = keccak256(bytes("HEAT25"));

    function setUp() public {
        vm.warp(1_700_000_000); // fixed, comfortably > 30 days so _trigger()'s window math never underflows

        jpyc = new ERC20Mock();
        humans = new MockHumanRegistry();
        resolver = new MockPlotResolver();
        slotResolver = new MockSlotResolver();
        pool = new ReliefPool(IERC20(address(jpyc)), humans, resolver, slotResolver, admin);

        (signer1, signer1Key) = makeAddrAndKey("signer1");
        (signer2, signer2Key) = makeAddrAndKey("signer2");
        (signer3, signer3Key) = makeAddrAndKey("signer3");
        (outsider, outsiderKey) = makeAddrAndKey("outsider");

        address[] memory sset = new address[](3);
        sset[0] = signer1;
        sset[1] = signer2;
        sset[2] = signer3;
        vm.prank(admin);
        pool.setSigners(sset, 2);

        vm.prank(admin);
        pool.setTierAmount(perilId, speciesId, 1, 20_000e18);

        jpyc.mint(donor, 1_000_000e18);
        vm.prank(donor);
        jpyc.approve(address(pool), type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    function _enroll(string memory plotLabel, bytes32 zId, bytes32 spId) internal {
        resolver.setPlot(plotLabel, zId, spId);
        pool.enroll(plotLabel);
    }

    function _seedThreeUnitsAndFunds() internal {
        _enroll("p1213-017", zoneId, speciesId);
        _enroll("p1213-018", zoneId, speciesId);
        _enroll("p1213-019", zoneId, speciesId);
        vm.prank(donor);
        pool.donate(90_000e18, "");
    }

    function _trigger(uint32 index_, uint64 deadline_) internal view returns (IReliefPool.Trigger memory t) {
        t.zoneId = zoneId;
        t.speciesId = speciesId;
        t.perilId = perilId;
        t.tier = 1;
        t.seasonLabel = "2026";
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

    // ---------------------------------------------------------------------
    // EIP-712 domain
    // ---------------------------------------------------------------------
    function test_eip712Domain_matchesSharedContract() public view {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            pool.eip712Domain();
        assertEq(name, "ReliefPool");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(pool));
    }

    // ---------------------------------------------------------------------
    // donate
    // ---------------------------------------------------------------------
    function test_donate_transfersJpycAndEmits() public {
        vm.expectEmit(false, false, false, true, address(pool));
        emit IReliefPool.Donated(donor, 20_000e18, "for scallops");

        vm.prank(donor);
        pool.donate(20_000e18, "for scallops");

        assertEq(jpyc.balanceOf(address(pool)), 20_000e18);
        assertEq(jpyc.balanceOf(donor), 1_000_000e18 - 20_000e18);
    }

    function test_donate_revertsOnZeroAmount() public {
        vm.prank(donor);
        vm.expectRevert(ReliefPool.ZeroAmount.selector);
        pool.donate(0, "");
    }

    function test_donate_revertsWithoutAllowance() public {
        address stingy = makeAddr("stingy");
        jpyc.mint(stingy, 100e18);
        vm.prank(stingy);
        vm.expectRevert();
        pool.donate(100e18, "");
    }

    // ---------------------------------------------------------------------
    // enroll / reindex
    // ---------------------------------------------------------------------
    function test_enroll_cachesZoneSpeciesAndCountsUnit() public {
        resolver.setPlot("p1213-017", zoneId, speciesId);

        vm.expectEmit(false, false, false, true, address(pool));
        emit IReliefPool.Enrolled("p1213-017", zoneId, speciesId);
        pool.enroll("p1213-017");

        (bytes32 z, bytes32 s, bool enrolled) = pool.plots("p1213-017");
        assertEq(z, zoneId);
        assertEq(s, speciesId);
        assertTrue(enrolled);
        assertEq(pool.unitsByZoneSpecies(zoneId, speciesId), 1);
    }

    function test_enroll_revertsForUnknownPlot() public {
        vm.expectRevert(abi.encodeWithSelector(ReliefPool.UnknownPlot.selector, "ghost"));
        pool.enroll("ghost");
    }

    function test_reindex_revertsIfNotEnrolled() public {
        vm.expectRevert(abi.encodeWithSelector(ReliefPool.PlotNotEnrolled.selector, "p1213-017"));
        pool.reindex("p1213-017");
    }

    function test_reindex_movesUnitBetweenZoneSpeciesPairs() public {
        _enroll("p1213-017", zoneId, speciesId);
        assertEq(pool.unitsByZoneSpecies(zoneId, speciesId), 1);

        bytes32 hoyaId = keccak256(bytes("hoya"));
        resolver.setPlot("p1213-017", zoneId, hoyaId);
        pool.reindex("p1213-017");

        assertEq(pool.unitsByZoneSpecies(zoneId, speciesId), 0);
        assertEq(pool.unitsByZoneSpecies(zoneId, hoyaId), 1);
    }

    function test_enroll_isIdempotentForUnchangedPlot() public {
        _enroll("p1213-017", zoneId, speciesId);
        pool.enroll("p1213-017"); // re-enroll, same zone/species
        assertEq(pool.unitsByZoneSpecies(zoneId, speciesId), 1);
    }

    // ---------------------------------------------------------------------
    // Admin: signers
    // ---------------------------------------------------------------------
    function test_setSigners_onlyAdmin() public {
        address[] memory s = new address[](1);
        s[0] = signer1;
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), bytes32(0))
        );
        pool.setSigners(s, 1);
    }

    function test_setSigners_rejectsBadThreshold() public {
        address[] memory s = new address[](2);
        s[0] = signer1;
        s[1] = signer2;

        vm.startPrank(admin);
        vm.expectRevert(ReliefPool.InvalidSignerConfig.selector);
        pool.setSigners(s, 0);

        vm.expectRevert(ReliefPool.InvalidSignerConfig.selector);
        pool.setSigners(s, 3);
        vm.stopPrank();
    }

    function test_setSigners_rejectsDuplicateOrZeroAddress() public {
        address[] memory dup = new address[](2);
        dup[0] = signer1;
        dup[1] = signer1;
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ReliefPool.DuplicateSigner.selector, signer1));
        pool.setSigners(dup, 2);

        address[] memory zero = new address[](1);
        zero[0] = address(0);
        vm.prank(admin);
        vm.expectRevert(ReliefPool.ZeroAddress.selector);
        pool.setSigners(zero, 1);
    }

    function test_setSigners_replacesOldSet() public {
        address newSigner = makeAddr("newSigner");
        address[] memory s = new address[](1);
        s[0] = newSigner;
        vm.prank(admin);
        pool.setSigners(s, 1);

        assertFalse(pool.isSigner(signer1));
        assertTrue(pool.isSigner(newSigner));
        assertEq(pool.signersCount(), 1);
        assertEq(pool.signerThreshold(), 1);
    }

    // ---------------------------------------------------------------------
    // Admin: tier amounts, unit caps, claim window
    // ---------------------------------------------------------------------
    function test_setTierAmount_onlyAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), bytes32(0))
        );
        pool.setTierAmount(perilId, speciesId, 1, 1);
    }

    function test_unitCap_defaultsAndAdminOverride() public {
        assertEq(pool.unitCap(1), 3);
        assertEq(pool.unitCap(2), 12);

        vm.prank(admin);
        pool.setUnitCap(1, 5);
        assertEq(pool.unitCap(1), 5);
    }

    function test_unitCap_onlyAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), bytes32(0))
        );
        pool.setUnitCap(1, 5);
    }

    function test_claimWindow_defaultAndAdminOverride() public {
        assertEq(pool.claimWindow(), 90 days);

        vm.prank(admin);
        pool.setClaimWindow(30 days);
        assertEq(pool.claimWindow(), 30 days);
    }

    // ---------------------------------------------------------------------
    // attest: happy path (signs in Solidity via vm.sign, verifies 2-of-3)
    // ---------------------------------------------------------------------
    function test_attest_signsInSolidityAndVerifiesTwoOfThree() public {
        _seedThreeUnitsAndFunds();

        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        bytes[] memory sigs = _sign2of3(t);
        bytes32 eventId = pool.eventIdOf(t);

        address[] memory expectedSigners = new address[](2);
        expectedSigners[0] = signer1;
        expectedSigners[1] = signer2;

        vm.expectEmit(true, false, false, true, address(pool));
        emit IReliefPool.Attested(eventId, t, 3, 20_000e18, expectedSigners);

        bytes32 returnedId = pool.attest(t, sigs);
        assertEq(returnedId, eventId);

        (
            bytes32 aZoneId,
            bytes32 aSpeciesId,
            string memory aSeasonLabel,
            uint32 eligibleUnits,
            uint256 perUnit,
            uint256 reservedAmount,
            uint64 attestedAt,
            uint64 claimDeadline
        ) = pool.attestations(eventId);
        assertEq(aZoneId, zoneId);
        assertEq(aSpeciesId, speciesId);
        assertEq(aSeasonLabel, "2026");
        assertEq(eligibleUnits, 3);
        assertEq(perUnit, 20_000e18); // min(tierAmount=20000e18, free/eligible=30000e18)
        assertEq(reservedAmount, 60_000e18);
        assertEq(attestedAt, block.timestamp);
        assertEq(claimDeadline, block.timestamp + 90 days);
        assertEq(pool.reserved(), 60_000e18);
    }

    function test_attest_acceptsAllThreeSignersNotJustFirstTwo() public {
        _seedThreeUnitsAndFunds();
        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(signer2Key, t);
        sigs[1] = _sign(signer3Key, t);
        pool.attest(t, sigs);
        assertEq(pool.reserved(), 60_000e18);
    }

    // ---------------------------------------------------------------------
    // attest: replay protection
    // ---------------------------------------------------------------------
    function test_attest_revertsOnReplay() public {
        _seedThreeUnitsAndFunds();
        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        bytes[] memory sigs = _sign2of3(t);
        pool.attest(t, sigs);

        vm.expectRevert(abi.encodeWithSelector(IReliefPool.AlreadyAttested.selector, pool.eventIdOf(t)));
        pool.attest(t, sigs);
    }

    // ---------------------------------------------------------------------
    // attest: bad signatures
    // ---------------------------------------------------------------------
    function test_attest_revertsOnUnregisteredSigner() public {
        _seedThreeUnitsAndFunds();
        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(signer1Key, t);
        sigs[1] = _sign(outsiderKey, t);

        vm.expectRevert(IReliefPool.BadSignatures.selector);
        pool.attest(t, sigs);
    }

    function test_attest_revertsOnDuplicateSigner() public {
        _seedThreeUnitsAndFunds();
        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(signer1Key, t);
        sigs[1] = _sign(signer1Key, t);

        vm.expectRevert(IReliefPool.BadSignatures.selector);
        pool.attest(t, sigs);
    }

    function test_attest_revertsBelowThresholdSignatureCount() public {
        _seedThreeUnitsAndFunds();
        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(signer1Key, t);

        vm.expectRevert(IReliefPool.BadSignatures.selector);
        pool.attest(t, sigs);
    }

    function test_attest_revertsWhenSignersNotConfigured() public {
        ReliefPool freshPool = new ReliefPool(IERC20(address(jpyc)), humans, resolver, slotResolver, admin);
        resolver.setPlot("p1213-017", zoneId, speciesId);
        freshPool.enroll("p1213-017");
        vm.prank(admin);
        freshPool.setTierAmount(perilId, speciesId, 1, 1e18);
        jpyc.mint(address(freshPool), 100e18);

        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        bytes32 digest = freshPool.triggerDigest(t);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signer1Key, digest);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = abi.encodePacked(r, s, v);

        vm.expectRevert(IReliefPool.BadSignatures.selector);
        freshPool.attest(t, sigs);
    }

    function test_attest_revertsOnTamperedTriggerAfterSigning() public {
        _seedThreeUnitsAndFunds();
        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        bytes[] memory sigs = _sign2of3(t);
        t.dataHash = keccak256("tampered"); // digest no longer matches the signatures

        vm.expectRevert(IReliefPool.BadSignatures.selector);
        pool.attest(t, sigs);
    }

    // ---------------------------------------------------------------------
    // attest: threshold / deadline / window checks
    // ---------------------------------------------------------------------
    function test_attest_revertsWhenIndexBelowThreshold() public {
        _seedThreeUnitsAndFunds();
        IReliefPool.Trigger memory t = _trigger(10, uint64(block.timestamp + 1 days));
        bytes[] memory sigs = _sign2of3(t);

        vm.expectRevert(abi.encodeWithSelector(IReliefPool.ThresholdNotMet.selector, uint32(10), uint32(14)));
        pool.attest(t, sigs);
    }

    function test_attest_revertsWhenDeadlinePassed() public {
        _seedThreeUnitsAndFunds();
        uint64 deadline = uint64(block.timestamp + 1);
        IReliefPool.Trigger memory t = _trigger(20, deadline);
        bytes[] memory sigs = _sign2of3(t);

        vm.warp(block.timestamp + 2);
        vm.expectRevert(IReliefPool.Expired.selector);
        pool.attest(t, sigs);
    }

    function test_attest_revertsWhenWindowNotElapsed() public {
        _seedThreeUnitsAndFunds();
        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        t.windowEnd = uint64(block.timestamp + 1 hours);
        bytes[] memory sigs = _sign2of3(t);

        vm.expectRevert(abi.encodeWithSelector(ReliefPool.WindowNotElapsed.selector, t.windowEnd, uint64(block.timestamp)));
        pool.attest(t, sigs);
    }

    // ---------------------------------------------------------------------
    // attest: eligibility / tier amount guards
    // ---------------------------------------------------------------------
    function test_attest_revertsWhenNoEligibleUnits() public {
        vm.prank(donor);
        pool.donate(90_000e18, "");
        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        bytes[] memory sigs = _sign2of3(t);

        vm.expectRevert(abi.encodeWithSelector(ReliefPool.NoEligibleUnits.selector, zoneId, speciesId));
        pool.attest(t, sigs);
    }

    function test_attest_revertsWhenTierAmountNotSet() public {
        _enroll("p1213-017", zoneId, speciesId);
        vm.prank(donor);
        pool.donate(90_000e18, "");

        bytes32 otherPeril = keccak256(bytes("HEAT26"));
        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        t.perilId = otherPeril;
        bytes[] memory sigs = _sign2of3(t);

        vm.expectRevert(abi.encodeWithSelector(ReliefPool.TierAmountNotSet.selector, otherPeril, speciesId, uint8(1)));
        pool.attest(t, sigs);
    }

    // ---------------------------------------------------------------------
    // attest: pro-rata snapshot, exact JPYC amounts
    // ---------------------------------------------------------------------
    function test_attest_proRata_cappedByTierAmount() public {
        _enroll("p1213-017", zoneId, speciesId);
        _enroll("p1213-018", zoneId, speciesId);
        _enroll("p1213-019", zoneId, speciesId);

        vm.prank(admin);
        pool.setTierAmount(perilId, speciesId, 1, 15_000e18);

        vm.prank(donor);
        pool.donate(1_000_000e18, "");

        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        pool.attest(t, _sign2of3(t));

        (,,,, uint256 perUnit, uint256 reservedAmount,,) = pool.attestations(pool.eventIdOf(t));
        assertEq(perUnit, 15_000e18);
        assertEq(reservedAmount, 45_000e18);
        assertEq(pool.reserved(), 45_000e18);
    }

    function test_attest_proRata_cappedByFreeBalance() public {
        _enroll("p1213-017", zoneId, speciesId);
        _enroll("p1213-018", zoneId, speciesId);
        _enroll("p1213-019", zoneId, speciesId);

        vm.prank(admin);
        pool.setTierAmount(perilId, speciesId, 1, 50_000e18);

        vm.prank(donor);
        pool.donate(60_000e18, ""); // exactly 20000e18 per unit across 3 units

        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        pool.attest(t, _sign2of3(t));

        (,,,, uint256 perUnit, uint256 reservedAmount,,) = pool.attestations(pool.eventIdOf(t));
        assertEq(perUnit, 20_000e18);
        assertEq(reservedAmount, 60_000e18);
    }

    function test_attest_proRata_flooredDivision() public {
        // 3 units, 100000e18 free -> free/eligible = 33333.33...e18, floored to 33333333333333333333333 wei/unit.
        _enroll("p1213-017", zoneId, speciesId);
        _enroll("p1213-018", zoneId, speciesId);
        _enroll("p1213-019", zoneId, speciesId);

        vm.prank(admin);
        pool.setTierAmount(perilId, speciesId, 1, 1_000_000e18); // never the binding constraint

        vm.prank(donor);
        pool.donate(100_000e18, "");

        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        pool.attest(t, _sign2of3(t));

        uint256 expectedPerUnit = uint256(100_000e18) / 3;
        (,,,, uint256 perUnit, uint256 reservedAmount,,) = pool.attestations(pool.eventIdOf(t));
        assertEq(perUnit, expectedPerUnit);
        assertEq(reservedAmount, expectedPerUnit * 3);
        assertLe(reservedAmount, 100_000e18); // reserve never exceeds the pool's balance
    }

    function test_attest_reservedAccumulatesAndShrinksFreeBalanceAcrossEvents() public {
        _enroll("p1213-017", zoneId, speciesId); // 1 unit for (zoneId, speciesId)

        bytes32 tier2Peril = keccak256(bytes("HEAT26"));
        vm.startPrank(admin);
        pool.setTierAmount(perilId, speciesId, 1, 20_000e18);
        pool.setTierAmount(tier2Peril, speciesId, 2, 50_000e18);
        vm.stopPrank();

        vm.prank(donor);
        pool.donate(30_000e18, "");

        IReliefPool.Trigger memory t1 = _trigger(20, uint64(block.timestamp + 1 days));
        pool.attest(t1, _sign2of3(t1)); // reserves min(20000e18, 30000e18/1) * 1 = 20000e18

        IReliefPool.Trigger memory t2 = _trigger(20, uint64(block.timestamp + 1 days));
        t2.perilId = tier2Peril;
        t2.tier = 2;
        t2.threshold = 12;
        pool.attest(t2, _sign2of3(t2)); // free = 30000e18 - 20000e18 = 10000e18 -> perUnit = min(50000e18, 10000e18)

        (,,,, uint256 perUnit2, uint256 reservedAmount2,,) = pool.attestations(pool.eventIdOf(t2));
        assertEq(perUnit2, 10_000e18);
        assertEq(reservedAmount2, 10_000e18);
        assertEq(pool.reserved(), 30_000e18);
    }
}
