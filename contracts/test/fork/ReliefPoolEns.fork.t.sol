// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReliefPool} from "../../src/ReliefPool.sol";
import {IReliefPool} from "../../src/interfaces/IReliefPool.sol";
import {HumanRegistry} from "../../src/HumanRegistry.sol";
import {EnsPlotResolver} from "../../src/adapters/EnsPlotResolver.sol";
import {EnsSlotResolver} from "../../src/adapters/EnsSlotResolver.sol";
import {IEnsV2Registry} from "../../src/interfaces/IEnsV2.sol";
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

/// @notice Fork test for issue #11 — the fork gate: ReliefPool reads ENS on-chain (real `EnsPlotResolver`/
///         `EnsSlotResolver`, no mocks) and pays real JPYC to a real ENSv2 season-slot owner on Sepolia.
///
///         Deploys the whole stack on the fork: a fresh `<parent>.eth` + karakuwa branch (issue #7's
///         layout), three plots each with their own per-plot registry (issue #10) — one with an active
///         "2026" slot, one with an expired slot, one that was enrolled but never had a slot issued — real
///         `HumanRegistry`, and a `ReliefPool` wired to the real `EnsPlotResolver`/`EnsSlotResolver`
///         adapters (not `MockPlotResolver`/`MockSlotResolver`). Funds the pool with real JPYC
///         (0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29, 18 decimals) via `deal`, per the task's "real JPYC
///         via deal" option — simpler than deploying a mock and just as faithful, since `attest`/`settle`
///         only ever read `jpyc.balanceOf(address(this))`.
///
///         Networked and gated behind `RUN_FORK_TESTS=true`, exactly like the other fork suites:
///           RUN_FORK_TESTS=true forge test --match-contract ReliefPoolEnsForkTest -vvv \
///             --fork-url $SEPOLIA_RPC_URL
contract ReliefPoolEnsForkTest is Test {
    bool internal RUN_FORK;

    // Real JPYC on Sepolia (docs/ARCHITECTURE.md, packages/shared/src/addresses.ts). 18 decimals.
    address internal constant JPYC = 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29;

    string internal parentLabel;
    string internal constant BRANCH_LABEL = "karakuwa";
    string internal constant ZONE_LABEL = "karakuwa-east";
    string internal constant SPECIES_LABEL = "scallop";
    string internal constant PERIL_LABEL = "HEAT";
    string internal constant SEASON_LABEL = "2026";
    uint64 internal constant REGISTRATION_DURATION = 365 days;
    uint64 internal constant PLOT_LICENCE_DURATION = 3650 days;

    bytes32 internal zoneId;
    bytes32 internal speciesId;
    bytes32 internal perilId;

    address internal deployer;
    address internal holder;
    address internal admin;
    address internal farmerActive;
    bytes32 internal nullifierActive;

    address internal signer1;
    uint256 internal signer1Key;
    address internal signer2;
    uint256 internal signer2Key;
    address internal signer3;
    uint256 internal signer3Key;
    address internal binder;

    IEthRegistrarV2 internal registrar;
    IMintableERC20 internal usdc;
    IVerifiableFactory internal factory;

    address internal karakuwaRegistry;
    address internal karakuwaResolver;

    string internal constant PLOT_ACTIVE = "p1213-101";
    string internal constant PLOT_EXPIRED = "p1213-102";
    string internal constant PLOT_UNASSIGNED = "p1213-103";
    address internal plotRegistryActive;
    address internal plotRegistryExpired;
    address internal plotRegistryUnassigned;
    uint64 internal activeSlotExpiry;
    uint64 internal expiredSlotExpiry;

    HumanRegistry internal humans;
    EnsPlotResolver internal plotResolver;
    EnsSlotResolver internal slotResolver;
    ReliefPool internal pool;

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

        zoneId = keccak256(bytes(ZONE_LABEL));
        speciesId = keccak256(bytes(SPECIES_LABEL));
        perilId = keccak256(bytes(PERIL_LABEL));

        parentLabel = string.concat("eth-global-tokyo-issue11-fork-", vm.toString(block.number));

        deployer = makeAddr("pool-fork-deployer");
        holder = makeAddr("pool-fork-holder");
        admin = makeAddr("pool-fork-admin");
        farmerActive = makeAddr("pool-fork-farmer-active");
        nullifierActive = keccak256("pool-fork-nullifier-active");
        binder = makeAddr("pool-fork-binder");
        vm.deal(deployer, 10 ether);
        vm.deal(holder, 1 ether);

        (signer1, signer1Key) = makeAddrAndKey("pool-fork-signer1");
        (signer2, signer2Key) = makeAddrAndKey("pool-fork-signer2");
        (signer3, signer3Key) = makeAddrAndKey("pool-fork-signer3");

        registrar = IEthRegistrarV2(vm.envOr("ENS_ETH_REGISTRAR", EnsV2Sepolia.ETH_REGISTRAR));
        usdc = IMintableERC20(vm.envOr("ENS_MOCK_USDC", EnsV2Sepolia.MOCK_USDC));
        factory = IVerifiableFactory(vm.envOr("ENS_VERIFIABLE_FACTORY", EnsV2Sepolia.VERIFIABLE_FACTORY));

        _registerParentAndBranch();
        _setupPlots();
        _deployHumansAndPool();
    }

    // ------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------
    function _registerParentAndBranch() internal {
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

        bytes32 secret = keccak256("eth-global-tokyo-issue11-fork-test");
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

        Grant[] memory registryGrants = new Grant[](1);
        registryGrants[0] =
            Grant({account: deployer, roleBitmap: RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_REGISTRAR_ADMIN});
        Grant[] memory resolverGrants = new Grant[](1);
        resolverGrants[0] =
            Grant({account: deployer, roleBitmap: ResolverRoles.ROLE_SET_TEXT_ADMIN | ResolverRoles.ROLE_SET_TEXT});

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
    }

    /// @dev Three plots, all `(karakuwa-east, scallop)`: PLOT_ACTIVE has a live "2026" slot owned by
    ///      `farmerActive`; PLOT_EXPIRED has a "2026" slot that already elapsed; PLOT_UNASSIGNED is
    ///      registered (so it's enrollable) but never had a "2026" slot issued at all.
    ///
    ///      `register()` rejects an already-past `expiry` outright (`CannotSetPastExpiry`) -- ENSv2 won't
    ///      let you create a pre-expired registration from scratch. So PLOT_EXPIRED's slot is registered
    ///      with a near-future expiry and then `vm.warp`'d past it, while PLOT_ACTIVE's (180 days out) stays
    ///      comfortably valid across that same warp.
    function _setupPlots() internal {
        activeSlotExpiry = uint64(block.timestamp) + 180 days;
        uint64 shortFutureExpiry = uint64(block.timestamp) + 1 hours;

        plotRegistryActive = _deployPlot(PLOT_ACTIVE);
        plotRegistryExpired = _deployPlot(PLOT_EXPIRED);
        plotRegistryUnassigned = _deployPlot(PLOT_UNASSIGNED);

        vm.prank(holder);
        IUserRegistryWrite(plotRegistryActive).register(
            SEASON_LABEL, farmerActive, address(0), address(0), 0, activeSlotExpiry
        );

        address farmerPastOwner = makeAddr("pool-fork-farmer-expired");
        vm.prank(holder);
        IUserRegistryWrite(plotRegistryExpired).register(
            SEASON_LABEL, farmerPastOwner, address(0), address(0), 0, shortFutureExpiry
        );
        // PLOT_UNASSIGNED: no register() call at all for "2026" -> NO_FARMER.

        vm.warp(uint256(shortFutureExpiry) + 1);
        expiredSlotExpiry = shortFutureExpiry;
    }

    function _deployPlot(string memory plotLabel) internal returns (address plotRegistry) {
        Grant[] memory plotGrants = new Grant[](1);
        plotGrants[0] = Grant({
            account: holder,
            roleBitmap: RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_UNREGISTER | RegistryRoles.ROLE_RENEW
        });

        vm.startPrank(deployer);
        plotRegistry = factory.deployProxy(
            vm.envOr("ENS_USER_REGISTRY_IMPL", EnsV2Sepolia.USER_REGISTRY_IMPL),
            uint256(keccak256(abi.encodePacked(parentLabel, plotLabel, "registry"))),
            abi.encodeCall(IEACGrantInitializable.initialize, (plotGrants))
        );
        IUserRegistryWrite(karakuwaRegistry).register(
            plotLabel, holder, plotRegistry, karakuwaResolver, 0, uint64(block.timestamp) + PLOT_LICENCE_DURATION
        );

        bytes memory plotName = abi.encodePacked(
            uint8(bytes(plotLabel).length),
            plotLabel,
            uint8(bytes(BRANCH_LABEL).length),
            BRANCH_LABEL,
            uint8(bytes(parentLabel).length),
            parentLabel,
            uint8(3),
            "eth",
            uint8(0)
        );
        IPermissionedResolverWrite(karakuwaResolver).setText(plotName, "zone", ZONE_LABEL);
        IPermissionedResolverWrite(karakuwaResolver).setText(plotName, "species", SPECIES_LABEL);
        vm.stopPrank();
    }

    function _deployHumansAndPool() internal {
        humans = new HumanRegistry(admin, binder);
        vm.prank(binder);
        humans.bind(farmerActive, nullifierActive, 11, 500, uint64(block.timestamp), bytes32("receipt"));

        plotResolver = new EnsPlotResolver(IEnsV2Registry(karakuwaRegistry), BRANCH_LABEL, parentLabel, "eth");
        slotResolver = new EnsSlotResolver(IEnsV2Registry(karakuwaRegistry));

        pool = new ReliefPool(IERC20(JPYC), humans, plotResolver, slotResolver, admin);

        address[] memory sset = new address[](3);
        sset[0] = signer1;
        sset[1] = signer2;
        sset[2] = signer3;
        vm.prank(admin);
        pool.setSigners(sset, 2);

        vm.prank(admin);
        pool.setTierAmount(perilId, speciesId, 1, 20_000e18);

        deal(JPYC, address(pool), 10_000_000e18);

        pool.enroll(PLOT_ACTIVE);
        pool.enroll(PLOT_EXPIRED);
        pool.enroll(PLOT_UNASSIGNED);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------
    function _trigger(uint32 index_, uint64 deadline_) internal view returns (IReliefPool.Trigger memory t) {
        t.zoneId = zoneId;
        t.speciesId = speciesId;
        t.perilId = perilId;
        t.tier = 1;
        t.seasonLabel = SEASON_LABEL;
        t.windowStart = uint64(block.timestamp - 30 days);
        t.windowEnd = uint64(block.timestamp - 1);
        t.firedAt = uint64(block.timestamp - 2);
        t.index = index_;
        t.threshold = 14;
        t.tempC = 25; // RULES: scallop tier 1
        t.dataHash = keccak256("fork-test-data");
        t.deadline = deadline_;
    }

    function _sign(uint256 key, IReliefPool.Trigger memory t) internal view returns (bytes memory) {
        bytes32 digest = pool.triggerDigest(t);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _plots3(string memory a, string memory b, string memory c) internal pure returns (string[] memory arr) {
        arr = new string[](3);
        arr[0] = a;
        arr[1] = b;
        arr[2] = c;
    }

    // ------------------------------------------------------------------
    // The fork gate: real ENSv2 reads, real JPYC payout to the real slot owner.
    // ------------------------------------------------------------------

    /// @notice End to end on real ENSv2 Sepolia: attest + settle pays the active plot's slot owner in real
    ///         JPYC, holds the expired plot with `REASON_PLOT_EXPIRED`, and holds the never-assigned plot
    ///         with `REASON_NO_FARMER` -- driven entirely by `EnsPlotResolver`/`EnsSlotResolver`, no mocks.
    function test_settleEndToEnd_paysActiveHoldsExpiredHoldsUnassigned() public onlyFork {
        // Sanity: the real adapters already agree with what settle is about to do.
        (address farmer, address registryActive, uint64 expiryActive) = pool.payoutTarget(PLOT_ACTIVE, SEASON_LABEL);
        assertEq(farmer, farmerActive, "payoutTarget should resolve the real ENSv2 slot owner");
        assertEq(registryActive, plotRegistryActive);
        assertEq(expiryActive, activeSlotExpiry);

        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(signer1Key, t);
        sigs[1] = _sign(signer2Key, t);

        bytes32 eventId = pool.attest(t, sigs);

        uint256 balBefore = IERC20(JPYC).balanceOf(farmerActive);

        pool.settle(eventId, _plots3(PLOT_ACTIVE, PLOT_EXPIRED, PLOT_UNASSIGNED));

        assertEq(IERC20(JPYC).balanceOf(farmerActive) - balBefore, 20_000e18, "farmer should receive real JPYC");

        (ReliefPool.PlotStatus activeStatus,) = pool.plotSettlements(eventId, PLOT_ACTIVE);
        assertEq(uint8(activeStatus), uint8(ReliefPool.PlotStatus.Paid));

        (ReliefPool.PlotStatus expiredStatus, bytes32 expiredReason) = pool.plotSettlements(eventId, PLOT_EXPIRED);
        assertEq(uint8(expiredStatus), uint8(ReliefPool.PlotStatus.Held));
        assertEq(expiredReason, pool.REASON_PLOT_EXPIRED(), "expired real ENSv2 slot should hold as PLOT_EXPIRED");

        (ReliefPool.PlotStatus unassignedStatus, bytes32 unassignedReason) =
            pool.plotSettlements(eventId, PLOT_UNASSIGNED);
        assertEq(uint8(unassignedStatus), uint8(ReliefPool.PlotStatus.Held));
        assertEq(unassignedReason, pool.REASON_NO_FARMER(), "never-assigned real ENSv2 slot should hold as NO_FARMER");
    }

    /// @notice A revoked slot (holder `unregister`s it after issuance) holds the same as never-assigned --
    ///         `EnsSlotResolver` sees `latestOwner == 0` either way once the token is actually burned.
    function test_revokedSlot_holdsAsNoFarmer() public onlyFork {
        vm.prank(holder);
        IUserRegistryWrite(plotRegistryActive).unregister(uint256(keccak256(bytes(SEASON_LABEL))));

        (address farmer,,) = pool.payoutTarget(PLOT_ACTIVE, SEASON_LABEL);
        assertEq(farmer, address(0), "revoked slot should resolve to no farmer");

        IReliefPool.Trigger memory t = _trigger(20, uint64(block.timestamp + 1 days));
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(signer1Key, t);
        sigs[1] = _sign(signer3Key, t);
        bytes32 eventId = pool.attest(t, sigs);

        pool.settle(eventId, _plots3(PLOT_ACTIVE, PLOT_EXPIRED, PLOT_UNASSIGNED));

        (, bytes32 reason) = pool.plotSettlements(eventId, PLOT_ACTIVE);
        assertEq(reason, pool.REASON_NO_FARMER());
    }
}
