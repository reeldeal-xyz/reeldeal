// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IEnsV2Registry} from "../../src/interfaces/IEnsV2.sol";
import {
    Grant,
    IMintableERC20,
    IEthRegistrarV2,
    IUserRegistryWrite,
    IEACGrantInitializable,
    IPermissionedResolverInitializable,
    IPermissionedResolverWrite,
    IEnhancedAccessControlV2,
    IVerifiableFactory,
    RegistryRoles,
    ResolverRoles
} from "../../script/ens/EnsV2.sol";
import {EnsV2Sepolia} from "../../script/ens/EnsV2Addresses.sol";

/// @notice Fork test for issue #7: registers `<parent>.eth` and the "karakuwa" branch against the real
///         ENSv2 Sepolia deployment, and asserts the science key's scoped `setText` grant behaves exactly
///         as issue #7 requires (zone/species allowed, area/setAddress denied).
///
///         Networked and gated behind `RUN_FORK_TESTS=true` (see `RUN_FORK_TESTS` env var) so
///         `bun run contracts:test` / plain `forge test` stay green with no network access — every test
///         here returns immediately if the flag is unset. Run explicitly with:
///           RUN_FORK_TESTS=true forge test --match-contract EnsBranchForkTest -vvv \
///             --fork-url $SEPOLIA_RPC_URL
contract EnsBranchForkTest is Test {
    bool internal RUN_FORK;

    string internal parentLabel;
    string internal constant BRANCH_LABEL = "karakuwa";
    uint64 internal constant REGISTRATION_DURATION = 365 days;

    address internal deployer;
    address internal scienceKey;

    IEthRegistrarV2 internal registrar;
    IMintableERC20 internal usdc;
    IVerifiableFactory internal factory;

    address internal parentRegistry;
    address internal karakuwaRegistry;
    address internal karakuwaResolver;

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

        // Unique-ish per test run; nothing here is ever broadcast to real Sepolia, so collisions only
        // matter if this exact label was already registered for real by someone else.
        parentLabel = string.concat("eth-global-tokyo-issue7-fork-", vm.toString(block.number));

        deployer = makeAddr("ens-branch-deployer");
        scienceKey = makeAddr("ens-branch-science-key");
        vm.deal(deployer, 10 ether);
        vm.deal(scienceKey, 1 ether);

        registrar = IEthRegistrarV2(vm.envOr("ENS_ETH_REGISTRAR", EnsV2Sepolia.ETH_REGISTRAR));
        usdc = IMintableERC20(vm.envOr("ENS_MOCK_USDC", EnsV2Sepolia.MOCK_USDC));
        factory = IVerifiableFactory(vm.envOr("ENS_VERIFIABLE_FACTORY", EnsV2Sepolia.VERIFIABLE_FACTORY));

        _registerParentAndBranch();
    }

    // ------------------------------------------------------------------
    // Setup: register `<parent>.eth`, deploy + register the karakuwa branch, grant the science key.
    // ------------------------------------------------------------------
    function _registerParentAndBranch() internal {
        Grant[] memory parentGrants = new Grant[](1);
        parentGrants[0] =
            Grant({account: deployer, roleBitmap: RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_REGISTRAR_ADMIN});

        vm.startPrank(deployer);
        parentRegistry = factory.deployProxy(
            vm.envOr("ENS_USER_REGISTRY_IMPL", EnsV2Sepolia.USER_REGISTRY_IMPL),
            uint256(keccak256(abi.encodePacked(parentLabel, "parent-registry"))),
            abi.encodeCall(IEACGrantInitializable.initialize, (parentGrants))
        );
        vm.stopPrank();

        bytes32 secret = keccak256("eth-global-tokyo-issue7-fork-test");
        bytes32 commitment = registrar.makeCommitment(
            parentLabel, deployer, secret, parentRegistry, address(0), REGISTRATION_DURATION, bytes32(0)
        );

        vm.prank(deployer);
        registrar.commit(commitment);

        vm.warp(block.timestamp + registrar.MIN_COMMITMENT_AGE() + 1);

        (uint256 base, uint256 premium) = registrar.getRegisterPrice(parentLabel, REGISTRATION_DURATION, address(usdc));
        uint256 cost = base + premium;

        vm.startPrank(deployer);
        usdc.mint(deployer, cost);
        usdc.approve(address(registrar), cost);
        registrar.register(
            parentLabel, deployer, secret, parentRegistry, address(0), REGISTRATION_DURATION, address(usdc), bytes32(0)
        );
        vm.stopPrank();

        Grant[] memory registryGrants = new Grant[](1);
        registryGrants[0] =
            Grant({account: deployer, roleBitmap: RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_REGISTRAR_ADMIN});

        Grant[] memory resolverGrants = new Grant[](1);
        resolverGrants[0] = Grant({
            account: deployer,
            roleBitmap: ResolverRoles.ROLE_SET_TEXT_ADMIN | ResolverRoles.ROLE_SET_TEXT
                | ResolverRoles.ROLE_SET_ADDRESS_ADMIN
        });

        vm.startPrank(deployer);
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
        IUserRegistryWrite(parentRegistry)
            .register(
                BRANCH_LABEL,
                deployer,
                karakuwaRegistry,
                karakuwaResolver,
                RegistryRoles.REGISTRATION_ROLE_BITMAP,
                uint64(block.timestamp) + REGISTRATION_DURATION
            );

        IPermissionedResolverWrite resolver = IPermissionedResolverWrite(karakuwaResolver);
        resolver.grantSetterRoles(abi.encodeCall(resolver.setText, (bytes(""), "zone", "")), scienceKey);
        resolver.grantSetterRoles(abi.encodeCall(resolver.setText, (bytes(""), "species", "")), scienceKey);
        vm.stopPrank();
    }

    function _karakuwaName() internal view returns (bytes memory) {
        return abi.encodePacked(
            uint8(bytes(BRANCH_LABEL).length),
            BRANCH_LABEL,
            uint8(bytes(parentLabel).length),
            parentLabel,
            uint8(3),
            "eth",
            uint8(0)
        );
    }

    // ------------------------------------------------------------------
    // Tests
    // ------------------------------------------------------------------

    /// @notice `<parent>.eth`'s subregistry is the parent registry we deployed, and "karakuwa" resolves
    ///         to the branch registry/resolver pair — i.e. the branch is actually wired into the tree.
    function test_branchIsWiredUnderParent() public view onlyFork {
        IEnsV2Registry ethRegistry = IEnsV2Registry(vm.envOr("ENS_ETH_REGISTRY", EnsV2Sepolia.ETH_REGISTRY));
        assertEq(ethRegistry.getSubregistry(parentLabel), parentRegistry, "parent subregistry mismatch");

        IEnsV2Registry parentRegistryRead = IEnsV2Registry(parentRegistry);
        assertEq(parentRegistryRead.getSubregistry(BRANCH_LABEL), karakuwaRegistry, "karakuwa subregistry mismatch");
        assertEq(parentRegistryRead.getResolver(BRANCH_LABEL), karakuwaResolver, "karakuwa resolver mismatch");
    }

    /// @notice The science key can set exactly `zone` and `species` on the branch resolver.
    function test_scienceKeyCanSetZoneAndSpecies() public onlyFork {
        bytes memory name = _karakuwaName();
        IPermissionedResolverWrite resolver = IPermissionedResolverWrite(karakuwaResolver);

        vm.startPrank(scienceKey);
        resolver.setText(name, "zone", "karakuwa-east");
        resolver.setText(name, "species", "scallop");
        vm.stopPrank();

        string memory zoneReadBack = abi.decode(
            resolver.resolve(name, abi.encodeWithSignature("text(bytes32,string)", bytes32(0), "zone")), (string)
        );
        string memory speciesReadBack = abi.decode(
            resolver.resolve(name, abi.encodeWithSignature("text(bytes32,string)", bytes32(0), "species")), (string)
        );
        assertEq(zoneReadBack, "karakuwa-east");
        assertEq(speciesReadBack, "scallop");
    }

    /// @notice The science key's `setText(area)` reverts — it was never granted `ROLE_SET_TEXT` for the
    ///         `area` resource, only for `zone`/`species`.
    function test_scienceKeyCannotSetArea() public onlyFork {
        bytes memory name = _karakuwaName();
        uint256 areaResource = ResolverRoles.resource("area");

        vm.prank(scienceKey);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControlV2.EACUnauthorizedAccountRoles.selector,
                areaResource,
                ResolverRoles.ROLE_SET_TEXT,
                scienceKey
            )
        );
        IPermissionedResolverWrite(karakuwaResolver).setText(name, "area", "1200sqm");
    }

    /// @notice The science key's `setAddress` reverts — it was never granted `ROLE_SET_ADDRESS` at all.
    function test_scienceKeyCannotSetAddress() public onlyFork {
        bytes memory name = _karakuwaName();
        uint256 coinType = 60;
        uint256 addressResource = ResolverRoles.resource(coinType);

        vm.prank(scienceKey);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControlV2.EACUnauthorizedAccountRoles.selector,
                addressResource,
                ResolverRoles.ROLE_SET_ADDRESS,
                scienceKey
            )
        );
        IPermissionedResolverWrite(karakuwaResolver).setAddress(name, coinType, abi.encodePacked(scienceKey));
    }
}
