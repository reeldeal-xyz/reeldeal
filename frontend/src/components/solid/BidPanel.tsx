/** @jsxImportSource solid-js */
import { createSignal, createUniqueId, onMount, Show } from 'solid-js';
import { parseOffer, type BidServices, type Listing, type SignedOffer, type Receipt } from './bid-services';
import './BidPanel.css';

export default function BidPanel(props: { lotId: string; services: BidServices; initiallyOpen?: boolean }) {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(props.initiallyOpen ?? false);
  const [phase, setPhase] = createSignal<'idle' | 'loading' | 'connecting' | 'signing' | 'submitting'>('idle');
  const [listing, setListing] = createSignal<Listing>();
  const [amount, setAmount] = createSignal('');
  const [address, setAddress] = createSignal('');
  const [error, setError] = createSignal('');
  const [amountError, setAmountError] = createSignal('');
  const [signed, setSigned] = createSignal<SignedOffer>();
  const [receipt, setReceipt] = createSignal<Receipt>();
  const busy = () => phase() !== 'idle';
  const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
  const errorMessage = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Try again.';

  async function load() {
    if (busy()) return;
    setPhase('loading'); setError('');
    try {
      const next = await props.services.load(props.lotId);
      setListing(next);
      if (!amount()) setAmount(String(next.priceJpy));
    } catch (e) { setError(errorMessage(e)); setListing(undefined); }
    finally { setPhase('idle'); }
  }
  onMount(() => { if (open()) void load(); });
  async function toggle() {
    if (busy()) return;
    setOpen(!open());
    if (open() && !receipt()) await load();
  }
  async function connect() {
    if (busy()) return;
    setPhase('connecting'); setError('');
    try { setAddress(await props.services.connect()); }
    catch (e) { setError(errorMessage(e)); }
    finally { setPhase('idle'); }
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy() || receipt() || !address() || listing()?.status !== 'open') return;
    setError(''); setAmountError('');
    const nextAmount = parseOffer(amount());
    if (nextAmount === null) { setAmountError('Enter a whole-yen offer greater than zero.'); return; }
    let payload = signed();
    if (!payload) {
      setPhase('signing');
      try {
        payload = await props.services.sign({ listingId: listing()!.id, amountJpy: nextAmount, bidder: address() });
        setSigned(payload);
      } catch (e) { setError(errorMessage(e)); setPhase('idle'); return; }
    }
    setPhase('submitting');
    try {
      setReceipt(await props.services.submit(payload));
      setSigned(undefined);
    } catch (e) {
      // An ambiguous response may follow a successful write. Retry the same
      // signed payload, keeping amount/account locked until it is resolved.
      setError(errorMessage(e));
    } finally { setPhase('idle'); }
  }
  const status = () => ({ idle: '', loading: 'Checking this lot…', connecting: 'Waiting for wallet…', signing: 'Check the offer in your wallet…', submitting: 'Sending signed offer…' })[phase()];

  return <section class="bid-panel" aria-label="Demo bid">
    <button type="button" class="bid-panel__open" onClick={toggle} disabled={busy()} aria-expanded={open()} aria-controls={id}>{open() ? 'Close bid' : 'Place demo bid'}</button>
    <Show when={open()}><div id={id} class="bid-panel__body">
      <div class="bid-panel__heading"><span class="bid-panel__tag">Demo only</span><h2>Make an offer</h2><p>Sign an offer in your wallet. No payment or gas is sent.</p></div>
      <p class="bid-panel__status" role="status" aria-live="polite">{status()}</p>
      <Show when={error()}><p class="bid-panel__error" role="alert">{error()}</p></Show>
      <Show when={!busy() && (!listing() || listing()?.status === 'closed')}>
        <Show when={listing()?.status === 'closed'}><p class="bid-panel__error">Bidding is closed for this lot.</p></Show>
        <button type="button" class="bid-panel__secondary" onClick={load}>Check lot again</button>
      </Show>
      <Show when={listing()?.status === 'open' && !receipt()}>
        <div class="bid-panel__ask"><span>Asking</span><strong>¥{listing()!.priceJpy.toLocaleString('ja-JP')}</strong></div>
        <form onSubmit={submit} novalidate>
          <div class="field"><label for={`${id}-amount`}>Your offer · JPY</label>
            <div class="bid-panel__amount"><span aria-hidden="true">¥</span><input id={`${id}-amount`} type="text" inputmode="numeric" autocomplete="off" value={amount()} onInput={e => { setAmount(e.currentTarget.value); setAmountError(''); }} disabled={busy() || !!signed()} aria-invalid={!!amountError()} aria-describedby={`${id}-hint${amountError() ? ` ${id}-error` : ''}`} /></div>
            <Show when={amountError()}><p class="bid-panel__error" id={`${id}-error`} role="alert">{amountError()}</p></Show>
            <p class="bid-panel__hint" id={`${id}-hint`}>Whole yen. A signature records intent, not a purchase.</p>
          </div>
          <div class="bid-panel__wallet"><span>Wallet</span><strong>{address() ? short(address()) : 'Not connected'}</strong></div>
          <Show when={!address()}><button type="button" class="bid-panel__secondary" onClick={connect} disabled={busy()}>Connect wallet</button></Show>
          <button type="submit" class="bid-panel__submit" disabled={busy() || !address()}>{phase() === 'signing' ? 'Waiting for wallet…' : phase() === 'submitting' ? 'Sending offer…' : signed() ? 'Retry same signature' : 'Sign demo offer'}</button>
        </form>
      </Show>
      <Show when={receipt()}><div class="bid-panel__success" role="status"><strong>Offer received</strong><p>¥{receipt()!.amountJpy.toLocaleString('ja-JP')} from {short(receipt()!.bidder)}. No payment was made.</p></div></Show>
    </div></Show>
  </section>;
}
