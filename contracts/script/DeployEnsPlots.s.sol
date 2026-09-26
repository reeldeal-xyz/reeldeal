// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {console2} from "forge-std/Script.sol";
import {
    Grant,
    IEACGrantInitializable,
    IUserRegistryWrite,
    IPermissionedResolverWrite,
    RegistryRoles
} from "./ens/EnsV2.sol";
import {DeployEnsBranch} from "./DeployEnsBranch.s.sol";

/// @notice Issue #10 — per-plot ENSv2 registries and expiring, non-transferable "2026" season slots, under
///         the karakuwa branch issue #7 deploys. Subclasses `DeployEnsBranch` to reuse `_commit`/`_finish`
///         (parent + branch registration) for a fully self-contained dry run, and reads back
///         `karakuwaRegistryAddr`/`karakuwaResolverAddr` (populated by `_finish`) rather than re-deriving
///         them.
///
///         Layout per plot (15 total: 8 scallop, 4 hoya, 3 oyster — issue #16's counts):
///           - `p1213-NNN.karakuwa.<parent>.eth` registered directly on the karakuwa branch registry:
///             owner = the plot's licence holder, subregistry = a fresh per-plot `UserRegistry` proxy,
///             resolver = the shared karakuwa branch `PermissionedResolver` (its `setText` role scoping is
///             by text *key* only — `resource(key) = keccak256(key)` — not by name/node, so issue #7's
///             science-key grant for `zone`/`species` already covers every plot for free), roleBitmap 0
///             (the holder gets no admin rights on this branch-level entry; their rights live one level
///             down, see next). Text records `zone`/`species` (science key, or deployer here at bootstrap)
///             and `area`/`unit` (deployer only — the science key was never granted those keys).
///           - The plot's own per-plot `UserRegistry`: `initialize` grants the holder `ROLE_REGISTRAR |
///             ROLE_UNREGISTER | ROLE_RENEW` on `ROOT_RESOURCE` (plain role bits, no `_ADMIN` variants — the
///             holder registers/unregisters/renews season slots directly, but can never re-delegate those
///             rights to anyone else).
///           - Season slot `"2026"` registered by the holder on the plot's own registry: owner = farmer,
///             subregistry/resolver = `address(0)` (a slot is a leaf — no further records/subnames),
///             roleBitmap 0, expiry 2027-03-31T23:59:59Z. roleBitmap 0 means the farmer never holds
///             `RegistryRolesLib.ROLE_CAN_TRANSFER_ADMIN`, so `PermissionedRegistry._update` reverts
///             `TransferDisallowed` on any transfer of that token — non-transferable, by construction, not
///             by convention. Expiry is ENSv2's own field: once elapsed, `findOwner`/`findExpiry` on the
///             plot registry return zero/an elapsed timestamp on their own (see `IEnsV2.sol`).
///           - Revoke: the holder holds `ROLE_UNREGISTER` on the plot registry's `ROOT_RESOURCE`, and
///             `EnhancedAccessControl` treats root roles as effective on every resource in that registry
///             (`_effectiveRoles = rootRoles | resourceRoles`) — so the holder can `unregister("2026")`
///             even though the farmer, not the holder, is the token's nominal owner. See
///             `contracts/test/fork/EnsPlotsAndSlots.fork.t.sol` for the fork-tested proof of both the
///             transfer revert and the unregister-then-zero-owner behaviour.
///
///         Demo simplification: ONE co-op licence-holder wallet across all 15 plots (real per-plot holders
///         are out of scope for the hackathon demo; nothing here prevents issuing each plot to a distinct
///         holder later). Farmer wallets are deterministic placeholders — issue #19's holder screen
///         (`register("2026", farmer, ...)` / `unregister`) is how a holder reassigns a slot to a real
///         LIFF-linked wallet after this initial seed.
///
///         Fallback A (per issue #10, if per-plot `VerifiableFactory` proxies turn out to be
///         impractical under real broadcast gas/salt constraints): register sibling names
///         `2026-p1213-NNN.karakuwa.<parent>.eth` directly on the branch registry instead of nesting a
///         season slot inside a per-plot registry. Not implemented — the primary design above was fork
///         tested successfully; documented here only so issue #16 knows the escape hatch exists.
///
///         ---------------------------------------------------------------------------------------------
///         DRY RUN (simulates only, never broadcasts — full stack: parent + branch + 15 plots + slots):
///           forge script contracts/script/DeployEnsPlots.s.sol --sig "runWithPlots()" \
///             --fork-url $SEPOLIA_RPC_URL -vvv
///
///         REAL BROADCAST (not run by this task) — step 3 of the ordered sequence, after
///         `DeployEnsBranch.s.sol`'s `commitParent()` / (wait) / `finishAfterCommit()`:
///           forge script contracts/script/DeployEnsPlots.s.sol --sig "deployPlotsAndSlots()" \
///             --rpc-url $SEPOLIA_RPC_URL --broadcast
///           (requires env KARAKUWA_REGISTRY, KARAKUWA_RESOLVER, PARENT_LABEL — all printed by
///           `finishAfterCommit()`)
///         ---------------------------------------------------------------------------------------------
contract DeployEnsPlots is DeployEnsBranch {
    uint256 internal constant PLOT_COUNT = 15;
    string internal constant ZONE = "karakuwa-east";
    string internal constant SEASON_LABEL = "2026";

    /// @dev 2027-03-31T23:59:59Z — end of the "2026" fiscal year (1 Apr 2026 - 31 Mar 2027, per
    ///      docs/INTERFACE.md), computed offline (`date -u -j -f "%Y-%m-%dT%H:%M:%SZ" ...`).
    uint64 internal constant SEASON_SLOT_EXPIRY = 1_806_537_599;

    /// @dev Plot licences themselves don't expire on the same cadence as a season slot; long-dated so this
    ///      demo never has to worry about a plot's own branch-level registration lapsing.
    uint64 internal constant PLOT_LICENCE_DURATION = 3650 days;

    // Fallback dry-run key, same pattern/provenance as DEFAULT_DEPLOYER_KEY/DEFAULT_SCIENCE_KEY in
    // DeployEnsBranch.s.sol: keccak256(seed), confirmed to hold no code on Sepolia as of 2026-09-26.
    //   holder: keccak256("eth-global-tokyo-issue10-plot-holder-default") -> 0x22c9A47a689Ce23f83930ee03c23e1a6CCbC6Dc1
    uint256 internal constant DEFAULT_HOLDER_KEY = 0xb5b1f7b4dba22f6065b3813f15ecf878fd235589ad654ff293af24c7d7132716;

    function _holderKey() internal view returns (uint256) {
        return vm.envOr("HOLDER_PRIVATE_KEY", DEFAULT_HOLDER_KEY);
    }

    function _startAsHolder(uint256 holderKey, address holder) internal {
        if (broadcastMode) {
            vm.startBroadcast(holderKey);
        } else {
            vm.startPrank(holder);
        }
    }

    // ------------------------------------------------------------------
    // Entrypoints
    // ------------------------------------------------------------------

    /// @notice Full stack in one simulated run: parent + karakuwa branch (inherited `run()` body) then all
    ///         15 plots + "2026" slots. Dry-run only (`--fork-url`, no `--broadcast`).
    function runWithPlots() external {
        uint256 deployerKey = _deployerKey();
        address deployer = vm.addr(deployerKey);
        vm.deal(deployer, 10 ether);

        address parentRegistry = _commit(deployerKey, deployer);
        vm.warp(block.timestamp + _ethRegistrar().MIN_COMMITMENT_AGE() + 1);
        _finish(deployerKey, deployer, parentRegistry);

        uint256 holderKey = _holderKey();
        address holder = vm.addr(holderKey);
        vm.deal(holder, 1 ether);

        _deployPlotsAndSlots(deployerKey, deployer, holderKey, holder, _parentLabel(), karakuwaRegistryAddr, karakuwaResolverAddr);
    }

    /// @notice Real broadcast, step 3 (after `DeployEnsBranch.s.sol`'s `commitParent()` /
    ///         `finishAfterCommit()`). Requires `KARAKUWA_REGISTRY`/`KARAKUWA_RESOLVER` env (printed by
    ///         `finishAfterCommit()`) and `PARENT_LABEL` (same value used for the parent registration).
    function deployPlotsAndSlots() external {
        broadcastMode = true;
        uint256 deployerKey = _deployerKey();
        address deployer = vm.addr(deployerKey);
        vm.deal(deployer, 10 ether);

        uint256 holderKey = _holderKey();
        address holder = vm.addr(holderKey);
        vm.deal(holder, 1 ether);

        address karakuwaRegistry = vm.envAddress("KARAKUWA_REGISTRY");
        address karakuwaResolver = vm.envAddress("KARAKUWA_RESOLVER");
        string memory parentLabel = _parentLabel();

        _deployPlotsAndSlots(deployerKey, deployer, holderKey, holder, parentLabel, karakuwaRegistry, karakuwaResolver);
    }

    // ------------------------------------------------------------------
    // Plot + slot deployment
    // ------------------------------------------------------------------
    function _deployPlotsAndSlots(
        uint256 deployerKey,
        address deployer,
        uint256 holderKey,
        address holder,
        string memory parentLabel,
        address karakuwaRegistry,
        address karakuwaResolver
    ) internal {
        for (uint256 i = 0; i < PLOT_COUNT; ++i) {
            string memory plotLabel = _plotLabel(i);
            string memory species = _speciesFor(i);
            address farmer = _farmerFor(i);

            // 1. Per-plot UserRegistry: holder gets REGISTRAR | UNREGISTER | RENEW on ROOT_RESOURCE only
            //    (no admin variants -- holder acts directly, never re-delegates).
            Grant[] memory plotGrants = new Grant[](1);
            plotGrants[0] = Grant({
                account: holder,
                roleBitmap: RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_UNREGISTER | RegistryRoles.ROLE_RENEW
            });
            bytes memory plotInit = abi.encodeCall(IEACGrantInitializable.initialize, (plotGrants));

            _startAsDeployer(deployerKey, deployer);
            address plotRegistry = _verifiableFactory().deployProxy(
                _userRegistryImpl(), uint256(keccak256(abi.encodePacked(parentLabel, plotLabel, "registry"))), plotInit
            );
            _stopActing();

            // 2. Register the plot on the karakuwa branch registry: owner = holder, subregistry =
            //    plotRegistry, resolver = shared branch resolver, roleBitmap 0.
            _startAsDeployer(deployerKey, deployer);
            IUserRegistryWrite(karakuwaRegistry).register(
                plotLabel, holder, plotRegistry, karakuwaResolver, 0, uint64(block.timestamp) + PLOT_LICENCE_DURATION
            );
            _stopActing();

            // 3. Bootstrap zone/species/area/unit (the science key can also set zone/species later --
            //    issue #7's grant is scoped by key, not by name, so it already covers this plot).
            bytes memory plotName = _dnsEncodePlot(plotLabel, parentLabel);
            _startAsDeployer(deployerKey, deployer);
            IPermissionedResolverWrite(karakuwaResolver).setText(plotName, "zone", ZONE);
            IPermissionedResolverWrite(karakuwaResolver).setText(plotName, "species", species);
            IPermissionedResolverWrite(karakuwaResolver).setText(plotName, "area", _demoArea(i));
            IPermissionedResolverWrite(karakuwaResolver).setText(plotName, "unit", "1");
            _stopActing();

            // 4. Holder issues the "2026" season slot to a demo farmer -- non-transferable (roleBitmap 0),
            //    expiring (SEASON_SLOT_EXPIRY). Real assignment happens later via issue #19's holder screen.
            _startAsHolder(holderKey, holder);
            IUserRegistryWrite(plotRegistry).register(SEASON_LABEL, farmer, address(0), address(0), 0, SEASON_SLOT_EXPIRY);
            _stopActing();

            console2.log(string.concat("Plot ", plotLabel, " (", species, ") per-plot registry:"), plotRegistry);
            console2.log(string.concat("  season ", SEASON_LABEL, " slot farmer:"), farmer);
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /// @dev 1-based plot numbering: index 0 -> "p1213-001" .. index 14 -> "p1213-015".
    function _plotLabel(uint256 index) internal view returns (string memory) {
        return string.concat("p1213-", _pad3(index + 1));
    }

    function _pad3(uint256 n) internal view returns (string memory) {
        if (n < 10) return string.concat("00", vm.toString(n));
        if (n < 100) return string.concat("0", vm.toString(n));
        return vm.toString(n);
    }

    /// @dev Issue #16's counts: 8 scallop (p1213-001..008), 4 hoya (p1213-009..012), 3 oyster
    ///      (p1213-013..015).
    function _speciesFor(uint256 index) internal pure returns (string memory) {
        if (index < 8) return "scallop";
        if (index < 12) return "hoya";
        return "oyster";
    }

    /// @dev Deterministic demo placeholder farmer wallets -- reassigned for real via issue #19.
    function _farmerFor(uint256 index) internal view returns (address) {
        return vm.addr(uint256(keccak256(abi.encodePacked("eth-global-tokyo-issue10-farmer-", index))));
    }

    /// @dev Purely informational display metadata (not read by ReliefPool); varies per plot for realism.
    function _demoArea(uint256 index) internal view returns (string memory) {
        return string.concat(vm.toString(800 + index * 50), "sqm");
    }

    function _dnsEncodePlot(string memory plotLabel, string memory parentLabel) internal pure returns (bytes memory) {
        return abi.encodePacked(
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
    }
}
