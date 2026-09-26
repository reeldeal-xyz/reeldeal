// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HumanRegistry} from "../src/HumanRegistry.sol";
import {ReliefPool} from "../src/ReliefPool.sol";
import {EnsPlotResolver} from "../src/adapters/EnsPlotResolver.sol";
import {EnsSlotResolver} from "../src/adapters/EnsSlotResolver.sol";
import {IEnsV2Registry} from "../src/interfaces/IEnsV2.sol";
import {DeployEnsPlots} from "./DeployEnsPlots.s.sol";

/// @notice Issue #16 — core Sepolia deploy: HumanRegistry, the two real ENSv2 adapters (issue #11),
///         ReliefPool wired to them, signers/tier amounts, all 15 plots enrolled, and a seed JPYC donation.
///
///         Ordering (per docs/INTERFACE.md's ENS layout + issue #16): ENS itself (`umi.eth` parent, the
///         `karakuwa` branch, 15 `p1213-NNN` plots and their "2026" season slots) is broadcast SEPARATELY by
///         the coordinator via `DeployEnsBranch.s.sol` / `DeployEnsPlots.s.sol` (issues #7/#10), which prints
///         `KARAKUWA_REGISTRY`/`KARAKUWA_RESOLVER`/`PARENT_LABEL`. This script only runs AFTER that: `run()`
///         reads those three as env vars and never touches ENS registration itself.
///
///         `dryRun()` is the exception — a fully self-contained simulation (no prior broadcast needed) that
///         bootstraps a throwaway ENS branch + 15 plots/slots via `EnsBootstrap` (below, reusing
///         `DeployEnsPlots`'s internals exactly as its own `runWithPlots()` does), then deploys and verifies
///         the core stack against it. It never broadcasts. `dryRunAgainstLive()` is a middle ground: it skips
///         the throwaway ENS bootstrap and instead simulates against the REAL branch/plots/slots the
///         coordinator just broadcast (KARAKUWA_REGISTRY/KARAKUWA_RESOLVER/PARENT_LABEL env), still never
///         broadcasting itself.
///
///         Product name: "Reel Deal" (renamed from "UMI" in user-facing copy only — see commits renaming web/
///         LINE/MultiBaas copy; contracts, the ENS name `umi.eth` and on-chain identifiers are unchanged).
///
///         ---------------------------------------------------------------------------------------------
///         DRY RUN (simulates only, never broadcasts — bootstraps its own throwaway ENS branch + core stack):
///           forge script contracts/script/DeployReelDeal.s.sol:DeployReelDeal --sig "dryRun()" \
///             --fork-url $SEPOLIA_RPC_URL -vv
///
///         DRY RUN AGAINST LIVE ENS (simulates only, never broadcasts — uses the real, already-broadcast ENS
///         branch/plots/slots via KARAKUWA_REGISTRY/KARAKUWA_RESOLVER/PARENT_LABEL):
///           forge script contracts/script/DeployReelDeal.s.sol:DeployReelDeal --sig "dryRunAgainstLive()" \
///             --fork-url $SEPOLIA_RPC_URL -vv
///
///         REAL BROADCAST (requires ENS already deployed — KARAKUWA_REGISTRY/KARAKUWA_RESOLVER/PARENT_LABEL
///         env vars from the coordinator's `DeployEnsPlots.s.sol:deployPlotsAndSlots()` run):
///           forge script contracts/script/DeployReelDeal.s.sol:DeployReelDeal --sig "run()" \
///             --rpc-url $SEPOLIA_RPC_URL --broadcast
///           Required env: DEPLOYER_PRIVATE_KEY, BINDER_PRIVATE_KEY, PIPELINE_SIGNER_PRIVATE_KEY,
///           COOP_SIGNER_PRIVATE_KEY, SCIENCE_KEY_PRIVATE_KEY, KARAKUWA_REGISTRY, KARAKUWA_RESOLVER,
///           PARENT_LABEL. Optional: DONATION_JPYC (default 200000e18). The deployer must already hold at
///           least DONATION_JPYC real JPYC (faucet.jpyc.co.jp) before running — this script cannot mint it.
///         ---------------------------------------------------------------------------------------------
contract DeployReelDeal is Script, StdCheats {
    // Real JPYC on Sepolia (docs/ARCHITECTURE.md, packages/shared/src/addresses.ts). 18 decimals.
    address internal constant JPYC = 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29;

    string internal constant BRANCH_LABEL = "karakuwa";
    string internal constant SEASON_LABEL = "2026";
    uint256 internal constant PLOT_COUNT = 15;

    /// @dev Pro-rata amounts, per docs/ARCHITECTURE.md ("scallop tier 1 Â¥20,000/unit, tier 2 +Â¥30,000; hoya
    ///      tier 1 Â¥20,000; toxin Â¥10,000") applied to every (peril, species, tier) combination that
    ///      packages/shared/src/rules.ts's RULES actually declares. Tier 2 total = 20,000 + 30,000 = 50,000.
    uint256 internal constant TIER1_HEAT_AMOUNT = 20_000e18;
    uint256 internal constant TIER2_HEAT_AMOUNT = 50_000e18;
    uint256 internal constant TOXIN_AMOUNT = 10_000e18;

    /// @dev Default seed donation if DONATION_JPYC is unset.
    uint256 internal constant DEFAULT_DONATION = 200_000e18;

    bytes32 internal constant SPECIES_SCALLOP = keccak256("scallop");
    bytes32 internal constant SPECIES_HOYA = keccak256("hoya");
    bytes32 internal constant SPECIES_OYSTER = keccak256("oyster");
    bytes32 internal constant PERIL_HEAT24 = keccak256("HEAT24");
    bytes32 internal constant PERIL_HEAT25 = keccak256("HEAT25");
    bytes32 internal constant PERIL_HEAT26 = keccak256("HEAT26");
    bytes32 internal constant PERIL_BANWEEKS = keccak256("BANWEEKS");

    // ------------------------------------------------------------------
    // Env-or-default private keys. Real .env values always take precedence (vm.envOr); these fallbacks only
    // matter for a from-scratch dryRun() with no .env at all -- never meant to hold real funds.
    // ------------------------------------------------------------------
    function _keyOrDefault(string memory envVar, string memory seed) internal view returns (uint256) {
        return vm.envOr(envVar, uint256(keccak256(bytes(seed))));
    }

    function _deployerKey() internal view returns (uint256) {
        return _keyOrDefault("DEPLOYER_PRIVATE_KEY", "eth-global-tokyo-issue16-deployer-default");
    }

    function _binderKey() internal view returns (uint256) {
        return _keyOrDefault("BINDER_PRIVATE_KEY", "eth-global-tokyo-issue16-binder-default");
    }

    function _pipelineSignerKey() internal view returns (uint256) {
        return _keyOrDefault("PIPELINE_SIGNER_PRIVATE_KEY", "eth-global-tokyo-issue16-pipeline-signer-default");
    }

    function _coopSignerKey() internal view returns (uint256) {
        return _keyOrDefault("COOP_SIGNER_PRIVATE_KEY", "eth-global-tokyo-issue16-coop-signer-default");
    }

    function _scienceSignerKey() internal view returns (uint256) {
        return _keyOrDefault("SCIENCE_KEY_PRIVATE_KEY", "eth-global-tokyo-issue16-science-signer-default");
    }

    // ------------------------------------------------------------------
    // Entrypoints
    // ------------------------------------------------------------------

    /// @dev Bundled into a struct (rather than ~10 separate function params) to avoid "stack too deep" in
    ///      `_deployCore` under the default (non-via-IR) compilation profile this repo uses.
    struct CoreDeployParams {
        uint256 deployerKey;
        uint256 binderKey;
        uint256 pipelineSignerKey;
        uint256 coopSignerKey;
        uint256 scienceSignerKey;
        address karakuwaRegistry;
        address karakuwaResolver;
        string parentLabel;
        uint256 donationAmount;
        bool broadcast;
    }

    function _signerKeys() internal view returns (uint256, uint256, uint256, uint256, uint256) {
        return (_deployerKey(), _binderKey(), _pipelineSignerKey(), _coopSignerKey(), _scienceSignerKey());
    }

    /// @dev KARAKUWA_REGISTRY/KARAKUWA_RESOLVER/PARENT_LABEL, as printed by the coordinator's
    ///      `DeployEnsPlots.s.sol:deployPlotsAndSlots()` broadcast. Shared by `run()` and
    ///      `dryRunAgainstLive()`, which both act against the real, already-deployed ENS branch.
    function _liveEnsAddresses() internal view returns (address karakuwaRegistry, address karakuwaResolver, string memory parentLabel) {
        karakuwaRegistry = vm.envAddress("KARAKUWA_REGISTRY");
        karakuwaResolver = vm.envAddress("KARAKUWA_RESOLVER");
        parentLabel = vm.envOr("PARENT_LABEL", string("umi"));
    }

    /// @notice Real broadcast. Requires ENS already deployed separately (see contract NatSpec).
    function run() external {
        CoreDeployParams memory p;
        (p.deployerKey, p.binderKey, p.pipelineSignerKey, p.coopSignerKey, p.scienceSignerKey) = _signerKeys();
        (p.karakuwaRegistry, p.karakuwaResolver, p.parentLabel) = _liveEnsAddresses();
        p.donationAmount = vm.envOr("DONATION_JPYC", DEFAULT_DONATION);
        p.broadcast = true;

        _deployCore(p);
    }

    /// @notice Self-contained fork simulation: bootstraps a throwaway ENS branch + 15 plots/slots, then
    ///         deploys and verifies the core stack against it. Never broadcasts. See contract NatSpec for
    ///         the exact command.
    function dryRun() external {
        EnsBootstrap ensBootstrap = new EnsBootstrap();

        CoreDeployParams memory p;
        (p.deployerKey, p.binderKey, p.pipelineSignerKey, p.coopSignerKey, p.scienceSignerKey) = _signerKeys();
        (p.karakuwaRegistry, p.karakuwaResolver, p.parentLabel) = ensBootstrap.bootstrap();
        p.donationAmount = vm.envOr("DONATION_JPYC", DEFAULT_DONATION);
        p.broadcast = false;

        (, ReliefPool pool,,) = _deployCore(p);

        _verify(pool, p.donationAmount);
    }

    /// @notice Fork simulation against the REAL, already-broadcast ENS branch/plots/slots (KARAKUWA_REGISTRY/
    ///         KARAKUWA_RESOLVER/PARENT_LABEL env) instead of a throwaway bootstrap. Never broadcasts. Useful
    ///         once the coordinator's ENS broadcast has actually landed, to verify the core stack against the
    ///         real plot/slot data before spending real gas on `run()`.
    function dryRunAgainstLive() external {
        CoreDeployParams memory p;
        (p.deployerKey, p.binderKey, p.pipelineSignerKey, p.coopSignerKey, p.scienceSignerKey) = _signerKeys();
        (p.karakuwaRegistry, p.karakuwaResolver, p.parentLabel) = _liveEnsAddresses();
        p.donationAmount = vm.envOr("DONATION_JPYC", DEFAULT_DONATION);
        p.broadcast = false;

        (, ReliefPool pool,,) = _deployCore(p);

        _verify(pool, p.donationAmount);
    }

    // ------------------------------------------------------------------
    // Core deploy, shared by run()/dryRun(). `broadcast == true` uses vm.startBroadcast (real, run()
    // only); `broadcast == false` uses vm.startPrank + `deal`s the deployer JPYC first, so dryRun() exercises
    // the real approve+donate path against a fork instead of `deal`ing the pool directly.
    // ------------------------------------------------------------------
    function _deployCore(CoreDeployParams memory p)
        internal
        returns (HumanRegistry humans, ReliefPool pool, EnsPlotResolver plotResolver, EnsSlotResolver slotResolver)
    {
        address deployer = vm.addr(p.deployerKey);

        if (!p.broadcast) {
            vm.deal(deployer, 1 ether);
            if (p.donationAmount > 0) {
                deal(JPYC, deployer, p.donationAmount);
            }
        }

        if (p.broadcast) {
            vm.startBroadcast(p.deployerKey);
        } else {
            vm.startPrank(deployer);
        }

        humans = new HumanRegistry(deployer, vm.addr(p.binderKey));
        plotResolver = new EnsPlotResolver(IEnsV2Registry(p.karakuwaRegistry), BRANCH_LABEL, p.parentLabel, "eth");
        slotResolver = new EnsSlotResolver(IEnsV2Registry(p.karakuwaRegistry));
        pool = new ReliefPool(IERC20(JPYC), humans, plotResolver, slotResolver, deployer);
        uint256 deployBlock = block.number;

        pool.setSigners(_signerSet(p.pipelineSignerKey, p.coopSignerKey, p.scienceSignerKey), 2);
        _setTierAmounts(pool);

        for (uint256 i = 0; i < PLOT_COUNT; ++i) {
            pool.enroll(_plotLabel(i));
        }

        if (p.donationAmount > 0) {
            IERC20(JPYC).approve(address(pool), p.donationAmount);
            pool.donate(p.donationAmount, "Reel Deal seed donation");
        }

        if (p.broadcast) {
            vm.stopBroadcast();
        } else {
            vm.stopPrank();
        }

        _logAddresses(humans, pool, plotResolver, slotResolver, deployBlock);
    }

    function _signerSet(uint256 pipelineSignerKey, uint256 coopSignerKey, uint256 scienceSignerKey)
        internal
        view
        returns (address[] memory signerSet)
    {
        signerSet = new address[](3);
        signerSet[0] = vm.addr(pipelineSignerKey);
        signerSet[1] = vm.addr(coopSignerKey);
        signerSet[2] = vm.addr(scienceSignerKey);
    }

    /// @dev Every (peril, species, tier) combination RULES declares (packages/shared/src/rules.ts).
    function _setTierAmounts(ReliefPool pool) internal {
        pool.setTierAmount(PERIL_HEAT25, SPECIES_SCALLOP, 1, TIER1_HEAT_AMOUNT);
        pool.setTierAmount(PERIL_HEAT26, SPECIES_SCALLOP, 2, TIER2_HEAT_AMOUNT);
        pool.setTierAmount(PERIL_HEAT24, SPECIES_HOYA, 1, TIER1_HEAT_AMOUNT);
        pool.setTierAmount(PERIL_BANWEEKS, SPECIES_OYSTER, 1, TOXIN_AMOUNT);
        pool.setTierAmount(PERIL_BANWEEKS, SPECIES_SCALLOP, 1, TOXIN_AMOUNT);
        // unitCap[1]=3 / unitCap[2]=12 and claimWindow=90 days already match ReliefPool's constructor
        // defaults -- no setUnitCap/setClaimWindow calls needed.
    }

    function _logAddresses(
        HumanRegistry humans,
        ReliefPool pool,
        EnsPlotResolver plotResolver,
        EnsSlotResolver slotResolver,
        uint256 deployBlock
    ) internal pure {
        console2.log("== Reel Deal core deploy ==");
        console2.log("export HUMAN_REGISTRY_ADDRESS=", address(humans));
        console2.log("export RELIEF_POOL_ADDRESS=", address(pool));
        console2.log("export RELIEF_POOL_DEPLOY_BLOCK=", deployBlock);
        console2.log("export ENS_PLOT_RESOLVER_ADAPTER=", address(plotResolver));
        console2.log("export ENS_SLOT_RESOLVER_ADAPTER=", address(slotResolver));
    }

    // ------------------------------------------------------------------
    // dryRun() assertions
    // ------------------------------------------------------------------
    function _verify(ReliefPool pool, uint256 donationAmount) internal view {
        require(pool.signerThreshold() == 2, "dryRun: signerThreshold != 2");
        console2.log("OK: signerThreshold == 2");

        for (uint256 i = 0; i < PLOT_COUNT; ++i) {
            (,, bool enrolled) = pool.plots(_plotLabel(i));
            require(enrolled, "dryRun: plot not enrolled");
        }
        console2.log("OK: all 15 plots enrolled");

        uint256 poolBalance = IERC20(JPYC).balanceOf(address(pool));
        require(poolBalance == donationAmount, "dryRun: pool JPYC balance != donation");
        console2.log("OK: pool JPYC balance == donation:", poolBalance);

        (address farmer,, uint64 slotExpiry) = pool.payoutTarget(_plotLabel(0), SEASON_LABEL);
        require(farmer == _farmerFor(0), "dryRun: payoutTarget did not resolve the expected farmer");
        require(slotExpiry > block.timestamp, "dryRun: resolved slot already expired");
        console2.log("OK: payoutTarget resolves plot 0's farmer via the real ENSv2 adapters:", farmer);
    }

    // ------------------------------------------------------------------
    // Plot labels/farmers -- mirrors DeployEnsPlots._plotLabel/_pad3/_farmerFor exactly (kept local rather
    // than inherited so DeployReelDeal never picks up DeployEnsBranch's non-virtual `run()`; see EnsBootstrap).
    // ------------------------------------------------------------------
    function _plotLabel(uint256 index) internal view returns (string memory) {
        return string.concat("p1213-", _pad3(index + 1));
    }

    function _pad3(uint256 n) internal view returns (string memory) {
        if (n < 10) return string.concat("00", vm.toString(n));
        if (n < 100) return string.concat("0", vm.toString(n));
        return vm.toString(n);
    }

    /// @dev Matches DeployEnsPlots._farmerFor's deterministic placeholder derivation exactly, so dryRun()'s
    ///      payoutTarget assertion resolves the same farmer EnsBootstrap issued the "2026" slot to.
    function _farmerFor(uint256 index) internal view returns (address) {
        return vm.addr(uint256(keccak256(abi.encodePacked("eth-global-tokyo-issue10-farmer-", index))));
    }
}

