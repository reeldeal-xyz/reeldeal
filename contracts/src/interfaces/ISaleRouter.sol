// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Atomic marketplace checkout: pulls a JPYC-denominated quote `total` from the buyer, pays the
///         seller their share and contributes the quote's relief share to `ReliefPool.donate` in the same
///         transaction. Field order of Quote MUST match packages/shared/src/quote.ts (EIP-712 type) --
///         see SaleRouter.sol.
interface ISaleRouter {
    /// @dev The router address (EIP-712 verifyingContract), the JPYC token, the ReliefPool and chainId are
    ///      NOT quote fields -- they're bound by the router's EIP-712 domain (verifyingContract, chainId)
    ///      and its constructor immutables (jpyc, pool), so a quote signed for one router/pool/chain can
    ///      never verify against another.
    struct Quote {
        bytes32 orderId; // app-level order identifier; unique per order, prevents order replay
        bytes32 listingId; // the single-inventory listing being sold; prevents double-sale
        address buyer;
        address seller;
        uint256 total; // JPYC, 18 decimals
        uint16 reliefBps; // contribution rate snapshotted into the quote at signing time; router enforces <= maxReliefBps
        uint256 nonce; // per-buyer anti-replay nonce, independent of orderId/listingId
        uint64 expiry; // unix seconds
    }

    event Checkout(
        bytes32 indexed orderId,
        bytes32 indexed listingId,
        address indexed buyer,
        address seller,
        uint256 total,
        uint256 sellerAmount,
        uint256 reliefAmount,
        uint16 reliefBps
    );
    event QuoteSignerUpdated(address indexed signer);
    event MaxReliefBpsUpdated(uint16 maxReliefBps);

    error ZeroAddress();
    error ZeroAmount();
    error QuoteExpired(uint64 expiry, uint64 nowTs);
    error WrongBuyer(address caller, address buyer);
    error ReliefBpsNotConfigured();
    error ReliefBpsExceedsMax(uint16 reliefBps, uint16 maxReliefBps);
    error MaxReliefBpsTooHigh(uint16 attempted, uint16 ceiling);
    error InvalidSigner(address recovered, address expected);
    error OrderAlreadyUsed(bytes32 orderId);
    error ListingAlreadySold(bytes32 listingId);
    error NonceAlreadyUsed(address buyer, uint256 nonce);
    error BalanceInvariantViolated(uint256 before, uint256 afterBalance);

    function checkout(Quote calldata q, bytes calldata signature) external;
    function quoteDigest(Quote calldata q) external view returns (bytes32);
    function setQuoteSigner(address newSigner) external;
    function setMaxReliefBps(uint16 newMax) external;
    function pause() external;
    function unpause() external;
}

/// @notice Minimal interface SaleRouter needs from ReliefPool -- exactly the one function it calls
///         (`donate`). Keeping this narrow (rather than depending on the full IReliefPool) lets tests
///         substitute a trivial mock pool (e.g. one that always reverts) without implementing ReliefPool's
///         entire surface, and keeps SaleRouter's dependency on ReliefPool's ABI minimal.
interface IReliefPoolDonate {
    function donate(uint256 amount, string calldata memo) external;
}
