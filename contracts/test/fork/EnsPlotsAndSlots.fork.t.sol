// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IEnsV2Registry, EnsRegistrationState} from "../../src/interfaces/IEnsV2.sol";
import {
    Grant,
    IMintableERC20,
    IEthRegistrarV2,
    IUserRegistryWrite,
    IEACGrantInitializable,
    IPermissionedResolverInitializable,
    IPermissionedResolverWrite,
    IVerifiableFactory,
    RegistryRoles,
    ResolverRoles
} from "../../script/ens/EnsV2.sol";
import {EnsV2Sepolia} from "../../script/ens/EnsV2Addresses.sol";

/// @dev Matches `IPermissionedRegistry`'s errors/functions exactly (ensdomains/contracts-v2 @
///      71a3b7339dbc55ab47667abdfe8303bac4f4c24e, contracts/src/registry/interfaces/IPermissionedRegistry.sol,
///      contracts/src/registry/interfaces/IUnsafeTransferable.sol) -- declared locally only so this test can
///      reference them without pulling in the whole interface tree.
interface IPermissionedRegistryErrors {
    /// @notice Fires for a *safe* transfer (`safeTransferFrom`) whenever the registry still has any
    ///         `RegistryRolesLib.UNEMANCIPATED_ROLE_BITMAP` role assigned at `ROOT_RESOURCE` -- which every
    ///         plot registry here does (the holder holds root `ROLE_UNREGISTER`). This is issue #10's
    ///         non-transferability's *first* line of defense: the standard ERC1155 transfer path any
    ///         wallet/marketplace would call is blocked before the per-token role check below is even
    ///         reached.
    error TransferUnsafeUntilRegistryIsEmancipated();

    /// @notice Fires for an *unsafe* transfer (`unsafeTransfer`, which skips the emancipation guard above)
    ///         when the token owner (`from`) lacks `RegistryRolesLib.ROLE_CAN_TRANSFER_ADMIN` -- which the
    ///         farmer never holds, since the season slot is issued with `roleBitmap 0`. This is the root
    ///         cause `EnsSlotResolver.sol`'s NatSpec documents, and holds even for the unsafe path.
    error TransferDisallowed(uint256 tokenId, address from);
}

/// @dev `IUnsafeTransferable` (same commit) -- an escape hatch transfer path that skips the ERC1155
///      "safe"/emancipation guard but still enforces `ROLE_CAN_TRANSFER_ADMIN`.
interface IUnsafeTransferable {
    function unsafeTransfer(address to, uint256 tokenId, bytes calldata data) external;
}

