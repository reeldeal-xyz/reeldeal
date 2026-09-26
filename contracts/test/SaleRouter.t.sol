// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {SaleRouter} from "../src/SaleRouter.sol";
import {ISaleRouter, IReliefPoolDonate} from "../src/interfaces/ISaleRouter.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import {ERC20Reentrant} from "@openzeppelin/contracts/mocks/token/ERC20Reentrant.sol";
import {MockReliefPool} from "./mocks/MockReliefPool.sol";
import {MockRevertingReliefPool} from "./mocks/MockRevertingReliefPool.sol";
import {RevertingERC20} from "./mocks/RevertingERC20.sol";

/// @notice Issue #65 (SP-11): SaleRouter.checkout -- signed-quote verification, exact 18-decimal splits and
///         rounding, replay/double-sale guards, atomic-failure behavior on both legs, and admin controls.
///         Live integration against real JPYC + ReliefPool v2 is the fork dryRun in
///         contracts/script/DeploySaleRouter.s.sol, not this file.
contract SaleRouterTest is Test {
    ERC20Mock internal jpyc;
    MockReliefPool internal pool;
    SaleRouter internal router;

    address internal admin = makeAddr("admin");
    address internal buyer;
    uint256 internal buyerKey;
    address internal seller = makeAddr("seller");
    address internal quoteSigner;
    uint256 internal quoteSignerKey;
    address internal outsider;
    uint256 internal outsiderKey;

    uint16 internal constant MAX_RELIEF_BPS = 1_000; // 10%, matches DeploySaleRouter default

    function setUp() public {
        vm.warp(1_700_000_000);

        jpyc = new ERC20Mock();
        pool = new MockReliefPool(IERC20(address(jpyc)));

        (buyer, buyerKey) = makeAddrAndKey("buyer");
        (quoteSigner, quoteSignerKey) = makeAddrAndKey("quoteSigner");
        (outsider, outsiderKey) = makeAddrAndKey("outsider");

        router = new SaleRouter(
            IERC20(address(jpyc)), IReliefPoolDonate(address(pool)), admin, quoteSigner, MAX_RELIEF_BPS
        );

        jpyc.mint(buyer, 10_000_000e18);
        vm.prank(buyer);
        jpyc.approve(address(router), type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    function _quote(bytes32 orderId, uint256 total, uint16 reliefBps, uint256 nonce)
        internal
        view
        returns (ISaleRouter.Quote memory q)
    {
        q.orderId = orderId;
        q.listingId = keccak256(abi.encode("listing", orderId));
        q.buyer = buyer;
        q.seller = seller;
        q.total = total;
        q.reliefBps = reliefBps;
        q.nonce = nonce;
        q.expiry = uint64(block.timestamp + 1 days);
    }

    function _sign(uint256 key, ISaleRouter.Quote memory q) internal view returns (bytes memory) {
        bytes32 digest = router.quoteDigest(q);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _checkout(ISaleRouter.Quote memory q, uint256 signerKey) internal {
        bytes memory sig = _sign(signerKey, q);
        vm.prank(q.buyer);
        router.checkout(q, sig);
    }

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------
    function test_constructor_revertsOnZeroAddresses() public {
        vm.expectRevert(ISaleRouter.ZeroAddress.selector);
        new SaleRouter(IERC20(address(0)), IReliefPoolDonate(address(pool)), admin, quoteSigner, MAX_RELIEF_BPS);

        vm.expectRevert(ISaleRouter.ZeroAddress.selector);
        new SaleRouter(IERC20(address(jpyc)), IReliefPoolDonate(address(0)), admin, quoteSigner, MAX_RELIEF_BPS);

        vm.expectRevert(ISaleRouter.ZeroAddress.selector);
        new SaleRouter(IERC20(address(jpyc)), IReliefPoolDonate(address(pool)), address(0), quoteSigner, MAX_RELIEF_BPS);

        vm.expectRevert(ISaleRouter.ZeroAddress.selector);
        new SaleRouter(IERC20(address(jpyc)), IReliefPoolDonate(address(pool)), admin, address(0), MAX_RELIEF_BPS);
    }

    function test_constructor_revertsWhenMaxReliefBpsExceedsCeiling() public {
        vm.expectRevert(abi.encodeWithSelector(ISaleRouter.MaxReliefBpsTooHigh.selector, uint16(10_001), uint16(10_000)));
        new SaleRouter(IERC20(address(jpyc)), IReliefPoolDonate(address(pool)), admin, quoteSigner, 10_001);
    }

    function test_eip712Domain_matchesRouter() public view {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            router.eip712Domain();
        assertEq(name, "SaleRouter");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(router));
    }

    // ---------------------------------------------------------------------
    // Happy path: exact 18-decimal splits + rounding table
    // ---------------------------------------------------------------------
    function test_checkout_splitsExactlyAndEmitsCheckout() public {
        ISaleRouter.Quote memory q = _quote(keccak256("order-1"), 20_000e18, 1_000, 1); // 10% relief

        vm.expectEmit(true, true, true, true, address(router));
        emit ISaleRouter.Checkout(q.orderId, q.listingId, buyer, seller, 20_000e18, 18_000e18, 2_000e18, 1_000);
        _checkout(q, quoteSignerKey);

        assertEq(jpyc.balanceOf(seller), 18_000e18);
        assertEq(jpyc.balanceOf(address(pool)), 2_000e18);
        assertEq(jpyc.balanceOf(address(router)), 0);
        assertEq(jpyc.balanceOf(buyer), 10_000_000e18 - 20_000e18);
        assertEq(pool.lastAmount(), 2_000e18);
        assertEq(pool.lastFrom(), address(router));
        assertEq(pool.lastMemo(), string.concat("sale:", _toHex(q.orderId)));
        assertTrue(router.usedOrders(q.orderId));
        assertTrue(router.soldListings(q.listingId));
    }

    /// @notice Rounding is defined once, floor(total * reliefBps / 10_000); seller always gets the exact
    ///         remainder so sellerAmount + reliefAmount == total, never checked separately here -- it's true
    ///         by construction and this table just pins the concrete numbers.
    function test_checkout_roundingTable() public {
        // 10_001 * 1000 / 10_000 = 1000.1 -> floors to 1000; seller gets the remaining 9001.
        {
            ISaleRouter.Quote memory q = _quote(keccak256("round-1"), 10_001, 1_000, 1);
            _checkout(q, quoteSignerKey);
            assertEq(jpyc.balanceOf(seller), 9_001);
            assertEq(jpyc.balanceOf(address(pool)), 1_000);
        }
        // total=1, reliefBps=1 -> 1*1/10000 floors to 0: relief rounds away entirely, donate is skipped
        // (ReliefPool.donate reverts on 0), seller still gets the full 1 wei -- checkout must still succeed.
        {
            ISaleRouter.Quote memory q = _quote(keccak256("round-2"), 1, 1, 2);
            uint256 donateCountBefore = pool.donateCallCount();
            _checkout(q, quoteSignerKey);
            assertEq(jpyc.balanceOf(seller), 9_001 + 1);
            assertEq(pool.donateCallCount(), donateCountBefore); // no new donate call
        }
        // reliefBps=0 on an otherwise-valid quote: no relief at all, 100% to seller.
        {
            ISaleRouter.Quote memory q = _quote(keccak256("round-3"), 5_000e18, 0, 3);
            uint256 sellerBefore = jpyc.balanceOf(seller);
            _checkout(q, quoteSignerKey);
            assertEq(jpyc.balanceOf(seller), sellerBefore + 5_000e18);
        }
        // exact multiple: total=1_000_000e18, reliefBps=1000 (10%) -> relief=100_000e18 exactly.
        {
            ISaleRouter.Quote memory q = _quote(keccak256("round-4"), 1_000_000e18, 1_000, 4);
            uint256 poolBefore = jpyc.balanceOf(address(pool));
            _checkout(q, quoteSignerKey);
            assertEq(jpyc.balanceOf(address(pool)) - poolBefore, 100_000e18);
        }
        assertEq(jpyc.balanceOf(address(router)), 0);
    }

    function _toHex(bytes32 value) internal pure returns (string memory) {
        bytes memory HEX = "0123456789abcdef";
        bytes memory buf = new bytes(66);
        buf[0] = "0";
        buf[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            buf[2 + i * 2] = HEX[uint8(value[i]) >> 4];
            buf[3 + i * 2] = HEX[uint8(value[i]) & 0xf];
        }
        return string(buf);
    }

    // ---------------------------------------------------------------------
    // Insufficient allowance / balance
    // ---------------------------------------------------------------------
    function test_checkout_revertsOnInsufficientAllowance() public {
        vm.prank(buyer);
        jpyc.approve(address(router), 1e18); // less than total below

        ISaleRouter.Quote memory q = _quote(keccak256("order-allow"), 20_000e18, 1_000, 1);
        bytes memory sig = _sign(quoteSignerKey, q);
        vm.prank(buyer);
        vm.expectRevert();
        router.checkout(q, sig);
    }

    function test_checkout_revertsOnInsufficientBalance() public {
        address poorBuyer;
        uint256 poorBuyerKey;
        (poorBuyer, poorBuyerKey) = makeAddrAndKey("poorBuyer");
        vm.prank(poorBuyer);
        jpyc.approve(address(router), type(uint256).max);

        ISaleRouter.Quote memory q = _quote(keccak256("order-poor"), 20_000e18, 1_000, 1);
        q.buyer = poorBuyer;
        bytes memory sig = _sign(quoteSignerKey, q);
        vm.prank(poorBuyer);
        vm.expectRevert();
        router.checkout(q, sig);
    }

    // ---------------------------------------------------------------------
    // Atomic failure: seller transfer fails, and donate fails -- both revert everything
    // ---------------------------------------------------------------------
    function test_checkout_revertsAtomically_whenSellerTransferFails() public {
        RevertingERC20 badToken = new RevertingERC20();
        MockReliefPool badPool = new MockReliefPool(IERC20(address(badToken)));
        SaleRouter badRouter =
            new SaleRouter(IERC20(address(badToken)), IReliefPoolDonate(address(badPool)), admin, quoteSigner, MAX_RELIEF_BPS);

        badToken.mint(buyer, 20_000e18);
        vm.prank(buyer);
        badToken.approve(address(badRouter), type(uint256).max);
        badToken.setBlockedTransferTo(seller);

        ISaleRouter.Quote memory q = _quote(keccak256("order-badseller"), 20_000e18, 1_000, 1);
        bytes32 digest = badRouter.quoteDigest(q);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(quoteSignerKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        uint256 buyerBalanceBefore = badToken.balanceOf(buyer);
        vm.prank(buyer);
        vm.expectRevert();
        badRouter.checkout(q, sig);

        // Nothing moved: the pull-in from the buyer was rolled back along with the failed seller payment.
        assertEq(badToken.balanceOf(buyer), buyerBalanceBefore);
        assertEq(badToken.balanceOf(address(badRouter)), 0);
        assertFalse(badRouter.usedOrders(q.orderId));
    }

    function test_checkout_revertsAtomically_whenDonateFails() public {
        MockRevertingReliefPool badPool = new MockRevertingReliefPool();
        SaleRouter badRouter =
            new SaleRouter(IERC20(address(jpyc)), IReliefPoolDonate(address(badPool)), admin, quoteSigner, MAX_RELIEF_BPS);

        jpyc.mint(buyer, 20_000e18);
        vm.prank(buyer);
        jpyc.approve(address(badRouter), type(uint256).max);

        ISaleRouter.Quote memory q = _quote(keccak256("order-baddonate"), 20_000e18, 1_000, 1);
        bytes32 digest = badRouter.quoteDigest(q);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(quoteSignerKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        uint256 buyerBalanceBefore = jpyc.balanceOf(buyer);
        uint256 sellerBalanceBefore = jpyc.balanceOf(seller);
        vm.prank(buyer);
        vm.expectRevert();
        badRouter.checkout(q, sig);

        // The seller payment that happened earlier in the same call is rolled back too -- nothing is
        // half-settled when the later donate() call fails.
        assertEq(jpyc.balanceOf(buyer), buyerBalanceBefore);
        assertEq(jpyc.balanceOf(seller), sellerBalanceBefore);
        assertEq(jpyc.balanceOf(address(badRouter)), 0);
        assertFalse(badRouter.usedOrders(q.orderId));
    }

    // ---------------------------------------------------------------------
    // Replay / double-sale
    // ---------------------------------------------------------------------
    function test_checkout_revertsOnDuplicateOrder() public {
        ISaleRouter.Quote memory q = _quote(keccak256("order-dup"), 20_000e18, 1_000, 1);
        bytes memory sig = _sign(quoteSignerKey, q); // precomputed: expectRevert must target the checkout call, not _sign's view call
        vm.prank(buyer);
        router.checkout(q, sig);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(ISaleRouter.OrderAlreadyUsed.selector, q.orderId));
        router.checkout(q, sig);
    }

    function test_checkout_revertsOnDoubleSaleOfListing_withFreshOrder() public {
        ISaleRouter.Quote memory q1 = _quote(keccak256("order-a"), 20_000e18, 1_000, 1);
        _checkout(q1, quoteSignerKey);

        // Fresh orderId + nonce, but the same listingId (single-inventory item already sold).
        ISaleRouter.Quote memory q2 = _quote(keccak256("order-b"), 20_000e18, 1_000, 2);
        q2.listingId = q1.listingId;
        bytes memory sig2 = _sign(quoteSignerKey, q2); // precomputed for the same reason as above

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(ISaleRouter.ListingAlreadySold.selector, q2.listingId));
        router.checkout(q2, sig2);
    }

    // ---------------------------------------------------------------------
    // Authentication: wrong buyer, wrong signer, tampered fields, expired
    // ---------------------------------------------------------------------
    function test_checkout_revertsOnWrongBuyer() public {
        ISaleRouter.Quote memory q = _quote(keccak256("order-wrongbuyer"), 20_000e18, 1_000, 1);
        bytes memory sig = _sign(quoteSignerKey, q);

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(ISaleRouter.WrongBuyer.selector, outsider, buyer));
        router.checkout(q, sig);
    }

    function test_checkout_revertsOnWrongSigner() public {
        ISaleRouter.Quote memory q = _quote(keccak256("order-wrongsigner"), 20_000e18, 1_000, 1);
        bytes memory sig = _sign(outsiderKey, q); // signed by a non-designated key

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(ISaleRouter.InvalidSigner.selector, outsider, quoteSigner));
        router.checkout(q, sig);
    }

    /// @notice Sweeps every Quote field: tampering any one after signing must invalidate the signature.
    function test_checkout_revertsWhenAnyFieldTamperedAfterSigning() public {
        // orderId
        {
            ISaleRouter.Quote memory q = _quote(keccak256("tamper-1"), 20_000e18, 1_000, 1);
            bytes memory sig = _sign(quoteSignerKey, q);
            q.orderId = keccak256("tampered-order");
            vm.prank(buyer);
            vm.expectRevert();
            router.checkout(q, sig);
        }
        // listingId
        {
            ISaleRouter.Quote memory q = _quote(keccak256("tamper-2"), 20_000e18, 1_000, 1);
            bytes memory sig = _sign(quoteSignerKey, q);
            q.listingId = keccak256("tampered-listing");
            vm.prank(buyer);
            vm.expectRevert(); // recovered signer differs; exact address is non-deterministic to assert generically
            router.checkout(q, sig);
        }
        // seller
        {
            ISaleRouter.Quote memory q = _quote(keccak256("tamper-3"), 20_000e18, 1_000, 1);
            bytes memory sig = _sign(quoteSignerKey, q);
            q.seller = outsider;
            vm.prank(buyer);
            vm.expectRevert();
            router.checkout(q, sig);
        }
        // total
        {
            ISaleRouter.Quote memory q = _quote(keccak256("tamper-4"), 20_000e18, 1_000, 1);
            bytes memory sig = _sign(quoteSignerKey, q);
            q.total = q.total + 1;
            vm.prank(buyer);
            vm.expectRevert();
            router.checkout(q, sig);
        }
        // reliefBps (tampered down so it stays <= maxReliefBps, isolating InvalidSigner from ReliefBpsExceedsMax)
        {
            ISaleRouter.Quote memory q = _quote(keccak256("tamper-5"), 20_000e18, 1_000, 1);
            bytes memory sig = _sign(quoteSignerKey, q);
            q.reliefBps = q.reliefBps - 1;
            vm.prank(buyer);
            vm.expectRevert();
            router.checkout(q, sig);
        }
        // nonce
        {
            ISaleRouter.Quote memory q = _quote(keccak256("tamper-6"), 20_000e18, 1_000, 1);
            bytes memory sig = _sign(quoteSignerKey, q);
            q.nonce = q.nonce + 1;
            vm.prank(buyer);
            vm.expectRevert();
            router.checkout(q, sig);
        }
        // expiry (tampered further into the future, so it's still not Expired)
        {
            ISaleRouter.Quote memory q = _quote(keccak256("tamper-7"), 20_000e18, 1_000, 1);
            bytes memory sig = _sign(quoteSignerKey, q);
            q.expiry = q.expiry + 1 days;
            vm.prank(buyer);
            vm.expectRevert();
            router.checkout(q, sig);
        }
    }

    function test_checkout_revertsWhenExpired() public {
        ISaleRouter.Quote memory q = _quote(keccak256("order-expired"), 20_000e18, 1_000, 1);
        q.expiry = uint64(block.timestamp - 1);
        bytes memory sig = _sign(quoteSignerKey, q);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(ISaleRouter.QuoteExpired.selector, q.expiry, uint64(block.timestamp)));
        router.checkout(q, sig);
    }

    function test_checkout_revertsOnZeroTotal() public {
        ISaleRouter.Quote memory q = _quote(keccak256("order-zero"), 0, 1_000, 1);
        bytes memory sig = _sign(quoteSignerKey, q);

        vm.prank(buyer);
        vm.expectRevert(ISaleRouter.ZeroAmount.selector);
        router.checkout(q, sig);
    }

    // ---------------------------------------------------------------------
    // Relief-rate configuration
    // ---------------------------------------------------------------------
    function test_checkout_revertsWhenReliefBpsExceedsMax() public {
        ISaleRouter.Quote memory q = _quote(keccak256("order-toohigh"), 20_000e18, MAX_RELIEF_BPS + 1, 1);
        bytes memory sig = _sign(quoteSignerKey, q);

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(ISaleRouter.ReliefBpsExceedsMax.selector, MAX_RELIEF_BPS + 1, MAX_RELIEF_BPS)
        );
        router.checkout(q, sig);
    }

    function test_checkout_revertsWhenMaxReliefBpsUnconfigured() public {
        SaleRouter freshRouter =
            new SaleRouter(IERC20(address(jpyc)), IReliefPoolDonate(address(pool)), admin, quoteSigner, 0);
        vm.prank(buyer);
        jpyc.approve(address(freshRouter), type(uint256).max);

        ISaleRouter.Quote memory q = _quote(keccak256("order-unconfigured"), 20_000e18, 0, 1);
        bytes32 digest = freshRouter.quoteDigest(q);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(quoteSignerKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(buyer);
        vm.expectRevert(ISaleRouter.ReliefBpsNotConfigured.selector);
        freshRouter.checkout(q, sig);
    }

    // ---------------------------------------------------------------------
    // Reentrancy
    // ---------------------------------------------------------------------
    function test_checkout_reentrancyBlocked() public {
        ERC20Reentrant evilToken = new ERC20Reentrant();
        MockReliefPool evilPool = new MockReliefPool(IERC20(address(evilToken)));
        SaleRouter evilRouter =
            new SaleRouter(IERC20(address(evilToken)), IReliefPoolDonate(address(evilPool)), admin, quoteSigner, MAX_RELIEF_BPS);

        deal(address(evilToken), buyer, 20_000e18);
        vm.prank(buyer);
        evilToken.approve(address(evilRouter), type(uint256).max);

        ISaleRouter.Quote memory q = _quote(keccak256("order-reentrant"), 20_000e18, 1_000, 1);
        bytes32 digest = evilRouter.quoteDigest(q);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(quoteSignerKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        // Reenter checkout (same quote/signature) from within the token's transferFrom hook.
        bytes memory reentrantCall = abi.encodeCall(SaleRouter.checkout, (q, sig));
        evilToken.scheduleReenter(ERC20Reentrant.Type.Before, address(evilRouter), reentrantCall);

        vm.prank(buyer);
        vm.expectRevert(); // ReentrancyGuard's ReentrancyGuardReentrantCall, bubbled up through the token call
        evilRouter.checkout(q, sig);
    }

    // ---------------------------------------------------------------------
    // Pause
    // ---------------------------------------------------------------------
    function test_checkout_revertsWhenPaused() public {
        vm.prank(admin);
        router.pause();

        ISaleRouter.Quote memory q = _quote(keccak256("order-paused"), 20_000e18, 1_000, 1);
        bytes memory sig = _sign(quoteSignerKey, q);

        vm.prank(buyer);
        vm.expectRevert();
        router.checkout(q, sig);
    }

    function test_pause_onlyAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), bytes32(0))
        );
        router.pause();
    }

    // ---------------------------------------------------------------------
    // Admin setters
    // ---------------------------------------------------------------------
    function test_setQuoteSigner_onlyAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), bytes32(0))
        );
        router.setQuoteSigner(outsider);
    }

    function test_setQuoteSigner_updatesAndRevertsOnZero() public {
        vm.prank(admin);
        router.setQuoteSigner(outsider);
        assertEq(router.quoteSigner(), outsider);

        vm.prank(admin);
        vm.expectRevert(ISaleRouter.ZeroAddress.selector);
        router.setQuoteSigner(address(0));
    }

    function test_setMaxReliefBps_onlyAdminAndCeiling() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), bytes32(0))
        );
        router.setMaxReliefBps(500);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ISaleRouter.MaxReliefBpsTooHigh.selector, uint16(10_001), uint16(10_000)));
        router.setMaxReliefBps(10_001);

        vm.prank(admin);
        router.setMaxReliefBps(500);
        assertEq(router.maxReliefBps(), 500);
    }
}
