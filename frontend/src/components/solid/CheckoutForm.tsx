/** @jsxImportSource solid-js */
import { createSignal, Show } from 'solid-js';
import { checkoutDemoListing, type CheckoutStep, type DemoListingInput } from './checkout-services';
import { shortAddress, sepoliaTxUrl, WalletUnavailableError } from '../../lib/chain/wallet.client';
import './CheckoutPanel.css';

interface Props { listing: DemoListingInput; enabled?: boolean; disabledLabel?: string }

export default function CheckoutForm(props: Props) {
  const [step, setStep] = createSignal<CheckoutStep | 'idle'>('idle');
  const [error, setError] = createSignal('');
  const [result, setResult] = createSignal<Awaited<ReturnType<typeof checkoutDemoListing>>>();
  const busy = () => step() !== 'idle';

  const statusLabel = () => ({
    idle: '', connecting: 'ウォレットに接続しています… / Connecting wallet…',
    'checking-availability': '出品状況を確認しています… / Checking availability…',
    quoting: '見積もりを取得しています… / Requesting a signed quote…',
    approving: 'JPYC の使用を承認しています… / Approving JPYC…',
    'waiting-approval': '承認を確認しています… / Waiting for approval confirmation…',
    'checking-out': '購入を送信しています… / Submitting checkout…',
    'waiting-checkout': '購入を確認しています… / Waiting for checkout confirmation…',
  })[step()];

  async function submit() {
    if (busy() || props.enabled === false) return;
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
        Sepolia テストネット上の実際のトランザクションです。<br />
        This sends real Sepolia transactions. The fixed demo item has no live inventory record.
      </p>
      <Show when={!result()}>
        <p class="checkout-panel__status" role="status" aria-live="polite">{statusLabel()}</p>
        <Show when={error()}><p class="checkout-panel__error" role="alert">{error()}</p></Show>
        <button type="button" class="checkout-panel__submit" disabled={busy() || props.enabled === false} onClick={submit}>
          {props.enabled === false ? props.disabledLabel ?? 'Open the app to buy' : busy() ? '処理中… / Working…' : 'ウォレットを接続して購入 / Connect wallet & buy'}
        </button>
      </Show>
      <Show when={result()}>
        {(r) => (
          <div class="checkout-panel__success" role="status">
            <strong>購入が完了しました / Checkout complete</strong>
            <p>買い手 / Buyer: {shortAddress(r().address)}</p>
            <p>Block {r().checkoutBlockNumber} · {r().confirmations}+ confirmations</p>
            <p><a href={sepoliaTxUrl(r().checkoutTxHash)} target="_blank" rel="noreferrer">チェックアウトのトランザクションを表示 / View checkout transaction</a></p>
            <Show when={r().approveTxHash}><p><a href={sepoliaTxUrl(r().approveTxHash!)} target="_blank" rel="noreferrer">承認トランザクションを表示 / View approval{r().approveBlockNumber ? ` (block ${r().approveBlockNumber})` : ''}</a></p></Show>
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
