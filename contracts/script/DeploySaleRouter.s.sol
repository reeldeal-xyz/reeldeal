// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SaleRouter} from "../src/SaleRouter.sol";
import {ISaleRouter, IReliefPoolDonate} from "../src/interfaces/ISaleRouter.sol";

/// @notice Issue #65 (SP-11): deploys `SaleRouter` against the live JPYC and ReliefPool v2 already on
///         Sepolia (packages/shared/src/addresses.ts: `JPYC`, `DEPLOYED.ReliefPool`). Neither is redeployed
///         or modified by this script.
///
///         `quoteSigner` defaults to the COOP_SIGNER address (the same signer role ReliefPool's 2-of-3
///         Trigger set already uses -- see COOP_SIGNER_PRIVATE_KEY in DeployReliefPoolV2.s.sol) via
///         `vm.addr(COOP_SIGNER_PRIVATE_KEY)`, unless QUOTE_SIGNER is set explicitly. `maxReliefBps` defaults
///         to 1000 (10%) unless MAX_RELIEF_BPS is set. Quotes themselves are signed server-side only -- see
///         docs/SALE-ROUTER.md.
///
///         ---------------------------------------------------------------------------------------------
///         DRY RUN (simulates only, never broadcasts -- forks Sepolia and exercises a real end-to-end
///         checkout against the REAL, already-broadcast live JPYC + ReliefPool v2; funds a fresh buyer via
///         `deal`, never prints private keys):
///           forge script contracts/script/DeploySaleRouter.s.sol --sig "dryRun()" --root contracts \
///             --fork-url $SEPOLIA_RPC_URL -vv
///           (loads ../.env for COOP_SIGNER_PRIVATE_KEY/QUOTE_SIGNER/MAX_RELIEF_BPS/SEPOLIA_RPC_URL; falls
///           back to a deterministic default key when COOP_SIGNER_PRIVATE_KEY is unset, exactly like
///           DeployReliefPoolV2.s.sol's `_keyOrDefault` -- dryRun() never needs real keys or funds.)
///
///         REAL BROADCAST (NOT run as part of this PR -- posted here for whoever executes it):
///           forge script contracts/script/DeploySaleRouter.s.sol --sig "run()" --root contracts \
///             --rpc-url $SEPOLIA_RPC_URL --broadcast
///           Required env: DEPLOYER_PRIVATE_KEY. Optional: QUOTE_SIGNER (address; defaults to
///           vm.addr(COOP_SIGNER_PRIVATE_KEY)), COOP_SIGNER_PRIVATE_KEY (only needed to derive that
///           default), MAX_RELIEF_BPS (default 1000).
///         ---------------------------------------------------------------------------------------------
contract DeploySaleRouter is Script, StdCheats {
    // Live Sepolia addresses (docs/ARCHITECTURE.md, packages/shared/src/addresses.ts). Never redeployed here.
    address internal constant JPYC = 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29;
    address internal constant RELIEF_POOL_V2 = 0x560E8404be74DCB7F3877835F374CF1B1B696D32;

    uint16 internal constant DEFAULT_MAX_RELIEF_BPS = 1_000; // 10%

    // Dry-run-only demo actors/quote fixture.
    uint256 internal constant DEMO_TOTAL = 20_000e18; // matches DeployReliefPoolV2's TIER1_HEAT_AMOUNT scale
    uint16 internal constant DEMO_RELIEF_BPS = 500; // 5%

    function _keyOrDefault(string memory envVar, string memory seed) internal view returns (uint256) {
        return vm.envOr(envVar, uint256(keccak256(bytes(seed))));
    }

    /// @dev Same env var (and default seed) DeployReliefPoolV2.s.sol uses for the "coop" signer role --
    ///      QUOTE_SIGNER defaults to this key's address, so the same off-chain signer that already co-signs
    ///      Triggers can also sign sale quotes unless a distinct QUOTE_SIGNER is configured.
    function _coopSignerKey() internal view returns (uint256) {
        return _keyOrDefault("COOP_SIGNER_PRIVATE_KEY", "eth-global-tokyo-issue16-coop-signer-default");
    }

    function _deployerKey() internal view returns (uint256) {
        return _keyOrDefault("DEPLOYER_PRIVATE_KEY", "eth-global-tokyo-issue65-deployer-default");
    }

    function _quoteSigner() internal view returns (address) {
        return vm.envOr("QUOTE_SIGNER", vm.addr(_coopSignerKey()));
    }

    function _maxReliefBps() internal view returns (uint16) {
        return uint16(vm.envOr("MAX_RELIEF_BPS", uint256(DEFAULT_MAX_RELIEF_BPS)));
    }

    /// @notice Real broadcast.
    function run() external {
        uint256 deployerKey = _deployerKey();
        address deployer = vm.addr(deployerKey);
        address quoteSigner = _quoteSigner();
        uint16 maxReliefBps = _maxReliefBps();

        vm.startBroadcast(deployerKey);
        SaleRouter router = new SaleRouter(
            IERC20(JPYC), IReliefPoolDonate(RELIEF_POOL_V2), deployer, quoteSigner, maxReliefBps
        );
        vm.stopBroadcast();

        console2.log("== SaleRouter deploy (issue #65) ==");
        console2.log("export SALE_ROUTER_ADDRESS=", address(router));
        console2.log("quoteSigner:", quoteSigner);
        console2.log("maxReliefBps:", maxReliefBps);
    }

    /// @notice Fork simulation against the REAL, already-broadcast JPYC + ReliefPool v2. Never broadcasts.
    ///         Deploys the router, then runs one real `checkout` end to end: mints the buyer JPYC via
    ///         `deal`, approves the router, signs a demo Quote with the coop-signer key and asserts the
    ///         seller/pool/router balances and the pool's `Donated` memo afterward.
    function dryRun() external {
        uint256 deployerKey = _deployerKey();
        address deployer = vm.addr(deployerKey);
        address quoteSigner = _quoteSigner();
        uint256 quoteSignerKey = _coopSignerKey();
        uint16 maxReliefBps = _maxReliefBps();

        vm.deal(deployer, 1 ether);
        vm.startPrank(deployer);
        SaleRouter router = new SaleRouter(
            IERC20(JPYC), IReliefPoolDonate(RELIEF_POOL_V2), deployer, quoteSigner, maxReliefBps
        );
        vm.stopPrank();

        console2.log("== SaleRouter dryRun (issue #65) ==");
        console2.log("router:", address(router));
        console2.log("quoteSigner:", quoteSigner);

        _verifyCheckout(router, quoteSignerKey);
    }

    function _verifyCheckout(SaleRouter router, uint256 quoteSignerKey) internal {
        address buyer = makeAddr("sale-router-dryrun-buyer");
        address seller = makeAddr("sale-router-dryrun-seller");

        deal(JPYC, buyer, DEMO_TOTAL);
        vm.prank(buyer);
        IERC20(JPYC).approve(address(router), DEMO_TOTAL);

        ISaleRouter.Quote memory q;
        q.orderId = keccak256("sale-router-dryrun-order-1");
        q.listingId = keccak256("sale-router-dryrun-listing-1");
        q.buyer = buyer;
        q.seller = seller;
        q.total = DEMO_TOTAL;
        q.reliefBps = DEMO_RELIEF_BPS;
        q.nonce = 1;
        q.expiry = uint64(block.timestamp + 1 days);

        bytes32 digest = router.quoteDigest(q);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(quoteSignerKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        uint256 poolBalanceBefore = IERC20(JPYC).balanceOf(address(RELIEF_POOL_V2));
        uint256 expectedRelief = (DEMO_TOTAL * DEMO_RELIEF_BPS) / router.BPS_DENOMINATOR();
        uint256 expectedSeller = DEMO_TOTAL - expectedRelief;

        vm.prank(buyer);
        router.checkout(q, sig);

        require(IERC20(JPYC).balanceOf(seller) == expectedSeller, "dryRun: seller did not receive expected share");
        console2.log("OK: seller received expected share:", expectedSeller);

        require(
            IERC20(JPYC).balanceOf(RELIEF_POOL_V2) == poolBalanceBefore + expectedRelief,
            "dryRun: pool did not receive expected relief"
        );
        console2.log("OK: ReliefPool v2 balance increased by expected relief:", expectedRelief);

        require(IERC20(JPYC).balanceOf(address(router)) == 0, "dryRun: router retained JPYC after checkout");
        console2.log("OK: router holds no JPYC after checkout (no custody)");

        require(router.usedOrders(q.orderId), "dryRun: orderId not marked used");
        require(router.soldListings(q.listingId), "dryRun: listingId not marked sold");
        console2.log("OK: orderId/listingId marked used/sold");
        console2.log("Memo correlates as sale:<orderId> -- see the Donated(from=router,...) event above.");
    }
}
