// The Quote is what SaleRouter.checkout verifies (issue #65 / SP-11). Field order and types MUST match
// ISaleRouter.Quote (contracts/src/interfaces/ISaleRouter.sol). Built server-side only, by whoever holds the
// quote-signer key -- see docs/SALE-ROUTER.md. Router address, JPYC, ReliefPool and chainId are NOT quote
// fields; they're bound by the EIP-712 domain (verifyingContract, chainId) and SaleRouter's constructor
// immutables, so a quote signed for one router/pool/chain can never verify against another.
import type { Account, Address, Hex, WalletClient } from 'viem';
import { hashTypedData } from 'viem';
import { CHAIN_ID } from './addresses';

export interface Quote {
  orderId: Hex; // bytes32, unique per order -- prevents order replay
  listingId: Hex; // bytes32, the single-inventory listing being sold -- prevents double-sale
  buyer: Address;
  seller: Address;
  total: bigint; // JPYC, 18 decimals
  reliefBps: number; // uint16, contribution rate snapshotted at signing time; router enforces <= its configured max
  nonce: bigint; // uint256, per-buyer anti-replay nonce, independent of orderId/listingId
  expiry: bigint; // unix seconds
}

export const QUOTE_EIP712_TYPES = {
  Quote: [
    { name: 'orderId', type: 'bytes32' },
    { name: 'listingId', type: 'bytes32' },
    { name: 'buyer', type: 'address' },
    { name: 'seller', type: 'address' },
    { name: 'total', type: 'uint256' },
    { name: 'reliefBps', type: 'uint16' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
  ],
} as const;

export const saleRouterEip712Domain = (verifyingContract: Address, chainId: number = CHAIN_ID) =>
  ({ name: 'SaleRouter', version: '1', chainId, verifyingContract }) as const;

/** Pure EIP-712 digest for `quote` under `verifyingContract`'s domain -- mirrors SaleRouter.quoteDigest. */
export const quoteDigest = (verifyingContract: Address, quote: Quote): Hex =>
  hashTypedData({
    domain: saleRouterEip712Domain(verifyingContract),
    types: QUOTE_EIP712_TYPES,
    primaryType: 'Quote',
    message: quote,
  });

/**
 * Signs `quote` for SaleRouter at `verifyingContract`. Server-side only -- the signing key must be
 * SaleRouter's configured `quoteSigner`; never expose it to the client. See docs/SALE-ROUTER.md for the
 * full checkout flow.
 */
export async function signSaleQuote(
  client: WalletClient,
  account: Account | Address,
  verifyingContract: Address,
  quote: Quote,
): Promise<Hex> {
  return client.signTypedData({
    account,
    domain: saleRouterEip712Domain(verifyingContract),
    types: QUOTE_EIP712_TYPES,
    primaryType: 'Quote',
    message: quote,
  });
}
