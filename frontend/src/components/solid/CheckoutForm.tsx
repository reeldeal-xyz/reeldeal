/** @jsxImportSource solid-js */
import { createSignal, Show } from 'solid-js';
import { checkoutListing, type CheckoutStep, type MarketListingInput } from './checkout-services';
import { shortAddress, sepoliaTxUrl, WalletUnavailableError } from '../../lib/chain/wallet.client';
import './CheckoutPanel.css';

interface Props { listing: MarketListingInput }

const yen = (wei: bigint) => `¥${(wei / 10n ** 18n).toLocaleString('ja-JP')}`;

export default function CheckoutForm(props: Props) {
  const [step, setStep] = createSignal<CheckoutStep | 'idle'>('idle');
  const [error, setError] = createSignal('');
  const [result, setResult] = createSignal<Awaited<ReturnType<typeof checkoutListing>>>();
  const busy = () => step() !== 'idle';

  const statusLabel = () => ({
    idle: '', connecting: 'ウォレットに接続しています… / Connecting wallet…',
    quoting: '協同組合の署名付き価格を取得しています… / Getting a signed price from the co-op…',
    approving: 'JPYC の使用を承認してください… / Approve JPYC in your wallet…',
    'waiting-approval': '承認を確認しています… / Waiting for approval confirmation…',
    'checking-out': '購入を確認してください… / Confirm the purchase in your wallet…',
    'waiting-checkout': '購入を確認しています… / Waiting for confirmation…',
  })[step()];

  async function submit() {
    if (busy()) return;
    setError('');
    try {
      setResult(await checkoutListing(props.listing, (s) => setStep(s)));
    } catch (e) {
      const message = e instanceof WalletUnavailableError || e instanceof Error ? e.message.split('\n')[0] : '';
      setError(/rejected|denied/i.test(message) ? 'ウォレットでキャンセルされました / You cancelled in your wallet.' : message || 'Something went wrong. Try again.');
    } finally {
      setStep('idle');
    }
  }

  return (
    <section class="checkout-panel" aria-label="Checkout">
      <Show when={!result()}>
        <p class="checkout-panel__hint">
          JPYC で支払い、売上の 5% が救済基金に入ります。<br />
          Pay in JPYC. One Sepolia transaction pays the co-op and sends 5% to the relief fund.
        </p>
        <p class="checkout-panel__status" role="status" aria-live="polite">{statusLabel()}</p>
        <Show when={error()}><p class="checkout-panel__error" role="alert">{error()}</p></Show>
        <button type="button" class="checkout-panel__submit" disabled={busy()} onClick={submit}>
          {busy() ? '処理中… / Working…' : 'ウォレットで購入 / Buy with wallet'}
        </button>
      </Show>
      <Show when={result()}>
        {(r) => (
          <div class="checkout-panel__success" role="status">
            <strong>購入が完了しました / Purchase complete</strong>
            <p>{yen(r().relief)} が救済基金に入りました / {yen(r().relief)} went to the relief fund.</p>
            <p>ロット / Lot {r().lot} · 買い手 / Buyer {shortAddress(r().address)}</p>
            <p><a href={sepoliaTxUrl(r().checkoutTxHash)} target="_blank" rel="noreferrer">取引を表示 / View transaction</a></p>
            <p><a href="/relief">救済基金を見る / See the relief fund</a></p>
          </div>
        )}
      </Show>
    </section>
  );
}
