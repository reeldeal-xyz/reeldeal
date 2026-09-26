// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {HumanRegistry} from "../src/HumanRegistry.sol";
import {IHumanRegistry} from "../src/interfaces/IHumanRegistry.sol";

contract HumanRegistryTest is Test {
    HumanRegistry registry;

    address admin = makeAddr("admin");
    address binder = makeAddr("binder");
    address other = makeAddr("other");

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    bytes32 nullifierA = keccak256("nullifier-alice");
    bytes32 nullifierB = keccak256("nullifier-bob");

    // Schemas per docs/ARCHITECTURE.md and CLAUDE.md: 11 -> level 1; 1, 9303, 9310 -> level 2.
    uint16 constant SCHEMA_SELFIE = 11;
    uint16 constant SCHEMA_ORB = 1;
    uint16 constant SCHEMA_PASSPORT = 9303;
    uint16 constant SCHEMA_MNC = 9310;

    // Mirrored locally (not read via `registry.BINDER_ROLE()`) so evaluating them inside
    // `abi.encodeWithSelector` never makes a stray external call that would consume a `vm.prank`.
    bytes32 constant BINDER_ROLE = keccak256("BINDER_ROLE");
    bytes32 constant DEFAULT_ADMIN_ROLE = bytes32(0);

    function setUp() public {
        registry = new HumanRegistry(admin, binder);
    }

    // ---------------------------------------------------------------------
    // constructor / roles
    // ---------------------------------------------------------------------

    function test_constructor_grantsRoles() public view {
        assertTrue(registry.hasRole(DEFAULT_ADMIN_ROLE, admin));
        assertTrue(registry.hasRole(BINDER_ROLE, binder));
        assertFalse(registry.hasRole(BINDER_ROLE, admin));
        assertFalse(registry.hasRole(DEFAULT_ADMIN_ROLE, binder));
    }

    function test_constructor_revertsZeroAdmin() public {
        vm.expectRevert(HumanRegistry.ZeroAddress.selector);
        new HumanRegistry(address(0), binder);
    }

    function test_constructor_revertsZeroBinder() public {
        vm.expectRevert(HumanRegistry.ZeroAddress.selector);
        new HumanRegistry(admin, address(0));
    }

    function test_admin_canRotateBinder() public {
        address newBinder = makeAddr("newBinder");

        vm.prank(admin);
        registry.grantRole(BINDER_ROLE, newBinder);
        vm.prank(admin);
        registry.revokeRole(BINDER_ROLE, binder);

        assertTrue(registry.hasRole(BINDER_ROLE, newBinder));
        assertFalse(registry.hasRole(BINDER_ROLE, binder));

        // old binder can no longer bind
        vm.prank(binder);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, binder, BINDER_ROLE
            )
        );
        registry.bind(alice, nullifierA, SCHEMA_SELFIE, 0, uint64(block.timestamp), bytes32("receipt"));

        // new binder can
        vm.prank(newBinder);
        registry.bind(alice, nullifierA, SCHEMA_SELFIE, 0, uint64(block.timestamp), bytes32("receipt"));
        assertEq(registry.levelOf(alice), 1);
    }

    // ---------------------------------------------------------------------
    // bind
    // ---------------------------------------------------------------------

    function test_bind_level1_selfieCheck() public {
        uint64 verifiedAt = uint64(block.timestamp);
        bytes32 receipt = keccak256("receipt-1");

        vm.expectEmit(true, true, false, true, address(registry));
        emit IHumanRegistry.Bound(alice, nullifierA, SCHEMA_SELFIE, 500);

        vm.prank(binder);
        registry.bind(alice, nullifierA, SCHEMA_SELFIE, 500, verifiedAt, receipt);

        assertEq(registry.levelOf(alice), 1);
        assertEq(registry.walletOf(nullifierA), alice);

        IHumanRegistry.Human memory h = registry.humanOf(alice);
        assertEq(h.nullifier, nullifierA);
        assertEq(h.schemaId, SCHEMA_SELFIE);
        assertEq(h.sybilScoreBps, 500);
        assertEq(h.verifiedAt, verifiedAt);
        assertEq(h.receiptHash, receipt);
    }

    function test_bind_level2_orb() public {
        _bind(alice, nullifierA, SCHEMA_ORB);
        assertEq(registry.levelOf(alice), 2);
    }

    function test_bind_level2_passport() public {
        _bind(alice, nullifierA, SCHEMA_PASSPORT);
        assertEq(registry.levelOf(alice), 2);
    }

    /// @dev Issue #4 explicitly calls out schema 9310 (My Number Card) as a uint16 that must map to level 2.
    function test_bind_level2_myNumberCard_uint16() public {
        uint16 schema = SCHEMA_MNC;
        assertEq(schema, 9310);
        _bind(alice, nullifierA, schema);
        assertEq(registry.levelOf(alice), 2);

        IHumanRegistry.Human memory h = registry.humanOf(alice);
        assertEq(h.schemaId, uint16(9310));
    }

    function test_bind_revertsUnknownSchema() public {
        vm.prank(binder);
        vm.expectRevert(abi.encodeWithSelector(IHumanRegistry.UnknownSchema.selector, uint16(7)));
        registry.bind(alice, nullifierA, 7, 0, uint64(block.timestamp), bytes32(0));
    }

    function test_bind_revertsUnknownSchema_zero() public {
        vm.prank(binder);
        vm.expectRevert(abi.encodeWithSelector(IHumanRegistry.UnknownSchema.selector, uint16(0)));
        registry.bind(alice, nullifierA, 0, 0, uint64(block.timestamp), bytes32(0));
    }

    function testFuzz_bind_revertsUnknownSchema(uint16 schemaId) public {
        vm.assume(schemaId != 11 && schemaId != 1 && schemaId != 9303 && schemaId != 9310);
        vm.prank(binder);
        vm.expectRevert(abi.encodeWithSelector(IHumanRegistry.UnknownSchema.selector, schemaId));
        registry.bind(alice, nullifierA, schemaId, 0, uint64(block.timestamp), bytes32(0));
    }

    function test_bind_revertsIfNotBinder() public {
        vm.prank(other);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, other, BINDER_ROLE
            )
        );
        registry.bind(alice, nullifierA, SCHEMA_SELFIE, 0, uint64(block.timestamp), bytes32(0));
    }

    function test_bind_revertsIfAdminNotBinder() public {
        // admin has no implicit binder rights
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, admin, BINDER_ROLE
            )
        );
        registry.bind(alice, nullifierA, SCHEMA_SELFIE, 0, uint64(block.timestamp), bytes32(0));
    }

    function test_bind_revertsZeroWallet() public {
        vm.prank(binder);
        vm.expectRevert(HumanRegistry.ZeroAddress.selector);
        registry.bind(address(0), nullifierA, SCHEMA_SELFIE, 0, uint64(block.timestamp), bytes32(0));
    }

    function test_bind_revertsZeroNullifier() public {
        vm.prank(binder);
        vm.expectRevert(HumanRegistry.ZeroNullifier.selector);
        registry.bind(alice, bytes32(0), SCHEMA_SELFIE, 0, uint64(block.timestamp), bytes32(0));
    }

    /// @dev Replay: the same nullifier cannot be bound to a second wallet.
    function test_bind_revertsNullifierAlreadyBound_replay() public {
        _bind(alice, nullifierA, SCHEMA_SELFIE);

        vm.prank(binder);
        vm.expectRevert(abi.encodeWithSelector(IHumanRegistry.NullifierAlreadyBound.selector, alice));
        registry.bind(bob, nullifierA, SCHEMA_SELFIE, 0, uint64(block.timestamp), bytes32(0));

        // state untouched by the failed replay
        assertEq(registry.walletOf(nullifierA), alice);
        assertEq(registry.levelOf(bob), 0);
    }

    /// @dev A wallet already bound to a nullifier cannot be rebound to a second nullifier via `bind`.
    function test_bind_revertsWalletAlreadyBound() public {
        _bind(alice, nullifierA, SCHEMA_SELFIE);

        vm.prank(binder);
        vm.expectRevert(abi.encodeWithSelector(IHumanRegistry.WalletAlreadyBound.selector, nullifierA));
        registry.bind(alice, nullifierB, SCHEMA_SELFIE, 0, uint64(block.timestamp), bytes32(0));

        assertEq(registry.humanOf(alice).nullifier, nullifierA);
        assertEq(registry.walletOf(nullifierB), address(0));
    }

    function test_bind_revertsSybilScoreTooLow() public {
        vm.prank(admin);
        registry.setMinSybilScoreBps(1000);

        vm.prank(binder);
        vm.expectRevert(abi.encodeWithSelector(IHumanRegistry.SybilScoreTooLow.selector, uint16(999), uint16(1000)));
        registry.bind(alice, nullifierA, SCHEMA_SELFIE, 999, uint64(block.timestamp), bytes32(0));

        // exactly at the floor succeeds
        vm.prank(binder);
        registry.bind(alice, nullifierA, SCHEMA_SELFIE, 1000, uint64(block.timestamp), bytes32(0));
        assertEq(registry.levelOf(alice), 1);
    }

    function test_setMinSybilScoreBps_revertsIfNotAdmin() public {
        vm.prank(other);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, other, DEFAULT_ADMIN_ROLE
            )
        );
        registry.setMinSybilScoreBps(100);
    }

    function test_setMinSybilScoreBps_emitsEvent() public {
        vm.expectEmit(false, false, false, true, address(registry));
        emit HumanRegistry.MinSybilScoreUpdated(0, 250);

        vm.prank(admin);
        registry.setMinSybilScoreBps(250);
        assertEq(registry.minSybilScoreBps(), 250);
    }

    // ---------------------------------------------------------------------
    // upgrade
    // ---------------------------------------------------------------------

    function test_upgrade_level1ToLevel2() public {
        _bind(alice, nullifierA, SCHEMA_SELFIE);
        assertEq(registry.levelOf(alice), 1);

        bytes32 receipt2 = keccak256("receipt-2");
        vm.warp(block.timestamp + 1 days);

        vm.expectEmit(true, true, false, true, address(registry));
        emit IHumanRegistry.Upgraded(alice, nullifierA, SCHEMA_MNC);

        vm.prank(binder);
        registry.upgrade(alice, nullifierA, SCHEMA_MNC, receipt2);

        assertEq(registry.levelOf(alice), 2);
        IHumanRegistry.Human memory h = registry.humanOf(alice);
        assertEq(h.schemaId, SCHEMA_MNC);
        assertEq(h.receiptHash, receipt2);
        assertEq(h.verifiedAt, block.timestamp);
        // sybilScoreBps from the original bind is untouched by upgrade
        assertEq(h.sybilScoreBps, 0);
        // identity stays put
        assertEq(h.nullifier, nullifierA);
        assertEq(registry.walletOf(nullifierA), alice);
    }

    function test_upgrade_refreshesExistingLevel2() public {
        _bind(alice, nullifierA, SCHEMA_ORB);
        assertEq(registry.levelOf(alice), 2);

        bytes32 receipt2 = keccak256("receipt-refresh");
        vm.prank(binder);
        registry.upgrade(alice, nullifierA, SCHEMA_PASSPORT, receipt2);

        assertEq(registry.levelOf(alice), 2);
        assertEq(registry.humanOf(alice).schemaId, SCHEMA_PASSPORT);
        assertEq(registry.humanOf(alice).receiptHash, receipt2);
    }

    function test_upgrade_revertsIfNotBound() public {
        vm.prank(binder);
        vm.expectRevert(
            abi.encodeWithSelector(HumanRegistry.WalletNullifierMismatch.selector, alice, nullifierA)
        );
        registry.upgrade(alice, nullifierA, SCHEMA_ORB, bytes32(0));
    }

    function test_upgrade_revertsOnNullifierMismatch() public {
        _bind(alice, nullifierA, SCHEMA_SELFIE);
        _bind(bob, nullifierB, SCHEMA_SELFIE);

        // alice's wallet with bob's nullifier
        vm.prank(binder);
        vm.expectRevert(
            abi.encodeWithSelector(HumanRegistry.WalletNullifierMismatch.selector, alice, nullifierB)
        );
        registry.upgrade(alice, nullifierB, SCHEMA_ORB, bytes32(0));
    }

    function test_upgrade_revertsZeroWallet() public {
        vm.prank(binder);
        vm.expectRevert(
            abi.encodeWithSelector(HumanRegistry.WalletNullifierMismatch.selector, address(0), bytes32(0))
        );
        registry.upgrade(address(0), bytes32(0), SCHEMA_ORB, bytes32(0));
    }

    function test_upgrade_revertsUnknownSchema_forLevel1Schema() public {
        _bind(alice, nullifierA, SCHEMA_SELFIE);

        // schema 11 is valid for bind but not a level-2 upgrade target
        vm.prank(binder);
        vm.expectRevert(abi.encodeWithSelector(IHumanRegistry.UnknownSchema.selector, SCHEMA_SELFIE));
        registry.upgrade(alice, nullifierA, SCHEMA_SELFIE, bytes32(0));
    }

    function test_upgrade_revertsUnknownSchema_forInvalidSchema() public {
        _bind(alice, nullifierA, SCHEMA_SELFIE);

        vm.prank(binder);
        vm.expectRevert(abi.encodeWithSelector(IHumanRegistry.UnknownSchema.selector, uint16(42)));
        registry.upgrade(alice, nullifierA, 42, bytes32(0));
    }

    function test_upgrade_revertsIfNotBinder() public {
        _bind(alice, nullifierA, SCHEMA_SELFIE);

        vm.prank(other);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, other, BINDER_ROLE
            )
        );
        registry.upgrade(alice, nullifierA, SCHEMA_ORB, bytes32(0));
    }

    // ---------------------------------------------------------------------
    // rebind
    // ---------------------------------------------------------------------

    function test_rebind_movesWalletKeepsIdentity() public {
        _bind(alice, nullifierA, SCHEMA_MNC);
        IHumanRegistry.Human memory before = registry.humanOf(alice);

        vm.expectEmit(true, false, false, true, address(registry));
        emit IHumanRegistry.Rebound(nullifierA, alice, bob);

        vm.prank(admin);
        registry.rebind(nullifierA, bob);

        assertEq(registry.walletOf(nullifierA), bob);
        assertEq(registry.levelOf(bob), 2);
        assertEq(registry.levelOf(alice), 0);

        IHumanRegistry.Human memory afterH = registry.humanOf(bob);
        assertEq(afterH.nullifier, before.nullifier);
        assertEq(afterH.schemaId, before.schemaId);
        assertEq(afterH.sybilScoreBps, before.sybilScoreBps);
        assertEq(afterH.verifiedAt, before.verifiedAt);
        assertEq(afterH.receiptHash, before.receiptHash);

        // old wallet fully cleared
        IHumanRegistry.Human memory cleared = registry.humanOf(alice);
        assertEq(cleared.nullifier, bytes32(0));
    }

    function test_rebind_revertsIfNullifierNotBound() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(HumanRegistry.NullifierNotBound.selector, nullifierA));
        registry.rebind(nullifierA, bob);
    }

    function test_rebind_revertsIfNewWalletAlreadyBound() public {
        _bind(alice, nullifierA, SCHEMA_SELFIE);
        _bind(bob, nullifierB, SCHEMA_SELFIE);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IHumanRegistry.WalletAlreadyBound.selector, nullifierB));
        registry.rebind(nullifierA, bob);

        // nothing changed
        assertEq(registry.walletOf(nullifierA), alice);
        assertEq(registry.walletOf(nullifierB), bob);
    }

    function test_rebind_revertsZeroNewWallet() public {
        _bind(alice, nullifierA, SCHEMA_SELFIE);

        vm.prank(admin);
        vm.expectRevert(HumanRegistry.ZeroAddress.selector);
        registry.rebind(nullifierA, address(0));
    }

    function test_rebind_revertsIfNotAdmin() public {
        _bind(alice, nullifierA, SCHEMA_SELFIE);

        vm.prank(binder);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, binder, DEFAULT_ADMIN_ROLE
            )
        );
        registry.rebind(nullifierA, bob);
    }

    function test_rebind_sameWalletIsNoopButEmits() public {
        _bind(alice, nullifierA, SCHEMA_SELFIE);

        vm.expectEmit(true, false, false, true, address(registry));
        emit IHumanRegistry.Rebound(nullifierA, alice, alice);

        vm.prank(admin);
        registry.rebind(nullifierA, alice);

        assertEq(registry.walletOf(nullifierA), alice);
        assertEq(registry.levelOf(alice), 1);
    }

    function test_rebind_thenOldWalletCanBindFreshIdentity() public {
        _bind(alice, nullifierA, SCHEMA_SELFIE);

        vm.prank(admin);
        registry.rebind(nullifierA, bob);

        // alice is now unbound and can bind a brand new nullifier
        vm.prank(binder);
        registry.bind(alice, nullifierB, SCHEMA_ORB, 0, uint64(block.timestamp), bytes32(0));
        assertEq(registry.levelOf(alice), 2);
        assertEq(registry.walletOf(nullifierB), alice);
    }

    // ---------------------------------------------------------------------
    // views on unbound state
    // ---------------------------------------------------------------------

    function test_views_defaultForUnboundWallet() public view {
        assertEq(registry.levelOf(carol), 0);
        assertEq(registry.walletOf(keccak256("never-bound")), address(0));

        IHumanRegistry.Human memory h = registry.humanOf(carol);
        assertEq(h.nullifier, bytes32(0));
        assertEq(h.schemaId, 0);
        assertEq(h.sybilScoreBps, 0);
        assertEq(h.verifiedAt, 0);
        assertEq(h.receiptHash, bytes32(0));
    }

    // ---------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------

    function _bind(address wallet, bytes32 nullifier, uint16 schemaId) internal {
        vm.prank(binder);
        registry.bind(wallet, nullifier, schemaId, 0, uint64(block.timestamp), bytes32(0));
    }
}
