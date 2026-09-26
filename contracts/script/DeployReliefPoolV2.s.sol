// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHumanRegistry} from "../src/interfaces/IHumanRegistry.sol";
import {IPlotResolver} from "../src/interfaces/IPlotResolver.sol";
import {ISlotResolver} from "../src/interfaces/ISlotResolver.sol";
import {IReliefPool} from "../src/interfaces/IReliefPool.sol";
import {ReliefPool} from "../src/ReliefPool.sol";

/// @notice Issue #55 -- Trigger v2 (`tempC`) redeploy. Deploys ONLY a new `ReliefPool`, reusing the live
///         `HumanRegistry` and ENSv2 adapters (`EnsPlotResolver`/`EnsSlotResolver`) exactly as they are today
///         -- neither is redeployed, so existing World ID bindings and the `umi.eth`/`karakuwa` ENS branch
///         and its 15 plots/slots survive untouched.
///
///         This is the only thing that changes: the v1 `ReliefPool` at
///         `packages/shared/src/addresses.ts`'s `DEPLOYED.ReliefPool` (0x803D06AA8b1C1E6Bb1418f586328faDE877aFe9F)
///         hashes the pre-tempC `Trigger` shape under EIP-712 domain version "1"; this script's pool hashes
///         the v2 shape (`tempC` inserted just before `dataHash`, matching `packages/shared/src/trigger.ts`)
///         under domain version "2", so a v1 signature can never verify here and vice versa.
///
///         Ordering: HumanRegistry + the ENS adapters must already be live (repo-root `.env`:
///         HUMAN_REGISTRY_ADDRESS, ENS_PLOT_RESOLVER_ADAPTER, ENS_SLOT_RESOLVER_ADAPTER -- current values
///         mirrored in `packages/shared/src/addresses.ts`'s `DEPLOYED`). `run()` reads them and never
///         touches HumanRegistry, ENS or any pre-existing plot/slot registration.
///
///         Yen amounts are unchanged from `DeployReelDeal.s.sol`'s `_setTierAmounts`, for every (species,
///         tier) pair `RULES` (packages/shared/src/rules.ts) still declares: scallop tier 1 Y20,000/unit,
///         scallop tier 2 Y50,000/unit total (20,000 + 30,000, pro-rata fixed at attestation), hoya tier 1
///         Y20,000/unit, oyster/scallop toxin-ban Y10,000/unit. `RULES` declares no (species, tier) pair
///         beyond `DeployReelDeal`'s set -- nothing new to document. Only the peril id collapses from three
///         (HEAT24/HEAT25/HEAT26) to one (`HEAT`); the temperature that used to live in the peril id now
///         lives in `Trigger.tempC` and is carried by the rule, not the on-chain `tierAmounts` key.
///
///         ---------------------------------------------------------------------------------------------
///         DRY RUN (simulates only, never broadcasts -- forks Sepolia and reads the REAL, already-broadcast
///         HumanRegistry/ENS adapters/plots/slots; asserts payoutTarget + a fallback-signed v2 Trigger attest):
///           forge script contracts/script/DeployReliefPoolV2.s.sol --sig "dryRun()" --root contracts \
///             --fork-url $SEPOLIA_RPC_URL -vv
///           (loads ../.env for HUMAN_REGISTRY_ADDRESS/ENS_PLOT_RESOLVER_ADAPTER/ENS_SLOT_RESOLVER_ADAPTER/
///           SEPOLIA_RPC_URL; never prints private keys -- dryRun() never needs real ones, see _keyOrDefault)
///
///         REAL BROADCAST (NOT run as part of issue #55's redeploy PR -- posted here for whoever executes it):
///           forge script contracts/script/DeployReliefPoolV2.s.sol --sig "run()" --root contracts \
///             --rpc-url $SEPOLIA_RPC_URL --broadcast
///           Required env: DEPLOYER_PRIVATE_KEY, PIPELINE_SIGNER_PRIVATE_KEY, COOP_SIGNER_PRIVATE_KEY,
///           SCIENCE_KEY_PRIVATE_KEY, HUMAN_REGISTRY_ADDRESS, ENS_PLOT_RESOLVER_ADAPTER,
///           ENS_SLOT_RESOLVER_ADAPTER. Optional: DONATION_JPYC (default 200000e18). The deployer must
///           already hold at least DONATION_JPYC real JPYC (faucet.jpyc.co.jp) -- this script cannot mint it.
///         ---------------------------------------------------------------------------------------------
contract DeployReliefPoolV2 is Script, StdCheats {
    // Real JPYC on Sepolia (docs/ARCHITECTURE.md, packages/shared/src/addresses.ts). 18 decimals.
    address internal constant JPYC = 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29;

    string internal constant SEASON_LABEL = "2026";
    uint256 internal constant PLOT_COUNT = 15;

    /// @dev Same amounts as DeployReelDeal.s.sol -- see contract NatSpec.
    uint256 internal constant TIER1_HEAT_AMOUNT = 20_000e18;
    uint256 internal constant TIER2_HEAT_AMOUNT = 50_000e18;
    uint256 internal constant TOXIN_AMOUNT = 10_000e18;

    /// @dev Default seed donation if DONATION_JPYC is unset.
    uint256 internal constant DEFAULT_DONATION = 200_000e18;
    string internal constant DONATION_MEMO = "Reel Deal seed donation (v2)";

    bytes32 internal constant SPECIES_SCALLOP = keccak256("scallop");
    bytes32 internal constant SPECIES_HOYA = keccak256("hoya");
    bytes32 internal constant SPECIES_OYSTER = keccak256("oyster");
    bytes32 internal constant PERIL_HEAT = keccak256("HEAT");
    bytes32 internal constant PERIL_BANWEEKS = keccak256("BANWEEKS");
    bytes32 internal constant ZONE_KARAKUWA_EAST = keccak256("karakuwa-east");

    /// @dev dryRun()'s fallback-signed demo Trigger mirrors RULES' scallop tier 1 HEAT rule exactly
    ///      (packages/shared/src/rules.ts: `{ species: 'scallop', tier: 1, peril: 'HEAT', tempC: 25,
    ///      threshold: 14, window: HEAT_WINDOW }`) -- the same rule web/src/lib/keeper's fallback trigger
    ///      builder would use to set `tempC` when it can't reach the pipeline feed.
    uint8 internal constant DEMO_TEMP_C = 25;
    uint32 internal constant DEMO_THRESHOLD = 14;

    // The live season-slot holder for p1213-001/"2026" on the real umi.eth/karakuwa ENS branch (issue #55).
    address internal constant EXPECTED_PLOT1_FARMER = 0x1aEDC8476f15BdF1Ac742544c58Be3a187eEAB51;

    // ------------------------------------------------------------------
    // Env-or-default private keys. Real .env values always take precedence (vm.envOr); these fallbacks only
    // matter for a from-scratch dryRun() with no .env at all -- dryRun() never broadcasts or needs real
    // funds/keys (vm.deal + vm.startPrank), so the defaults are enough to exercise the whole flow.
    // ------------------------------------------------------------------
    function _keyOrDefault(string memory envVar, string memory seed) internal view returns (uint256) {
        return vm.envOr(envVar, uint256(keccak256(bytes(seed))));
    }

    function _deployerKey() internal view returns (uint256) {
        return _keyOrDefault("DEPLOYER_PRIVATE_KEY", "eth-global-tokyo-issue55-deployer-default");
    }

    /// @dev Same env vars (and default seeds) as DeployReelDeal.s.sol: the pipeline/coop/science signer
    ///      *roles* carry over to the v2 pool unchanged, only the contract they sign against is new.
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
    struct DeployParams {
        uint256 deployerKey;
        uint256 pipelineSignerKey;
        uint256 coopSignerKey;
        uint256 scienceSignerKey;
        address humanRegistry;
        address plotResolver;
        address slotResolver;
        uint256 donationAmount;
        bool broadcast;
    }

    function _signerKeys() internal view returns (uint256, uint256, uint256, uint256) {
        return (_deployerKey(), _pipelineSignerKey(), _coopSignerKey(), _scienceSignerKey());
    }

    /// @dev HUMAN_REGISTRY_ADDRESS/ENS_PLOT_RESOLVER_ADAPTER/ENS_SLOT_RESOLVER_ADAPTER, already broadcast
    ///      and live -- this script never deploys or modifies any of the three.
    function _liveAddresses() internal view returns (address humanRegistry, address plotResolver, address slotResolver) {
        humanRegistry = vm.envAddress("HUMAN_REGISTRY_ADDRESS");
        plotResolver = vm.envAddress("ENS_PLOT_RESOLVER_ADAPTER");
        slotResolver = vm.envAddress("ENS_SLOT_RESOLVER_ADAPTER");
    }

    /// @notice Real broadcast. Requires HumanRegistry + ENS adapters already deployed (see contract NatSpec).
    function run() external {
        DeployParams memory p;
        (p.deployerKey, p.pipelineSignerKey, p.coopSignerKey, p.scienceSignerKey) = _signerKeys();
        (p.humanRegistry, p.plotResolver, p.slotResolver) = _liveAddresses();
        p.donationAmount = vm.envOr("DONATION_JPYC", DEFAULT_DONATION);
        p.broadcast = true;

        _deployPool(p);
    }

    /// @notice Fork simulation against the REAL, already-broadcast HumanRegistry/ENS adapters/plots/slots.
    ///         Never broadcasts. See contract NatSpec for the exact command.
    function dryRun() external {
        DeployParams memory p;
        (p.deployerKey, p.pipelineSignerKey, p.coopSignerKey, p.scienceSignerKey) = _signerKeys();
        (p.humanRegistry, p.plotResolver, p.slotResolver) = _liveAddresses();
        p.donationAmount = vm.envOr("DONATION_JPYC", DEFAULT_DONATION);
        p.broadcast = false;

        ReliefPool pool = _deployPool(p);
        _verify(pool, p);
    }

    // ------------------------------------------------------------------
    // Core deploy, shared by run()/dryRun(). `broadcast == true` uses vm.startBroadcast (real, run() only);
    // `broadcast == false` uses vm.startPrank + `deal`s the deployer JPYC first, so dryRun() exercises the
    // real approve+donate path against a fork instead of `deal`ing the pool directly.
    // ------------------------------------------------------------------
    function _deployPool(DeployParams memory p) internal returns (ReliefPool pool) {
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

        pool = new ReliefPool(
            IERC20(JPYC),
            IHumanRegistry(p.humanRegistry),
            IPlotResolver(p.plotResolver),
            ISlotResolver(p.slotResolver),
            deployer
        );
        uint256 deployBlock = block.number;

        address[] memory signerSet = new address[](3);
        signerSet[0] = vm.addr(p.pipelineSignerKey);
        signerSet[1] = vm.addr(p.coopSignerKey);
        signerSet[2] = vm.addr(p.scienceSignerKey);
        pool.setSigners(signerSet, 2);

        _setTierAmounts(pool);

        for (uint256 i = 0; i < PLOT_COUNT; ++i) {
            pool.enroll(_plotLabel(i));
        }

        if (p.donationAmount > 0) {
            IERC20(JPYC).approve(address(pool), p.donationAmount);
            pool.donate(p.donationAmount, DONATION_MEMO);
        }

        if (p.broadcast) {
            vm.stopBroadcast();
        } else {
            vm.stopPrank();
        }

        console2.log("== ReliefPool v2 (Trigger.tempC, #55) deploy ==");
        console2.log("export RELIEF_POOL_ADDRESS=", address(pool));
        console2.log("export RELIEF_POOL_DEPLOY_BLOCK=", deployBlock);
    }

    /// @dev Same (peril, species, tier) set and Y amounts as DeployReelDeal._setTierAmounts -- only the
    ///      HEAT* peril ids collapse to one PERIL_HEAT (the temperature moved into Trigger.tempC).
    ///      unitCap[1]=3 / unitCap[2]=12 and claimWindow=90 days already match ReliefPool's constructor
    ///      defaults -- no setUnitCap/setClaimWindow calls needed.
    function _setTierAmounts(ReliefPool pool) internal {
        pool.setTierAmount(PERIL_HEAT, SPECIES_SCALLOP, 1, TIER1_HEAT_AMOUNT);
        pool.setTierAmount(PERIL_HEAT, SPECIES_SCALLOP, 2, TIER2_HEAT_AMOUNT);
        pool.setTierAmount(PERIL_HEAT, SPECIES_HOYA, 1, TIER1_HEAT_AMOUNT);
        pool.setTierAmount(PERIL_BANWEEKS, SPECIES_OYSTER, 1, TOXIN_AMOUNT);
        pool.setTierAmount(PERIL_BANWEEKS, SPECIES_SCALLOP, 1, TOXIN_AMOUNT);
    }

    // ------------------------------------------------------------------
    // Plot labels -- mirrors DeployEnsPlots._plotLabel/_pad3 exactly. Plots/slots already exist on the live
    // ENS branch; enroll() only caches their zone/species into the new pool, it registers nothing on ENS.
    // ------------------------------------------------------------------
    function _plotLabel(uint256 index) internal view returns (string memory) {
        return string.concat("p1213-", _pad3(index + 1));
    }

    function _pad3(uint256 n) internal view returns (string memory) {
        if (n < 10) return string.concat("00", vm.toString(n));
        if (n < 100) return string.concat("0", vm.toString(n));
        return vm.toString(n);
    }

    // ------------------------------------------------------------------
    // dryRun() assertions
    // ------------------------------------------------------------------
    function _verify(ReliefPool pool, DeployParams memory p) internal {
        require(pool.signerThreshold() == 2, "dryRun: signerThreshold != 2");
        console2.log("OK: signerThreshold == 2");

        for (uint256 i = 0; i < PLOT_COUNT; ++i) {
            (,, bool enrolled) = pool.plots(_plotLabel(i));
            require(enrolled, "dryRun: plot not enrolled");
        }
        console2.log("OK: all 15 plots enrolled");

        uint256 poolBalance = IERC20(JPYC).balanceOf(address(pool));
        require(poolBalance == p.donationAmount, "dryRun: pool JPYC balance != donation");
        console2.log("OK: pool JPYC balance == donation:", poolBalance);

        (address farmer,, uint64 slotExpiry) = pool.payoutTarget("p1213-001", SEASON_LABEL);
        require(farmer == EXPECTED_PLOT1_FARMER, "dryRun: payoutTarget(p1213-001, 2026) resolved an unexpected farmer");
        require(slotExpiry > block.timestamp, "dryRun: resolved slot already expired");
        console2.log("OK: payoutTarget(p1213-001, 2026) resolves the live farmer:", farmer);

        _attestFallbackTrigger(pool, p);
    }

    /// @dev Builds and attests a v2 Trigger the same way web/src/lib/keeper's fallback trigger builder would
    ///      for RULES' scallop tier 1 HEAT rule (tempC 25, threshold 14) -- zone/species/peril ids, `tempC`
    ///      set from the rule, window/deadline relative to the fork's current block.timestamp so this never
    ///      goes stale. Signs it 2-of-3 with the pipeline+coop signer keys and calls `attest`, proving the
    ///      full v2 EIP-712 pipeline (domain version "2", `tempC` hashed just before `dataHash`) end-to-end
    ///      against the freshly deployed pool.
    function _attestFallbackTrigger(ReliefPool pool, DeployParams memory p) internal {
        IReliefPool.Trigger memory t;
        t.zoneId = ZONE_KARAKUWA_EAST;
        t.speciesId = SPECIES_SCALLOP;
        t.perilId = PERIL_HEAT;
        t.tier = 1;
        t.seasonLabel = SEASON_LABEL;
        t.windowStart = uint64(block.timestamp - 100 days);
        t.windowEnd = uint64(block.timestamp - 1 days);
        t.firedAt = uint64(block.timestamp - 2 days);
        t.index = DEMO_THRESHOLD;
        t.threshold = DEMO_THRESHOLD;
        t.tempC = DEMO_TEMP_C;
        t.dataHash = keccak256("dryRun-fallback-trigger");
        t.deadline = uint64(block.timestamp + 365 days);

        bytes32 digest = pool.triggerDigest(t);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(p.pipelineSignerKey, digest);
        sigs[1] = _sign(p.coopSignerKey, digest);

        vm.startPrank(vm.addr(p.deployerKey));
        bytes32 eventId = pool.attest(t, sigs);
        vm.stopPrank();

        (,, , , , , uint64 attestedAt,) = pool.attestations(eventId);
        require(attestedAt != 0, "dryRun: fallback-signed v2 trigger did not attest");
        console2.log("OK: fallback-signed v2 Trigger (tempC=25) attested, eventId:");
        console2.logBytes32(eventId);
    }

    function _sign(uint256 key, bytes32 digest) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
