import { createPublicClient, erc20Abi, fallback, http, recoverTypedDataAddress, type Address, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { DEPLOYED, JPYC, QUOTE_EIP712_TYPES, SaleRouterAbi, getListing, saleRouterEip712Domain, serializeQuote, splitSale } from '@repo/shared';
import { confirmTransaction, connectWallet } from '../../lib/chain/wallet.client';
import { parseMarketQuote } from '../../lib/market-quote';
import { hasMatchingCheckout } from '../../lib/market-proof';

export { MARKET_SELLER, MARKET_RELIEF_BPS } from '@repo/shared';
export interface MarketListingInput { slug: string; priceJpy: number }
export type CheckoutStep = 'connecting' | 'quoting' | 'approving' | 'waiting-approval' | 'checking-out' | 'waiting-checkout';
export interface CheckoutResult {
  address: string; lot: number; quote: ReturnType<typeof serializeQuote>; relief: bigint;
  approveTxHash?: string; checkoutTxHash: string;
}
type Pending = { hash: Hex; response: unknown; buyer: Address; quotedAt: number; listing: string };
const storageKey = 'reeldeal:pending-market-checkout';
let pending: Pending | null = null;
let busy = false;
export function pendingPurchase(): Pending | null {
  if (pending) return pending;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    const listing = saved && getListing(saved.listing);
    if (listing && typeof saved.hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(saved.hash)
      && Number.isFinite(saved.quotedAt) && saved.quotedAt <= Date.now() / 1000) {
      parseMarketQuote(saved.response, listing, saved.buyer, saved.quotedAt);
      pending = saved;
    }
  } catch { /* Recovery data never authorizes a new payment. */ }
  return pending;
}
const clearPending = () => { pending = null; try { localStorage.removeItem(storageKey); } catch {} };

export async function checkoutListing(input: MarketListingInput, onStep?: (step: CheckoutStep) => void): Promise<CheckoutResult> {
  if (busy) throw new Error('Another purchase is in progress.');
  const listing = getListing(input.slug);
  if (!listing || listing.priceYen !== input.priceJpy) throw new Error('Listing price changed. Reload before purchasing.');
  const retained = pendingPurchase();
  if (retained && retained.listing !== listing.slug) throw new Error(`Check the pending ${getListing(retained.listing)?.name ?? 'purchase'} before buying another item.`);
  busy = true;
  const reader = createPublicClient({ chain: sepolia, transport: fallback([
    http('https://sepolia.gateway.tenderly.co', { timeout: 10_000, retryCount: 0 }),
    http('https://ethereum-sepolia-rpc.publicnode.com', { timeout: 10_000, retryCount: 0 }),
  ]) });
  const confirm = async (submitted: Pending): Promise<CheckoutResult> => {
    const { quote, lot } = parseMarketQuote(submitted.response, listing, submitted.buyer, submitted.quotedAt);
    onStep?.('waiting-checkout');
    await confirmTransaction(reader, submitted.hash, 'Purchase reverted. No purchase completed.', 2);
    const receipt = await reader.getTransactionReceipt({ hash: submitted.hash });
    if (!hasMatchingCheckout(receipt, quote)) throw new Error('Purchase receipt could not be verified.');
    clearPending();
    return { address: submitted.buyer, lot, quote: serializeQuote(quote), relief: splitSale(quote.total, quote.reliefBps).relief, checkoutTxHash: submitted.hash };
  };
  try {
    if (retained) return await confirm(retained);
    onStep?.('connecting');
    const wallet = await connectWallet();
    onStep?.('quoting');
    const response = await fetch('/api/market/quote', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ listing: listing.slug, buyer: wallet.address }), signal: AbortSignal.timeout(20_000), redirect: 'error' });
    if (!response.ok) throw new Error(response.status === 409 ? 'This lot has sold out.' : 'Checkout unavailable. No payment sent.');
    const raw = await response.text();
    if (raw.length > 8192) throw new Error('Invalid quote response.');
    const body: unknown = JSON.parse(raw), quotedAt = Date.now() / 1000;
    const { quote, signature } = parseMarketQuote(body, listing, wallet.address, quotedAt);
    const [signer, expectedSigner, balance, allowance] = await Promise.all([
      recoverTypedDataAddress({ domain: saleRouterEip712Domain(DEPLOYED.SaleRouter), types: QUOTE_EIP712_TYPES, primaryType: 'Quote', message: quote, signature }),
      reader.readContract({ address: DEPLOYED.SaleRouter, abi: SaleRouterAbi, functionName: 'quoteSigner' }),
      reader.readContract({ address: JPYC, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.address] }),
      reader.readContract({ address: JPYC, abi: erc20Abi, functionName: 'allowance', args: [wallet.address, DEPLOYED.SaleRouter] }),
    ]);
    if (signer.toLowerCase() !== expectedSigner.toLowerCase()) throw new Error('Invalid quote signature. No payment sent.');
    if (balance < quote.total) throw new Error('Not enough JPYC. No payment sent.');
    let approveTxHash: Hex | undefined;
    if (allowance < quote.total) {
      onStep?.('approving');
      approveTxHash = await wallet.client.writeContract({ account: wallet.address, chain: sepolia, address: JPYC, abi: erc20Abi,
        functionName: 'approve', args: [DEPLOYED.SaleRouter, quote.total] });
      onStep?.('waiting-approval');
      await confirmTransaction(reader, approveTxHash, 'Approval reverted. No payment sent.', 2);
    }
    if (quote.expiry < BigInt(Math.floor(Date.now() / 1000) + 15)) throw new Error('Quote expired. Review the purchase again.');
    const current = await connectWallet();
    if (current.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Wallet changed. Review the purchase again.');
    const { request } = await reader.simulateContract({ address: DEPLOYED.SaleRouter, abi: SaleRouterAbi, functionName: 'checkout', args: [quote, signature], account: current.address });
    onStep?.('checking-out');
    const hash = await current.client.writeContract(request);
    pending = { hash, response: body, buyer: current.address, quotedAt, listing: listing.slug };
    try { localStorage.setItem(storageKey, JSON.stringify(pending)); } catch {}
    return { ...await confirm(pending), approveTxHash };
  } catch (error) {
    if (pending) {
      const receipt = await reader.getTransactionReceipt({ hash: pending.hash }).catch(() => null);
      if (receipt?.status === 'reverted') clearPending();
      else throw new Error('Confirmation pending. Check this transaction before starting another purchase.');
    }
    throw error;
  } finally { busy = false; }
}
