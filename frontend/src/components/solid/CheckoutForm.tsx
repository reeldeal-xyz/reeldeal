/** @jsxImportSource solid-js */
import { createSignal, Show } from 'solid-js';
import { checkoutDemoListing, type CheckoutStep, type DemoListingInput } from './checkout-services';
import { shortAddress, sepoliaTxUrl, WalletUnavailableError } from '../../lib/chain/wallet.client';
import './CheckoutPanel.css';

interface Props { listing: DemoListingInput }

export default function CheckoutForm(props: Props) {
  const [step, setStep] = createSignal<CheckoutStep | 'idle'>('idle');
  const [error, setError] = createSignal('');
  const [result, setResult] = createSignal<Awaited<ReturnType<typeof checkoutDemoListing>>>();
  const busy = () => step() !== 'idle';

  const statusLabel = () => ({
    idle: '', connecting: 'ウォレットに接続しています… / Connecting wallet…',
    quoting: '見積もりを取得しています… / Requesting a signed quote…',
    approving: 'JPYC の使用を承認しています… / Approving JPYC…',
    'checking-out': '購入を送信しています… / Submitting checkout…',
  })[step()];

  async function submit() {
    if (busy()) return;
    setError('');
    try {
      const outcome = await checkoutDemoListing(props.listing, (s) => setStep(s));
      setResult(outcome);
    } catch (e) {
      setError(e instanceof WalletUnavailableError ? e.message : e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setStep('idle');
    }
  }

  return (
    <section class="checkout-panel" aria-label="Checkout">
      <p class="checkout-panel__hint">
        Sepolia テストネット上の実際のトランザクションです。注入型ウォレット（MetaMask 等）が必要です。<br />
        This sends real Sepolia transactions from your injected wallet (e.g. MetaMask). No listing inventory is tracked yet -- this is a demo listing.
      </p>
      <Show when={!result()}>
        <p class="checkout-panel__status" role="status" aria-live="polite">{statusLabel()}</p>
        <Show when={error()}><p class="checkout-panel__error" role="alert">{error()}</p></Show>
        <button type="button" class="checkout-panel__submit" disabled={busy()} onClick={submit}>
          {busy() ? '処理中… / Working…' : 'ウォレットを接続して購入 / Connect wallet & buy'}
        </button>
      </Show>
      <Show when={result()}>
        {(r) => (
          <div class="checkout-panel__success" role="status">
            <strong>購入が完了しました / Checkout complete</strong>
            <p>買い手 / Buyer: {shortAddress(r().address)}</p>
            <p><a href={sepoliaTxUrl(r().checkoutTxHash)} target="_blank" rel="noreferrer">チェックアウトのトランザクションを表示 / View checkout transaction</a></p>
            <p><a href={sepoliaTxUrl(r().approveTxHash)} target="_blank" rel="noreferrer">承認トランザクションを表示 / View approve transaction</a></p>
            <p class="checkout-panel__note">
              救済プールの寄付ログで <code>sale:{r().quote.orderId}</code> というメモの Donated イベントを確認できます。<br />
              Look for a <code>Donated</code> event on ReliefPool with memo <code>sale:{r().quote.orderId}</code> to correlate this sale's relief contribution.
            </p>
          </div>
        )}
      </Show>
    </section>
  );
}
