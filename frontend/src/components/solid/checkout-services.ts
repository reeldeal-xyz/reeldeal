// Client-side marketplace checkout: connect wallet -> POST /api/market/quote -> JPYC.approve(router, total)
// -> SaleRouter.checkout(quote, signature). Broadcasts real Sepolia transactions from the connected wallet;
// never called from server code. See docs/SALE-ROUTER.md for the full flow this mirrors.
import { createPublicClient, erc20Abi, http } from 'viem';
import { sepolia } from 'viem/chains';
import { DEPLOYED, JPYC, SaleRouterAbi } from '@repo/shared';
import { connectWallet } from '../../lib/chain/wallet.client';

/** JSON-safe mirror of fixtures/market-checkout-demo's DemoListing (bigint doesn't cross the Astro island
 *  hydration boundary) -- the page converts `totalWei` to a string when it renders the CheckoutForm island. */
export interface DemoListingInput {
  listingId: string;
  sellerAddress: string;
  totalWei: string;
  reliefBps: number;
}

export interface QuoteResponseBody {
  quote: {
    orderId: `0x${string}`; listingId: `0x${string}`; buyer: `0x${string}`; seller: `0x${string}`;
    total: string; reliefBps: number; nonce: string; expiry: string;
  };
  signature: `0x${string}`;
  router: `0x${string}`;
}

export type CheckoutStep = 'connecting' | 'checking-availability' | 'quoting' | 'approving' | 'waiting-approval' | 'checking-out' | 'waiting-checkout';

export interface CheckoutResult {
  address: string;
  quote: QuoteResponseBody['quote'];
  approveTxHash?: string;
  checkoutTxHash: string;
}

async function fetchQuote(input: { listingId: string; buyer: string; seller: string; total: string; reliefBps: number }): Promise<QuoteResponseBody> {
  const response = await fetch('/api/market/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'quote-failed' }));
    throw new Error(typeof body?.error === 'string' ? body.error : 'quote-failed');
  }
  return response.json();
}

export async function checkoutDemoListing(listing: DemoListingInput, onStep?: (step: CheckoutStep) => void): Promise<CheckoutResult> {
  onStep?.('connecting');
  const { client, address } = await connectWallet();
  const reader = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com') });

  onStep?.('checking-availability');
  const sold = await reader.readContract({
    address: DEPLOYED.SaleRouter, abi: SaleRouterAbi, functionName: 'soldListings',
    args: [listing.listingId as `0x${string}`],
  });
  if (sold) throw new Error('This demo item has already sold. No payment was requested.');

  onStep?.('quoting');
  const { quote, signature, router } = await fetchQuote({
    listingId: listing.listingId,
    buyer: address,
    seller: listing.sellerAddress,
    total: listing.totalWei,
    reliefBps: listing.reliefBps,
  });
  if (quote.listingId.toLowerCase() !== listing.listingId.toLowerCase()
    || quote.buyer.toLowerCase() !== address.toLowerCase()
    || quote.seller.toLowerCase() !== listing.sellerAddress.toLowerCase()
    || quote.total !== listing.totalWei || quote.reliefBps !== listing.reliefBps
    || router.toLowerCase() !== DEPLOYED.SaleRouter.toLowerCase()) {
    throw new Error('The signed quote does not match this item. No payment was requested.');
  }
  const total = BigInt(quote.total);

  const allowance = await reader.readContract({
    address: JPYC, abi: erc20Abi, functionName: 'allowance', args: [address, DEPLOYED.SaleRouter],
  });
  let approveTxHash: string | undefined;
  if (allowance < total) {
    onStep?.('approving');
    approveTxHash = await client.writeContract({
      account: address,
      chain: sepolia,
      address: JPYC,
      abi: erc20Abi,
      functionName: 'approve',
      args: [DEPLOYED.SaleRouter, total],
    });
    onStep?.('waiting-approval');
    const approval = await reader.waitForTransactionReceipt({ hash: approveTxHash as `0x${string}`, timeout: 180_000 });
    if (approval.status !== 'success') throw new Error('JPYC approval failed on Sepolia. Checkout was not submitted.');
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
  const receipt = await reader.waitForTransactionReceipt({ hash: checkoutTxHash, timeout: 180_000 });
  if (receipt.status !== 'success') throw new Error('Checkout failed on Sepolia. No purchase was confirmed.');

  return { address, quote, approveTxHash, checkoutTxHash };
}
