// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
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
} from "./ens/EnsV2.sol";
import {EnsV2Sepolia} from "./ens/EnsV2Addresses.sol";

/// @notice Reads a text record through the ENSIP-10 wildcard entrypoint, for read-back verification only.
interface ITextResolverRead {
    function text(bytes32 node, string calldata key) external view returns (string memory);
}

/// @notice Issue #7 — ENSv2 Sepolia skeleton: registers `<parent>.eth` via the real ETHRegistrar
///         (commit/reveal, paid in MockUSDC), deploys a branch `UserRegistry` + `PermissionedResolver`
///         proxy pair via `VerifiableFactory` for the "karakuwa" label, registers "karakuwa" under
///         `<parent>.eth` against that branch pair, and grants a "science key" wallet `setText` rights
///         scoped to exactly the `zone` and `species` text keys (via `grantSetterRoles`) — then proves
///         `setText(area)` and `setAddress` still revert for that key.
///
///         Out of scope (by design, see issue #10): per-plot registries and season slots. The branch
///         registry deployed here is exactly what #10 registers plot subnames (`p1213-NNN`) into, and the
///         branch resolver is what #11's `resolve(dnsName, text(...))` reads from — nothing here needs to
///         change shape for either to land.
///
///         `PARENT_LABEL` is a placeholder (default below) until the project picks a public name — see
///         `MEMORY.md` ("never use 'Umi Relief'; neutral names until user picks one"). "karakuwa" is the
///         zone/branch label already used throughout `docs/INTERFACE.md`, not a product name.
///
///         Addresses default to `contracts/script/ens/EnsV2Addresses.sol` (kept in sync with
///         `packages/shared/src/addresses.ts`) and can be overridden per-arg via `ENS_*` env vars if
///         Sepolia has redeployed since (CLAUDE.md: "ENSv2 Sepolia redeploys monthly").
///
///         ---------------------------------------------------------------------------------------------
///         DRY RUN (what this task actually runs — simulates only, never broadcasts):
///           forge script contracts/script/DeployEnsBranch.s.sol --sig "run()" \
///             --fork-url $SEPOLIA_RPC_URL -vvv
///
///         REAL BROADCAST (not run by this task): `run()` acts via `vm.prank` (not `vm.startBroadcast`) so
///         it can `vm.warp` past the commitment window for a clean one-shot dry run; it is not meant to be
///         broadcast. A real broadcast can't skip the wait: ETHRegistrar enforces a real
///         `MIN_COMMITMENT_AGE` (60s on the 2026-09-15 deploy) between `commit` and `register`, and
///         `vm.warp` only advances the local simulation clock, not the real chain's. Use the two-step
///         entrypoints instead, with a real wait between them:
///           1. forge script contracts/script/DeployEnsBranch.s.sol --sig "commitParent()" \
///                --rpc-url $SEPOLIA_RPC_URL --broadcast
///              (prints `export PARENT_REGISTRY=0x...` — export it)
///           2. sleep 90   # real wall-clock wait, >= MIN_COMMITMENT_AGE
///           3. forge script contracts/script/DeployEnsBranch.s.sol --sig "finishAfterCommit()" \
///                --rpc-url $SEPOLIA_RPC_URL --broadcast
///         ---------------------------------------------------------------------------------------------
contract DeployEnsBranch is Script {
    // "karakuwa" is the zone/branch label used throughout docs/INTERFACE.md.
    string internal constant BRANCH_LABEL = "karakuwa";
    uint64 internal constant REGISTRATION_DURATION = 365 days;
    uint256 internal constant TEXT_COIN_TYPE = 60; // SLIP-44 ETH; the coinType is irrelevant to the demo

    // Fallback dry-run keys so this script runs before real DEPLOYER_PRIVATE_KEY/SCIENCE_KEY_PRIVATE_KEY
    // values are set; a real .env always takes precedence via vm.envOr. Deliberately NOT one of Anvil's
    // famous default accounts: those addresses have real (and occasionally hostile — e.g. a fallback that
    // forwards any balance it's dealt elsewhere) contracts deployed at them on live Sepolia, since anyone
    // can derive their private key. These are just keccak256(seed) — addresses confirmed to hold no code
    // on Sepolia (`cast code ... --rpc-url $SEPOLIA_RPC_URL` == "0x") as of 2026-09-26.
    //   deployer:    keccak256("eth-global-tokyo-issue7-deployer-default")    -> 0x7E13d4B75E91f3934BFC2c65FA25FaE4Ad36bB16
    //   science key: keccak256("eth-global-tokyo-issue7-science-key-default") -> 0xD9D8FA0e94B3A4Fe2Ba022Cb4fCba0FcC6302DF8
    uint256 internal constant DEFAULT_DEPLOYER_KEY = 0xf6473e10e5a91a5bcd8c8ed432f7ce525fa5be38f0f96c09dd56cd37aa550ca2;
    uint256 internal constant DEFAULT_SCIENCE_KEY = 0xe3801b9f68e6883cf9814667564066f6ab1fcf002ddca292624a0e6110a34c57;

    // `run()` (dry-run/fork demo) acts via `vm.prank` — no broadcast plan, no real signing needed, and no
    // "onchain simulation" replay pass that (a) can't see the `vm.warp` below and would wrongly fail
    // `register()` on `CommitmentTooNew`, and (b) would otherwise re-run the deliberately-reverting
    // `setText(area)`/`setAddress` calls a second time outside their `try/catch`. `commitParent()` and
    // `finishAfterCommit()` (the real two-step broadcast path) set this so the same helpers sign for real.
    bool internal broadcastMode;

    function _startAsDeployer(uint256 deployerKey, address deployer) internal {
        if (broadcastMode) {
            vm.startBroadcast(deployerKey);
        } else {
            vm.startPrank(deployer);
        }
    }

    function _startAsScienceKey(uint256 scienceKeyKey, address scienceKey) internal {
        if (broadcastMode) {
            vm.startBroadcast(scienceKeyKey);
        } else {
            vm.startPrank(scienceKey);
        }
    }

    function _stopActing() internal {
        if (broadcastMode) {
            vm.stopBroadcast();
        } else {
            vm.stopPrank();
        }
    }

    // ------------------------------------------------------------------
    // ENSv2 contracts (env-overridable; see EnsV2Addresses.sol for the pinned defaults + sources)
    // ------------------------------------------------------------------
    function _ethRegistrar() internal view returns (IEthRegistrarV2) {
        return IEthRegistrarV2(vm.envOr("ENS_ETH_REGISTRAR", EnsV2Sepolia.ETH_REGISTRAR));
    }

    function _verifiableFactory() internal view returns (IVerifiableFactory) {
        return IVerifiableFactory(vm.envOr("ENS_VERIFIABLE_FACTORY", EnsV2Sepolia.VERIFIABLE_FACTORY));
    }

    function _userRegistryImpl() internal view returns (address) {
        return vm.envOr("ENS_USER_REGISTRY_IMPL", EnsV2Sepolia.USER_REGISTRY_IMPL);
    }

    function _permissionedResolverImpl() internal view returns (address) {
        return vm.envOr("ENS_PERMISSIONED_RESOLVER_IMPL", EnsV2Sepolia.PERMISSIONED_RESOLVER_IMPL);
    }

    function _mockUsdc() internal view returns (IMintableERC20) {
        return IMintableERC20(vm.envOr("ENS_MOCK_USDC", EnsV2Sepolia.MOCK_USDC));
    }

    function _parentLabel() internal view returns (string memory) {
        return vm.envOr("PARENT_LABEL", string("eth-global-tokyo-ens-demo"));
    }

    function _commitSecret() internal view returns (bytes32) {
        return keccak256(abi.encodePacked(vm.envOr("ENS_COMMIT_SECRET", string("eth-global-tokyo-issue7"))));
    }

    function _deployerKey() internal view returns (uint256) {
        return vm.envOr("DEPLOYER_PRIVATE_KEY", DEFAULT_DEPLOYER_KEY);
    }

    function _scienceKeyKey() internal view returns (uint256) {
        return vm.envOr("SCIENCE_KEY_PRIVATE_KEY", DEFAULT_SCIENCE_KEY);
    }

    // ------------------------------------------------------------------
    // Entrypoints
    // ------------------------------------------------------------------

    /// @notice Full flow in one run: commit, warp past the commitment window (simulation-only cheatcode),
    ///         register `<parent>.eth`, deploy the karakuwa branch, grant the science key, demo denials.
    ///         This is the dry-run entrypoint (`--fork-url`, no `--broadcast`).
    function run() external {
        uint256 deployerKey = _deployerKey();
        address deployer = vm.addr(deployerKey);
        vm.deal(deployer, 10 ether); // simulation-only funding; no-op on a real broadcast, see contract NatSpec

        address parentRegistry = _commit(deployerKey, deployer);

        vm.warp(block.timestamp + _ethRegistrar().MIN_COMMITMENT_AGE() + 1); // simulation-only

        _finish(deployerKey, deployer, parentRegistry);
    }

    /// @notice Real broadcast, step 1 of 2. See contract NatSpec for the full two-step command sequence.
    function commitParent() external {
        broadcastMode = true;
        uint256 deployerKey = _deployerKey();
        address deployer = vm.addr(deployerKey);
        vm.deal(deployer, 10 ether);

        address parentRegistry = _commit(deployerKey, deployer);
        console2.log("Committed. Wait >= MIN_COMMITMENT_AGE seconds, then export this and run finishAfterCommit():");
        console2.log("  export PARENT_REGISTRY=", parentRegistry);
    }

    /// @notice Real broadcast, step 2 of 2. Requires `PARENT_REGISTRY` (printed by `commitParent()`).
    function finishAfterCommit() external {
        broadcastMode = true;
        uint256 deployerKey = _deployerKey();
        address deployer = vm.addr(deployerKey);
        vm.deal(deployer, 10 ether);

        address parentRegistry = vm.envAddress("PARENT_REGISTRY");
        _finish(deployerKey, deployer, parentRegistry);
    }

    // ------------------------------------------------------------------
    // Step 1: deploy the parent's subregistry, then commit `<parent>.eth`'s registration.
    // ------------------------------------------------------------------
    function _commit(uint256 deployerKey, address deployer) internal returns (address parentRegistry) {
        string memory parentLabel = _parentLabel();

        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant({account: deployer, roleBitmap: _fullRegistryAdminBitmap()});
        bytes memory initData = abi.encodeCall(IEACGrantInitializable.initialize, (grants));

        _startAsDeployer(deployerKey, deployer);
        parentRegistry = _verifiableFactory()
            .deployProxy(
                _userRegistryImpl(), uint256(keccak256(abi.encodePacked(parentLabel, "parent-registry"))), initData
            );
        _stopActing();
        console2.log("Deployed <parent>.eth's subregistry (holds \"karakuwa\"):", parentRegistry);

        bytes32 commitment = _ethRegistrar()
            .makeCommitment(
                parentLabel, deployer, _commitSecret(), parentRegistry, address(0), REGISTRATION_DURATION, bytes32(0)
            );

        _startAsDeployer(deployerKey, deployer);
        _ethRegistrar().commit(commitment);
        _stopActing();
        console2.log("Committed registration for label:", parentLabel);
    }

    // ------------------------------------------------------------------
    // Step 2: register `<parent>.eth`, deploy the karakuwa branch, grant the science key, demo denials.
    // ------------------------------------------------------------------
    function _finish(uint256 deployerKey, address deployer, address parentRegistry) internal {
        uint256 scienceKeyKey = _scienceKeyKey();
        address scienceKey = vm.addr(scienceKeyKey);
        vm.deal(scienceKey, 1 ether); // simulation-only funding; no-op on a real broadcast

        string memory parentLabel = _parentLabel();
        IEthRegistrarV2 registrar = _ethRegistrar();
        IMintableERC20 usdc = _mockUsdc();

        (uint256 base, uint256 premium) = registrar.getRegisterPrice(parentLabel, REGISTRATION_DURATION, address(usdc));
        uint256 cost = base + premium;

        _startAsDeployer(deployerKey, deployer);
        usdc.mint(deployer, cost); // MockUSDC: free-mint testnet faucet token, no access control; never mainnet
        usdc.approve(address(registrar), cost);
        registrar.register(
            parentLabel,
            deployer,
            _commitSecret(),
            parentRegistry,
            address(0),
            REGISTRATION_DURATION,
            address(usdc),
            bytes32(0)
        );
        _stopActing();
        console2.log("Registered <parent>.eth for label:", parentLabel);
        console2.log("  MockUSDC cost (base+premium):", cost);

        (, address karakuwaResolver) = _deployBranch(deployerKey, deployer, parentLabel, parentRegistry);

        _grantScienceKey(deployerKey, deployer, karakuwaResolver, scienceKey);
        _demonstrateDeniedWrites(scienceKeyKey, scienceKey, karakuwaResolver, parentLabel);
    }

    function _deployBranch(uint256 deployerKey, address deployer, string memory parentLabel, address parentRegistry)
        internal
        returns (address karakuwaRegistry, address karakuwaResolver)
    {
        Grant[] memory registryGrants = new Grant[](1);
        registryGrants[0] = Grant({account: deployer, roleBitmap: _fullRegistryAdminBitmap()});
        bytes memory registryInit = abi.encodeCall(IEACGrantInitializable.initialize, (registryGrants));

        _startAsDeployer(deployerKey, deployer);
        karakuwaRegistry = _verifiableFactory()
            .deployProxy(
                _userRegistryImpl(),
                uint256(keccak256(abi.encodePacked(parentLabel, BRANCH_LABEL, "registry"))),
                registryInit
            );
        _stopActing();
        console2.log("Deployed karakuwa branch UserRegistry (plot subnames land here, issue #10):", karakuwaRegistry);

        Grant[] memory resolverGrants = new Grant[](1);
        resolverGrants[0] = Grant({account: deployer, roleBitmap: _fullResolverAdminBitmap()});
        bytes memory resolverInit =
            abi.encodeCall(IPermissionedResolverInitializable.initialize, (resolverGrants, new bytes[](0)));

        _startAsDeployer(deployerKey, deployer);
        karakuwaResolver = _verifiableFactory()
            .deployProxy(
                _permissionedResolverImpl(),
                uint256(keccak256(abi.encodePacked(parentLabel, BRANCH_LABEL, "resolver"))),
                resolverInit
            );
        _stopActing();
        console2.log("Deployed karakuwa branch PermissionedResolver (zone/species land here):", karakuwaResolver);

        _startAsDeployer(deployerKey, deployer);
        IUserRegistryWrite(parentRegistry)
            .register(
                BRANCH_LABEL,
                deployer,
                karakuwaRegistry,
                karakuwaResolver,
                RegistryRoles.REGISTRATION_ROLE_BITMAP,
                uint64(block.timestamp) + REGISTRATION_DURATION
            );
        _stopActing();
        console2.log("Registered karakuwa.<parent>.eth against the branch registry/resolver above.");
    }

    function _grantScienceKey(uint256 deployerKey, address deployer, address karakuwaResolver, address scienceKey)
        internal
    {
        IPermissionedResolverWrite resolver = IPermissionedResolverWrite(karakuwaResolver);

        bytes memory zoneSetter = abi.encodeCall(resolver.setText, (bytes(""), "zone", ""));
        bytes memory speciesSetter = abi.encodeCall(resolver.setText, (bytes(""), "species", ""));

        _startAsDeployer(deployerKey, deployer);
        resolver.grantSetterRoles(zoneSetter, scienceKey);
        resolver.grantSetterRoles(speciesSetter, scienceKey);
        _stopActing();

        console2.log("Granted science key setText(zone)/setText(species) only:", scienceKey);
    }

    function _demonstrateDeniedWrites(
        uint256 scienceKeyKey,
        address scienceKey,
        address karakuwaResolver,
        string memory parentLabel
    ) internal {
        IPermissionedResolverWrite resolver = IPermissionedResolverWrite(karakuwaResolver);
        bytes memory karakuwaName = _dnsEncode(BRANCH_LABEL, parentLabel, "eth");

        _startAsScienceKey(scienceKeyKey, scienceKey);
        resolver.setText(karakuwaName, "zone", "karakuwa-east");
        _stopActing();

        _startAsScienceKey(scienceKeyKey, scienceKey);
        resolver.setText(karakuwaName, "species", "scallop");
        _stopActing();

        string memory zoneReadBack = abi.decode(
            resolver.resolve(karakuwaName, abi.encodeCall(ITextResolverRead.text, (bytes32(0), "zone"))), (string)
        );
        console2.log("OK: science key set zone/species. Read back zone =", zoneReadBack);

        _startAsScienceKey(scienceKeyKey, scienceKey);
        try resolver.setText(karakuwaName, "area", "1200sqm") {
            revert("BUG: expected setText(area) to revert for the science key");
        } catch {
            console2.log("DENIED as expected: science key setText(area)");
        }
        _stopActing();

        _startAsScienceKey(scienceKeyKey, scienceKey);
        try resolver.setAddress(karakuwaName, TEXT_COIN_TYPE, abi.encodePacked(scienceKey)) {
            revert("BUG: expected setAddress to revert for the science key");
        } catch {
            console2.log("DENIED as expected: science key setAddress");
        }
        _stopActing();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------
    function _fullRegistryAdminBitmap() internal pure returns (uint256) {
        return RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_REGISTRAR_ADMIN | RegistryRoles.ROLE_REGISTER_RESERVED
            | RegistryRoles.ROLE_REGISTER_RESERVED_ADMIN | RegistryRoles.ROLE_UNREGISTER
            | RegistryRoles.ROLE_UNREGISTER_ADMIN | RegistryRoles.ROLE_RENEW | RegistryRoles.ROLE_RENEW_ADMIN
            | RegistryRoles.ROLE_SET_SUBREGISTRY | RegistryRoles.ROLE_SET_SUBREGISTRY_ADMIN
            | RegistryRoles.ROLE_SET_RESOLVER | RegistryRoles.ROLE_SET_RESOLVER_ADMIN | RegistryRoles.ROLE_SET_PARENT
            | RegistryRoles.ROLE_SET_PARENT_ADMIN | RegistryRoles.ROLE_SET_URI | RegistryRoles.ROLE_SET_URI_ADMIN
            | RegistryRoles.ROLE_UPGRADE | RegistryRoles.ROLE_UPGRADE_ADMIN;
    }

    function _fullResolverAdminBitmap() internal pure returns (uint256) {
        return ResolverRoles.ROLE_SET_TEXT | ResolverRoles.ROLE_SET_TEXT_ADMIN | ResolverRoles.ROLE_SET_ADDRESS
            | ResolverRoles.ROLE_SET_ADDRESS_ADMIN | ResolverRoles.ROLE_SET_DATA | ResolverRoles.ROLE_SET_DATA_ADMIN
            | ResolverRoles.ROLE_SET_CONTENTHASH | ResolverRoles.ROLE_SET_CONTENTHASH_ADMIN
            | ResolverRoles.ROLE_SET_NAME | ResolverRoles.ROLE_SET_NAME_ADMIN | ResolverRoles.ROLE_LINK
            | ResolverRoles.ROLE_LINK_ADMIN | ResolverRoles.ROLE_UPGRADE | ResolverRoles.ROLE_UPGRADE_ADMIN;
    }

    /// @dev DNS wire encoding of `branch.parent.tld` (length-prefixed labels, zero-byte terminated) — what
    ///      `PermissionedResolver` setters and `IExtendedResolver.resolve` expect as `name`.
    function _dnsEncode(string memory branch, string memory parent, string memory tld)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(
            uint8(bytes(branch).length),
            branch,
            uint8(bytes(parent).length),
            parent,
            uint8(bytes(tld).length),
            tld,
            uint8(0)
        );
    }
}