/// @notice Fork test for issue #10: per-plot ENSv2 registry + an expiring, non-transferable "2026" season
///         slot, registered under the karakuwa branch (issue #7) on real ENSv2 Sepolia.
///
///         Networked and gated behind `RUN_FORK_TESTS=true`, exactly like `EnsBranch.fork.t.sol`:
///           RUN_FORK_TESTS=true forge test --match-contract EnsPlotsAndSlotsForkTest -vvv \
///             --fork-url $SEPOLIA_RPC_URL
contract EnsPlotsAndSlotsForkTest is Test {
    bool internal RUN_FORK;

    string internal parentLabel;
    string internal constant BRANCH_LABEL = "karakuwa";
    string internal constant PLOT_LABEL = "p1213-001";
    string internal constant SEASON_LABEL = "2026";
    uint64 internal constant REGISTRATION_DURATION = 365 days;
    uint64 internal constant PLOT_LICENCE_DURATION = 3650 days;
    uint64 internal SEASON_SLOT_EXPIRY;

    address internal deployer;
    address internal holder;
    address internal farmer;
    address internal stranger;

    IEthRegistrarV2 internal registrar;
    IMintableERC20 internal usdc;
    IVerifiableFactory internal factory;

    address internal karakuwaRegistry;
    address internal karakuwaResolver;
    address internal plotRegistry;

    modifier onlyFork() {
        if (!RUN_FORK) {
            return;
        }
        _;
    }

    function setUp() public {
        RUN_FORK = vm.envOr("RUN_FORK_TESTS", false);
        if (!RUN_FORK) {
            return;
        }

        vm.createSelectFork(vm.envOr("SEPOLIA_RPC_URL", string("https://ethereum-sepolia-rpc.publicnode.com")));

        parentLabel = string.concat("eth-global-tokyo-issue10-fork-", vm.toString(block.number));

        deployer = makeAddr("plots-fork-deployer");
        holder = makeAddr("plots-fork-holder");
        farmer = makeAddr("plots-fork-farmer");
        stranger = makeAddr("plots-fork-stranger");
        vm.deal(deployer, 10 ether);
        vm.deal(holder, 1 ether);

        registrar = IEthRegistrarV2(vm.envOr("ENS_ETH_REGISTRAR", EnsV2Sepolia.ETH_REGISTRAR));
        usdc = IMintableERC20(vm.envOr("ENS_MOCK_USDC", EnsV2Sepolia.MOCK_USDC));
        factory = IVerifiableFactory(vm.envOr("ENS_VERIFIABLE_FACTORY", EnsV2Sepolia.VERIFIABLE_FACTORY));

        _registerParentBranchPlotAndSlot();
    }

    // ------------------------------------------------------------------
    // Setup: parent.eth + karakuwa branch (mirrors EnsBranch.fork.t.sol) + one plot + its "2026" slot.
    // ------------------------------------------------------------------
    function _registerParentBranchPlotAndSlot() internal {
        Grant[] memory parentGrants = new Grant[](1);
        parentGrants[0] =
            Grant({account: deployer, roleBitmap: RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_REGISTRAR_ADMIN});

        vm.startPrank(deployer);
        address parentRegistry = factory.deployProxy(
            vm.envOr("ENS_USER_REGISTRY_IMPL", EnsV2Sepolia.USER_REGISTRY_IMPL),
            uint256(keccak256(abi.encodePacked(parentLabel, "parent-registry"))),
            abi.encodeCall(IEACGrantInitializable.initialize, (parentGrants))
        );
        vm.stopPrank();

        bytes32 secret = keccak256("eth-global-tokyo-issue10-fork-test");
        bytes32 commitment = registrar.makeCommitment(
            parentLabel, deployer, secret, parentRegistry, address(0), REGISTRATION_DURATION, bytes32(0)
        );

        vm.prank(deployer);
        registrar.commit(commitment);
        vm.warp(block.timestamp + registrar.MIN_COMMITMENT_AGE() + 1);
        SEASON_SLOT_EXPIRY = uint64(block.timestamp) + 180 days;

        (uint256 base, uint256 premium) = registrar.getRegisterPrice(parentLabel, REGISTRATION_DURATION, address(usdc));
        uint256 cost = base + premium;

        vm.startPrank(deployer);
        usdc.mint(deployer, cost);
        usdc.approve(address(registrar), cost);
        registrar.register(
            parentLabel, deployer, secret, parentRegistry, address(0), REGISTRATION_DURATION, address(usdc), bytes32(0)
        );

        Grant[] memory registryGrants = new Grant[](1);
        registryGrants[0] =
            Grant({account: deployer, roleBitmap: RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_REGISTRAR_ADMIN});
        Grant[] memory resolverGrants = new Grant[](1);
        resolverGrants[0] = Grant({
            account: deployer,
            roleBitmap: ResolverRoles.ROLE_SET_TEXT_ADMIN | ResolverRoles.ROLE_SET_TEXT
        });

        karakuwaRegistry = factory.deployProxy(
            vm.envOr("ENS_USER_REGISTRY_IMPL", EnsV2Sepolia.USER_REGISTRY_IMPL),
            uint256(keccak256(abi.encodePacked(parentLabel, BRANCH_LABEL, "registry"))),
            abi.encodeCall(IEACGrantInitializable.initialize, (registryGrants))
        );
        karakuwaResolver = factory.deployProxy(
            vm.envOr("ENS_PERMISSIONED_RESOLVER_IMPL", EnsV2Sepolia.PERMISSIONED_RESOLVER_IMPL),
            uint256(keccak256(abi.encodePacked(parentLabel, BRANCH_LABEL, "resolver"))),
            abi.encodeCall(IPermissionedResolverInitializable.initialize, (resolverGrants, new bytes[](0)))
        );
        IUserRegistryWrite(parentRegistry).register(
            BRANCH_LABEL,
            deployer,
            karakuwaRegistry,
            karakuwaResolver,
            RegistryRoles.REGISTRATION_ROLE_BITMAP,
            uint64(block.timestamp) + REGISTRATION_DURATION
        );
        vm.stopPrank();

        // Per-plot registry: holder gets REGISTRAR | UNREGISTER | RENEW on ROOT_RESOURCE (issue #10).
        Grant[] memory plotGrants = new Grant[](1);
        plotGrants[0] = Grant({
            account: holder,
            roleBitmap: RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_UNREGISTER | RegistryRoles.ROLE_RENEW
        });

        vm.startPrank(deployer);
        plotRegistry = factory.deployProxy(
            vm.envOr("ENS_USER_REGISTRY_IMPL", EnsV2Sepolia.USER_REGISTRY_IMPL),
            uint256(keccak256(abi.encodePacked(parentLabel, PLOT_LABEL, "registry"))),
            abi.encodeCall(IEACGrantInitializable.initialize, (plotGrants))
        );
        IUserRegistryWrite(karakuwaRegistry).register(
            PLOT_LABEL, holder, plotRegistry, karakuwaResolver, 0, uint64(block.timestamp) + PLOT_LICENCE_DURATION
        );
        vm.stopPrank();

        // Season slot: holder issues "2026" to farmer, roleBitmap 0 (non-transferable, no self-unregister).
        vm.prank(holder);
        IUserRegistryWrite(plotRegistry).register(SEASON_LABEL, farmer, address(0), address(0), 0, SEASON_SLOT_EXPIRY);
    }

    function _labelId(string memory label) internal pure returns (uint256) {
        return uint256(keccak256(bytes(label)));
    }

    // ------------------------------------------------------------------
    // Tests
    // ------------------------------------------------------------------

    /// @notice The plot is wired under karakuwa, and the season slot resolves to the farmer with the
    ///         expected expiry.
    function test_plotAndSlotAreWired() public view onlyFork {
        assertEq(IEnsV2Registry(karakuwaRegistry).getSubregistry(PLOT_LABEL), plotRegistry, "plot subregistry mismatch");
        assertEq(IEnsV2Registry(karakuwaRegistry).getResolver(PLOT_LABEL), karakuwaResolver, "plot resolver mismatch");

        assertEq(IEnsV2Registry(plotRegistry).findOwner(SEASON_LABEL), farmer, "season slot owner mismatch");
        assertEq(IEnsV2Registry(plotRegistry).findExpiry(SEASON_LABEL), SEASON_SLOT_EXPIRY, "season slot expiry mismatch");
    }

    /// @notice The season slot is non-transferable via the standard ERC1155 path: the farmer's own
    ///         `safeTransferFrom` reverts `TransferUnsafeUntilRegistryIsEmancipated` -- the plot registry
    ///         still has root-level `RegistryRolesLib.UNEMANCIPATED_ROLE_BITMAP` roles assigned (the holder's
    ///         `ROLE_UNREGISTER`), so it can never satisfy ERC1155's "safe" transfer guard.
    function test_seasonSlotTransferReverts() public onlyFork {
        uint256 tokenId = IUserRegistryWrite(plotRegistry).findTokenId(SEASON_LABEL);
        assertEq(IERC1155(plotRegistry).balanceOf(farmer, tokenId), 1, "farmer should hold the slot token");

        vm.prank(farmer);
        vm.expectRevert(IPermissionedRegistryErrors.TransferUnsafeUntilRegistryIsEmancipated.selector);
        IERC1155(plotRegistry).safeTransferFrom(farmer, stranger, tokenId, 1, "");
    }

    /// @notice Even the `unsafeTransfer` escape hatch -- which skips the emancipation guard above -- still
    ///         reverts `TransferDisallowed`, because roleBitmap 0 at issuance means the farmer never holds
    ///         `RegistryRolesLib.ROLE_CAN_TRANSFER_ADMIN`. Two independent reasons the slot can't move.
    function test_seasonSlotUnsafeTransferAlsoReverts() public onlyFork {
        uint256 tokenId = IUserRegistryWrite(plotRegistry).findTokenId(SEASON_LABEL);

        vm.prank(farmer);
        vm.expectRevert(
            abi.encodeWithSelector(IPermissionedRegistryErrors.TransferDisallowed.selector, tokenId, farmer)
        );
        IUnsafeTransferable(plotRegistry).unsafeTransfer(stranger, tokenId, "");
    }

    /// @notice The plot holder can revoke the farmer's slot via `unregister`, even though the farmer (not
    ///         the holder) is the token's nominal owner -- `ROLE_UNREGISTER` on the plot registry's
    ///         `ROOT_RESOURCE` is effective on every resource in that registry. After unregistering,
    ///         `findOwner` returns zero.
    function test_holderRevokeViaUnregister_zeroesOwner() public onlyFork {
        assertEq(IEnsV2Registry(plotRegistry).findOwner(SEASON_LABEL), farmer);

        vm.prank(holder);
        IUserRegistryWrite(plotRegistry).unregister(_labelId(SEASON_LABEL));

        assertEq(IEnsV2Registry(plotRegistry).findOwner(SEASON_LABEL), address(0), "owner should be zero after revoke");
    }

    /// @notice A stranger (not the holder) cannot unregister the farmer's slot.
    function test_strangerCannotUnregister() public onlyFork {
        vm.prank(stranger);
        vm.expectRevert();
        IUserRegistryWrite(plotRegistry).unregister(_labelId(SEASON_LABEL));
    }

    /// @notice Once the slot's expiry elapses, `findOwner` returns zero on its own -- no `unregister` call
    ///         needed for a slot to stop resolving. But `getState().latestOwner` -- what `EnsSlotResolver`
    ///         actually reads (issue #11) -- stays the last real owner, so `ReliefPool` can still tell
    ///         "expired" apart from "never assigned" via its own `slotExpiry <= block.timestamp` check.
    function test_expiredSlot_findOwnerReturnsZero() public onlyFork {
        vm.warp(SEASON_SLOT_EXPIRY + 1);
        assertEq(IEnsV2Registry(plotRegistry).findOwner(SEASON_LABEL), address(0));

        EnsRegistrationState memory state = IEnsV2Registry(plotRegistry).getState(_labelId(SEASON_LABEL));
        assertEq(state.latestOwner, farmer, "latestOwner should survive time-based expiry");
        assertEq(state.expiry, SEASON_SLOT_EXPIRY, "raw expiry should be the elapsed timestamp");
    }
}
