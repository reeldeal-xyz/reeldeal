// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ISaleRouter, IReliefPoolDonate} from "./interfaces/ISaleRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Issue #65 (SP-11): atomic JPYC purchase + ReliefPool contribution. `checkout` verifies a
///         server-signed EIP-712 `Quote`, pulls `total` JPYC from the buyer, pays the seller their share and
///         donates the relief share to ReliefPool -- all three token movements in one transaction, or none
///         of them (a revert in any leg reverts the whole call; this contract never swallows a sub-call's
///         failure).
///
///         Router never holds JPYC across transactions: every `total` pulled in a `checkout` is fully paid
///         back out (sellerAmount to the seller, reliefAmount to the pool) before the call returns --
///         `sellerAmount + reliefAmount == q.total` exactly (relief rounds down, seller gets the remainder),
///         enforced by construction (`sellerAmount = q.total - reliefAmount`) and double-checked by the
///         balance invariant below.
///
///         Quote binds orderId/listingId/buyer/seller/total/reliefBps/nonce/expiry (see ISaleRouter.Quote);
///         router address, JPYC, ReliefPool and chainId are bound via the EIP-712 domain (verifyingContract,
///         chainId) and this contract's immutables, not quote fields -- a quote can never verify against a
///         different router/pool/chain. Field order MUST match packages/shared/src/quote.ts.
contract SaleRouter is ISaleRouter, AccessControl, EIP712, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @dev Denominator for `reliefBps` (10_000 == 100%); also the hard ceiling `setMaxReliefBps` accepts.
    uint16 public constant BPS_DENOMINATOR = 10_000;

    bytes32 private constant QUOTE_TYPEHASH = keccak256(
        "Quote(bytes32 orderId,bytes32 listingId,address buyer,address seller,uint256 total,uint16 reliefBps,uint256 nonce,uint64 expiry)"
    );

    // ---------------------------------------------------------------------
    // Immutables
    // ---------------------------------------------------------------------
    IERC20 public immutable jpyc;
    IReliefPoolDonate public immutable pool;

    // ---------------------------------------------------------------------
    // Admin-configured
    // ---------------------------------------------------------------------
    /// @notice The only address whose signature `checkout` accepts over a Quote digest. Server-side only --
    ///         see docs/SALE-ROUTER.md.
    address public quoteSigner;

    /// @notice Ceiling `checkout` enforces against `q.reliefBps`. Zero disables checkout entirely (issue
    ///         #65 acceptance: "missing rate/configuration disables checkout") -- the individual quote's
    ///         rate is trusted (it's signed by `quoteSigner`), the router's job is only to cap it and to
    ///         refuse to operate at all when no cap has ever been configured.
    uint16 public maxReliefBps;

    // ---------------------------------------------------------------------
    // Replay / double-sale guards
    // ---------------------------------------------------------------------
    mapping(bytes32 orderId => bool used) public usedOrders;
    mapping(bytes32 listingId => bool sold) public soldListings;
    mapping(address buyer => mapping(uint256 nonce => bool used)) public usedNonces;

    constructor(IERC20 jpyc_, IReliefPoolDonate pool_, address admin_, address quoteSigner_, uint16 maxReliefBps_)
        EIP712("SaleRouter", "1")
    {
        if (
            admin_ == address(0) || quoteSigner_ == address(0) || address(jpyc_) == address(0)
                || address(pool_) == address(0)
        ) {
            revert ZeroAddress();
        }
        if (maxReliefBps_ > BPS_DENOMINATOR) revert MaxReliefBpsTooHigh(maxReliefBps_, BPS_DENOMINATOR);

        jpyc = jpyc_;
        pool = pool_;
        quoteSigner = quoteSigner_;
        maxReliefBps = maxReliefBps_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);

        emit QuoteSignerUpdated(quoteSigner_);
        emit MaxReliefBpsUpdated(maxReliefBps_);
    }

    // ---------------------------------------------------------------------
    // Checkout
    // ---------------------------------------------------------------------

    /// @notice Verifies `q` was signed by `quoteSigner`, then atomically: pulls `q.total` JPYC from
    ///         `q.buyer`, pays `q.seller` their share, and (if the relief share rounds to a nonzero amount)
    ///         donates it to `pool` with memo `"sale:<orderId>"` (0x-prefixed, lowercase, 32-byte hex --
    ///         matches how the app represents `bytes32 Hex` values). Reverts leave every balance untouched:
    ///         no `try`/`catch` is used anywhere in this function, so a revert in ANY sub-call (the pull, the
    ///         seller payment, the pool's `forceApprove`+`donate`) unwinds the entire transaction per normal
    ///         EVM/Solidity semantics.
    /// @dev Check ordering: cheap stateless checks (expiry, caller, relief config) before the ECDSA recover,
    ///      then the anti-replay/double-sale checks (which also double as CEI -- `usedOrders`/`soldListings`
    ///      are written before any external call), then the transfers.
    function checkout(Quote calldata q, bytes calldata signature) external nonReentrant whenNotPaused {
        _validate(q, signature);
        (uint256 sellerAmount, uint256 reliefAmount) = _settle(q);
        emit Checkout(q.orderId, q.listingId, q.buyer, q.seller, q.total, sellerAmount, reliefAmount, q.reliefBps);
    }

    /// @dev Split from `checkout` (and from `_settle` below) only to keep each function's stack shallow
    ///      enough for the legacy codegen (`Stack too deep` otherwise) -- not a separable unit on its own;
    ///      every check here still runs, in order, before any external call in `_settle`.
    function _validate(Quote calldata q, bytes calldata signature) internal {
        if (q.total == 0) revert ZeroAmount();
        if (block.timestamp > q.expiry) revert QuoteExpired(q.expiry, uint64(block.timestamp));
        if (msg.sender != q.buyer) revert WrongBuyer(msg.sender, q.buyer);

        uint16 maxBps = maxReliefBps;
        if (maxBps == 0) revert ReliefBpsNotConfigured();
        if (q.reliefBps > maxBps) revert ReliefBpsExceedsMax(q.reliefBps, maxBps);

        address signer = ECDSA.recover(quoteDigest(q), signature);
        if (signer != quoteSigner) revert InvalidSigner(signer, quoteSigner);

        if (usedOrders[q.orderId]) revert OrderAlreadyUsed(q.orderId);
        if (soldListings[q.listingId]) revert ListingAlreadySold(q.listingId);
        if (usedNonces[q.buyer][q.nonce]) revert NonceAlreadyUsed(q.buyer, q.nonce);
        usedOrders[q.orderId] = true;
        soldListings[q.listingId] = true;
        usedNonces[q.buyer][q.nonce] = true;
    }

    /// @dev The token movements: pull `q.total`, pay the seller their share, donate the relief share.
    ///      Rounding rule (defined once, here): relief rounds DOWN, seller gets the exact remainder, so
    ///      sellerAmount + reliefAmount == q.total always holds by construction, never by a separate check.
    ///      No `try`/`catch` anywhere -- a revert in any sub-call unwinds this whole call (and `checkout`'s).
    function _settle(Quote calldata q) internal returns (uint256 sellerAmount, uint256 reliefAmount) {
        reliefAmount = (q.total * q.reliefBps) / BPS_DENOMINATOR;
        sellerAmount = q.total - reliefAmount;

        uint256 balanceBefore = jpyc.balanceOf(address(this));

        jpyc.safeTransferFrom(q.buyer, address(this), q.total);
        jpyc.safeTransfer(q.seller, sellerAmount);

        if (reliefAmount > 0) {
            // A tiny `total` can floor reliefAmount to 0 even with reliefBps > 0; ReliefPool.donate reverts
            // on a zero amount, so skip the call rather than fail an otherwise-valid sale over a rounding
            // artifact -- no Donated event is emitted for that sale's relief leg in that case.
            jpyc.forceApprove(address(pool), reliefAmount);
            pool.donate(reliefAmount, string.concat("sale:", Strings.toHexString(uint256(q.orderId), 32)));
        }

        // No fund custody after checkout: everything pulled in this call must have been paid back out.
        uint256 balanceAfter = jpyc.balanceOf(address(this));
        if (balanceAfter != balanceBefore) revert BalanceInvariantViolated(balanceBefore, balanceAfter);
    }

    /// @notice EIP-712 digest for `q` under this router's domain {name: "SaleRouter", version: "1", chainId:
    ///         block.chainid, verifyingContract: address(this)}; the server-side quote signer signs this
    ///         exact digest to produce the `signature` passed to `checkout`.
    function quoteDigest(Quote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(_hashQuote(q));
    }

    function _hashQuote(Quote calldata q) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                QUOTE_TYPEHASH, q.orderId, q.listingId, q.buyer, q.seller, q.total, q.reliefBps, q.nonce, q.expiry
            )
        );
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------
    function setQuoteSigner(address newSigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newSigner == address(0)) revert ZeroAddress();
        quoteSigner = newSigner;
        emit QuoteSignerUpdated(newSigner);
    }

    function setMaxReliefBps(uint16 newMax) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newMax > BPS_DENOMINATOR) revert MaxReliefBpsTooHigh(newMax, BPS_DENOMINATOR);
        maxReliefBps = newMax;
        emit MaxReliefBpsUpdated(newMax);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
