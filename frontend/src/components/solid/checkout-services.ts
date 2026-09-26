// Client-side marketplace checkout: connect wallet -> POST /api/market/quote (a same-origin proxy to the web
// app, which holds the co-op quote key) -> JPYC.approve(router, total) -> SaleRouter.checkout(quote, signature).
// Broadcasts real Sepolia transactions from the connected wallet; never called from server code.
import { createPublicClient, erc20Abi, fallback, http, parseUnits } from 'viem';
import { sepolia } from 'viem/chains';
import { DEPLOYED, JPYC, SaleRouterAbi } from '@repo/shared';
import { confirmTransaction, connectWallet } from '../../lib/chain/wallet.client';

/** The co-op seller and relief share every quote must carry (web/src/lib/market/listings.ts). */
export const MARKET_SELLER = '0xF0A306A21C44d32C83C4D6a357A4d512B1A48600';
export const MARKET_RELIEF_BPS = 500;

export interface MarketListingInput {
  /** Storefront lot id, lowercased (e.g. "rd-lot-004"). */
  slug: string;
  priceJpy: number;
}

export interface QuoteResponseBody {
  quote: {
    orderId: `0x${string}`; listingId: `0x${string}`; buyer: `0x${string}`; seller: `0x${string}`;
    total: string; reliefBps: number; nonce: string; expiry: string;
  };
  signature: `0x${string}`;
  router: `0x${string}`;
  lot: number;
}

export type CheckoutStep = 'connecting' | 'quoting' | 'approving' | 'waiting-approval' | 'checking-out' | 'waiting-checkout';

export interface CheckoutResult {
  address: string;
  lot: number;
  quote: QuoteResponseBody['quote'];
  relief: bigint;
  approveTxHash?: string;
  checkoutTxHash: string;
}

const QUOTE_ERRORS: Record<string, string> = {
  sold_out: 'This lot has sold out. No payment was requested.',
  quote_signer_not_configured: 'Checkout is unavailable right now. No payment was requested.',
};

async function fetchQuote(slug: string, buyer: string): Promise<QuoteResponseBody> {
  const response = await fetch('/api/market/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ listing: slug, buyer }),
  });
  const body = await response.json().catch(() => ({ error: 'quote_failed' }));
  if (!response.ok) {
    const code = typeof body?.error === 'string' ? body.error : 'quote_failed';
    throw new Error(QUOTE_ERRORS[code] ?? 'Could not get a signed price. No payment was requested.');
  }
  return body as QuoteResponseBody;
}

export async function checkoutListing(listing: MarketListingInput, onStep?: (step: CheckoutStep) => void): Promise<CheckoutResult> {
  onStep?.('connecting');
  const { client, address } = await connectWallet();
  const reader = createPublicClient({
    chain: sepolia,
    transport: fallback([http('https://sepolia.gateway.tenderly.co'), http('https://ethereum-sepolia-rpc.publicnode.com')]),
  });

  onStep?.('quoting');
  const { quote, signature, router, lot } = await fetchQuote(listing.slug, address);
  const expectedTotal = parseUnits(String(listing.priceJpy), 18);
  if (quote.buyer.toLowerCase() !== address.toLowerCase()
    || quote.seller.toLowerCase() !== MARKET_SELLER.toLowerCase()
    || BigInt(quote.total) !== expectedTotal || quote.reliefBps !== MARKET_RELIEF_BPS
    || router.toLowerCase() !== DEPLOYED.SaleRouter.toLowerCase()) {
    throw new Error('The signed price does not match this lot. No payment was requested.');
  }
  const total = BigInt(quote.total);

  const balance = await reader.readContract({ address: JPYC, abi: erc20Abi, functionName: 'balanceOf', args: [address] });
  if (balance < total) throw new Error('Not enough JPYC in this wallet. No payment was requested.');

  const allowance = await reader.readContract({
    address: JPYC, abi: erc20Abi, functionName: 'allowance', args: [address, DEPLOYED.SaleRouter],
  });
  let approveTxHash: string | undefined;
  if (allowance < total) {
    onStep?.('approving');
    approveTxHash = await client.writeContract({
      account: address, chain: sepolia, address: JPYC, abi: erc20Abi, functionName: 'approve', args: [DEPLOYED.SaleRouter, total],
    });
    onStep?.('waiting-approval');
    await confirmTransaction(reader, approveTxHash as `0x${string}`, 'JPYC approval failed on Sepolia. Checkout was not submitted.', 1);
  }

  onStep?.('checking-out');
  const checkoutTxHash = await client.writeContract({
    account: address,
    chain: sepolia,
    address: DEPLOYED.SaleRouter,
    abi: SaleRouterAbi,
    functionName: 'checkout',
    args: [
      {
        orderId: quote.orderId,
        listingId: quote.listingId,
        buyer: quote.buyer,
        seller: quote.seller,
        total,
        reliefBps: quote.reliefBps,
        nonce: BigInt(quote.nonce),
        expiry: BigInt(quote.expiry),
      },
      signature,
    ],
  });

  onStep?.('waiting-checkout');
  await confirmTransaction(reader, checkoutTxHash, 'Checkout failed on Sepolia. No purchase was confirmed.', 1);

  return { address, lot, quote, relief: (total * BigInt(quote.reliefBps)) / 10_000n, approveTxHash, checkoutTxHash };
}
