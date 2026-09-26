/** @jsxImportSource solid-js */
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { checkoutListing, pendingPurchase, type CheckoutStep, type MarketListingInput } from './checkout-services';
import { sepoliaTxUrl, WalletUnavailableError } from '../../lib/chain/wallet.client';
import './CheckoutPanel.css';

interface Props { listing: MarketListingInput; locale?: 'en' | 'ja' }

const amount = (wei: bigint) => `${(wei / 10n ** 18n).toLocaleString('ja-JP')} JPYC`;

export default function CheckoutForm(props: Props) {
  const [step, setStep] = createSignal<CheckoutStep | 'idle'>('idle');
  const [error, setError] = createSignal('');
  const [result, setResult] = createSignal<Awaited<ReturnType<typeof checkoutListing>>>();
  const [pending, setPending] = createSignal<ReturnType<typeof pendingPurchase>>(null);
  const [locale, setLocale] = createSignal(props.locale ?? 'en');
  let panel: HTMLElement | undefined;
  const t = (en: string, ja: string) => locale() === 'ja' ? ja : en;
  onMount(() => {
    setPending(pendingPurchase());
    const section = panel?.closest('.marketplace-preview');
    if (!section) return;
    const update = () => setLocale(section.getAttribute('lang') === 'ja' ? 'ja' : 'en');
    update();
    const observer = new MutationObserver(update);
    observer.observe(section, { attributes: true, attributeFilter: ['lang'] });
    onCleanup(() => observer.disconnect());
  });
  const busy = () => step() !== 'idle';

  const statusLabel = () => ({
    idle: '', connecting: t('Connecting wallet…', 'ウォレットに接続中…'),
    quoting: t('Checking price and availability…', '価格と在庫を確認中…'),
    approving: t('Approve JPYC in your wallet.', 'ウォレットでJPYCの使用を承認してください。'),
    'waiting-approval': t('Confirming approval…', '承認を確認中…'),
    'checking-out': t('Confirm the purchase in your wallet.', 'ウォレットで購入を確認してください。'),
    'waiting-checkout': t('Confirming purchase…', '購入を確認中…'),
  })[step()];

  async function submit() {
    if (busy()) return;
    setError('');
    try {
      setResult(await checkoutListing(props.listing, (s) => setStep(s)));
    } catch (e) {
      const message = e instanceof Error ? e.message.split('\n')[0] : '';
      setError(e instanceof WalletUnavailableError ? t('Connect a wallet before purchasing.', '購入前にウォレットを接続してください。')
        : /rejected|denied/i.test(message) ? t('Cancelled in your wallet.', 'ウォレットでキャンセルされました。')
          : message || t('Purchase unavailable. Try again.', '購入できません。再度お試しください。'));
    } finally {
      setPending(pendingPurchase());
      setStep('idle');
    }
  }

  return (
    <section ref={panel} class="checkout-panel" aria-label={t('Checkout', '購入手続き')}>
      <Show when={!result()}>
        <p class="checkout-panel__status" role="status" aria-live="polite">{statusLabel()}</p>
        <Show when={error()}><p class="checkout-panel__error" role="alert">{error()}</p></Show>
        <Show when={pending()}>{(purchase) => <p><a href={sepoliaTxUrl(purchase().hash)} target="_blank" rel="noreferrer">{t('Submitted transaction', '送信済みの取引')}</a></p>}</Show>
        <button type="button" class="checkout-panel__submit" disabled={busy()} onClick={submit}>
          {busy() ? t('Working…', '処理中…') : pending()?.listing === props.listing.slug ? t('Check transaction', '取引を確認') : t('Pay with wallet', 'ウォレットで支払う')}
        </button>
      </Show>
      <Show when={result()}>
        {(r) => (
          <div class="checkout-panel__success" role="status">
            <strong>{t('Purchase confirmed', '購入が確定しました')}</strong>
            <p>{t(`${amount(r().relief)} contributed to relief.`, `${amount(r().relief)}が救済基金に入りました。`)}</p>
            <p><a href={sepoliaTxUrl(r().checkoutTxHash)} target="_blank" rel="noreferrer">{t('View transaction', '取引を表示')}</a></p>
            <p><a href="/relief">{t('View relief fund', '救済基金を見る')}</a></p>
          </div>
        )}
      </Show>
    </section>
  );
}