/// @notice Thin wrapper so `DeployReelDeal.dryRun()` can bootstrap a self-contained ENS branch + 15 plots/slots
///         (issues #7/#10) by reusing `DeployEnsPlots`'s internals exactly as its own `runWithPlots()` does,
///         without `DeployReelDeal` itself inheriting `DeployEnsBranch`'s non-virtual `run()` (which would
///         collide with `DeployReelDeal`'s own real-broadcast `run()`). Deployed fresh inside `dryRun()` and
///         discarded.
contract EnsBootstrap is DeployEnsPlots {
    function bootstrap() external returns (address karakuwaRegistry, address karakuwaResolver, string memory parentLabel) {
        // The real "umi.eth" is already registered on live Sepolia by the coordinator's separate ENS
        // broadcast (issues #7/#10) -- reusing PARENT_LABEL's default here would revert NameNotAvailable
        // against a live fork. Override it (vm.setEnv, read back by every _parentLabel() call inside
        // runWithPlots()) with a fresh, block-derived label that's guaranteed available on the fork.
        parentLabel = string.concat("umi-dryrun-", vm.toString(block.number), "-", vm.toString(block.timestamp));
        vm.setEnv("PARENT_LABEL", parentLabel);

        this.runWithPlots();
        return (karakuwaRegistryAddr, karakuwaResolverAddr, parentLabel);
    }
}
