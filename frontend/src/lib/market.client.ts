import { createPublicClient, erc20Abi, http, parseUnits, recoverTypedDataAddress, type Address, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { DEPLOYED, JPYC, JPYC_DECIMALS, QUOTE_EIP712_TYPES, SaleRouterAbi, getListing, saleRouterEip712Domain, splitSale } from '@repo/shared';
import { confirmTransaction, connectWallet, sepoliaTxUrl } from './chain/wallet.client';
import { formatAmount, jpycFromBaseUnits } from './format-amount';
import { parseMarketQuote } from './market-quote';
import { hasMatchingCheckout } from './market-proof';

export function initMarketCheckout() {
  const dialog = document.querySelector<HTMLDialogElement>('#market-checkout');
  if (!dialog || dialog.dataset.ready) return;
  dialog.dataset.ready = 'true';
  const panel = dialog;
  const status = panel.querySelector<HTMLElement>('[data-checkout-status]')!;
  const submit = panel.querySelector<HTMLButtonElement>('#checkout-submit')!;
  const transaction = panel.querySelector<HTMLAnchorElement>('[data-checkout-transaction]')!;
  const complete = panel.querySelector<HTMLAnchorElement>('[data-checkout-complete]')!;
  const ready = panel.dataset.checkoutReady === 'true';
  const reader = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com', { timeout: 10_000, retryCount: 1 }) });
  const amount = (value: bigint) => `${formatAmount(jpycFromBaseUnits(value))} JPYC`;
  let listing = getListing('karakuwa-scallops')!;
  let busy = false;
  type Pending = { hash: Hex; response: unknown; buyer: Address; quotedAt: number; listing: string };
  let pending: Pending | null = null;
  const storageKey = 'reeldeal:pending-market-checkout';
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (stored && typeof stored.hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(stored.hash)
      && getListing(stored.listing) && Number.isFinite(stored.quotedAt) && stored.quotedAt <= Date.now() / 1000) {
      parseMarketQuote(stored.response, getListing(stored.listing)!, stored.buyer, stored.quotedAt);
      pending = stored;
    }
  } catch { /* Stored state never authorizes a new transaction. */ }
  const clearPending = () => { pending = null; try { localStorage.removeItem(storageKey); } catch {} };
  const showTransaction = (hash: Hex) => { transaction.href = sepoliaTxUrl(hash); transaction.hidden = false; };
  const showListing = () => {
    const total = parseUnits(String(listing.priceYen), JPYC_DECIMALS), split = splitSale(total);
    panel.querySelector('[data-checkout-listing]')!.textContent = `${listing.name} · ${listing.unit}`;
    for (const [key, value] of Object.entries({ total, seller: split.seller, relief: split.relief })) panel.querySelector(`[data-checkout-${key}]`)!.textContent = amount(value);
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-market-buy]')) {
    button.disabled = false;
    button.addEventListener('click', () => {
      if (!busy && !pending) {
        listing = getListing(button.dataset.marketBuy!)!;
        status.textContent = ''; transaction.hidden = true; complete.hidden = true;
        submit.textContent = 'Connect wallet & pay'; submit.disabled = !ready;
      } else if (pending) {
        listing = getListing(pending.listing)!; showTransaction(pending.hash);
        if (!busy) { status.textContent = 'A submitted purchase needs confirmation.'; submit.textContent = 'Check transaction'; submit.disabled = false; }
      }
      showListing(); panel.showModal();
    });
  }
  const confirmPurchase = async () => {
    const submitted = pending!;
    const { quote } = parseMarketQuote(submitted.response, getListing(submitted.listing)!, submitted.buyer, submitted.quotedAt);
    status.textContent = 'Payment submitted. Waiting for 2 confirmations…'; showTransaction(submitted.hash);
    const result = await confirmTransaction(reader, submitted.hash, 'Purchase reverted. No purchase completed.');
    const receipt = await reader.getTransactionReceipt({ hash: submitted.hash });
    if (result.confirmations < 2 || !hasMatchingCheckout(receipt, quote)) throw new Error('Purchase receipt could not be verified.');
    clearPending();
    status.textContent = `Purchase confirmed. ${amount(splitSale(quote.total, quote.reliefBps).relief)} contributed to relief.`;
    complete.hidden = false; submit.textContent = 'Confirmed'; submit.disabled = true;
  };
  submit.addEventListener('click', async () => {
    if (busy || (!ready && !pending)) return;
    busy = true; submit.disabled = true; panel.setAttribute('aria-busy', 'true');
    try {
      if (pending) { await confirmPurchase(); return; }
      status.textContent = 'Connect your Sepolia wallet…';
      const wallet = await connectWallet();
      status.textContent = 'Checking price and availability…';
      const response = await fetch('/api/market/quote', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ listing: listing.slug, buyer: wallet.address }), signal: AbortSignal.timeout(20_000), redirect: 'error' });
      if (!response.ok) throw new Error(response.status === 409 ? 'This item is sold out.' : 'Checkout unavailable. No payment sent.');
      const raw = await response.text(); if (raw.length > 8192) throw new Error('Invalid quote response.');
      const body: unknown = JSON.parse(raw), quotedAt = Date.now() / 1000;
      const { quote, signature } = parseMarketQuote(body, listing, wallet.address, quotedAt);
      const [signer, expectedSigner, balance, allowance] = await Promise.all([
        recoverTypedDataAddress({ domain: saleRouterEip712Domain(DEPLOYED.SaleRouter), types: QUOTE_EIP712_TYPES, primaryType: 'Quote', message: quote, signature }),
        reader.readContract({ address: DEPLOYED.SaleRouter, abi: SaleRouterAbi, functionName: 'quoteSigner' }),
        reader.readContract({ address: JPYC, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.address] }),
        reader.readContract({ address: JPYC, abi: erc20Abi, functionName: 'allowance', args: [wallet.address, DEPLOYED.SaleRouter] }),
      ]);
      if (signer.toLowerCase() !== expectedSigner.toLowerCase()) throw new Error('Invalid quote signature. No payment sent.');
      if (balance < quote.total) throw new Error(`Insufficient JPYC. Available: ${amount(balance)}.`);
      if (allowance < quote.total) {
        status.textContent = 'Approve the exact JPYC total in your wallet…';
        const approval = await wallet.client.writeContract({ account: wallet.address, chain: sepolia, address: JPYC, abi: erc20Abi,
          functionName: 'approve', args: [DEPLOYED.SaleRouter, quote.total] });
        status.textContent = 'Waiting for 2 approval confirmations…'; showTransaction(approval);
        await confirmTransaction(reader, approval, 'Approval reverted. No payment sent.');
      }
      if (quote.expiry < BigInt(Math.floor(Date.now() / 1000) + 15)) throw new Error('Quote expired. Review the purchase again.');
      const current = await connectWallet();
      if (current.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Wallet changed. Review the purchase again.');
      const { request } = await reader.simulateContract({ address: DEPLOYED.SaleRouter, abi: SaleRouterAbi, functionName: 'checkout', args: [quote, signature], account: current.address });
      status.textContent = 'Confirm payment in your wallet…';
      const hash = await current.client.writeContract(request);
      pending = { hash, response: body, buyer: current.address, quotedAt, listing: listing.slug };
      try { localStorage.setItem(storageKey, JSON.stringify(pending)); } catch {}
      await confirmPurchase();
    } catch (error) {
      if (pending) {
        const receipt = await reader.getTransactionReceipt({ hash: pending.hash }).catch(() => null);
        if (receipt?.status === 'reverted') clearPending();
      }
      status.textContent = pending ? 'Confirmation pending. Check this transaction before starting another purchase.'
        : /rejected|denied/i.test(String(error)) ? 'Cancelled in wallet. No purchase confirmed.'
          : error instanceof Error ? error.message.split('\n')[0] : 'Purchase unavailable. Try again.';
      submit.textContent = pending ? 'Check transaction' : 'Try again'; submit.disabled = !pending && !ready;
    } finally { busy = false; panel.removeAttribute('aria-busy'); }
  });
}
