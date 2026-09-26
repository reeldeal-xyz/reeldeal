/** @jsxImportSource solid-js */
import { createSignal, createUniqueId, Show } from 'solid-js';
import { donate, type DonateStep } from './donate-services';
import { shortAddress, sepoliaTxUrl, WalletUnavailableError } from '../../lib/chain/wallet.client';
import './DonatePanel.css';

const JPYC_DECIMALS = 18n;

function parseJpycAmount(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  try { return BigInt(trimmed) * 10n ** JPYC_DECIMALS; } catch { return null; }
}

export default function DonateForm() {
  const id = createUniqueId();
  const [amount, setAmount] = createSignal('20000');
  const [memo, setMemo] = createSignal('');
  const [amountError, setAmountError] = createSignal('');
  const [error, setError] = createSignal('');
  const [step, setStep] = createSignal<DonateStep | 'idle'>('idle');
  const [result, setResult] = createSignal<Awaited<ReturnType<typeof donate>>>();
  const busy = () => step() !== 'idle';

  const statusLabel = () => ({
    idle: '', connecting: 'ウォレットに接続しています… / Connecting wallet…',
    approving: 'JPYC の使用を承認しています… / Approving JPYC…',
    'waiting-approval': '承認の確認を待っています… / Waiting for 2 approval confirmations…',
    donating: '寄付を送信しています… / Sending donation…',
    'waiting-donation': '寄付の確認を待っています… / Waiting for 2 donation confirmations…',
  })[step()];

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy()) return;
    setError(''); setAmountError('');
    const value = parseJpycAmount(amount());
    if (value === null) {
      setAmountError('正の整数（円）を入力してください / Enter a positive whole-yen amount.');
      return;
    }
    try {
      setStep('connecting');
      const donation = await donate(value, memo() || 'Donation via /relief', (s) => setStep(s));
      setResult(donation);
    } catch (e) {
      setError(e instanceof WalletUnavailableError ? e.message : e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setStep('idle');
    }
  }

  return (
    <section class="donate-panel" aria-label="Donate JPYC">
      <h2>寄付する / Donate JPYC</h2>
      <p class="donate-panel__hint">
        Sepolia テストネット上の実際のトランザクションです。注入型ウォレット（MetaMask 等）が必要です。<br />
        This sends a real Sepolia transaction from your injected wallet (e.g. MetaMask).
      </p>
      <Show when={!result()}>
        <form onSubmit={submit} novalidate>
          <div class="field">
            <label for={`${id}-amount`}>金額 (JPYC) / Amount (JPYC)</label>
            <input
              id={`${id}-amount`} type="text" inputmode="numeric" autocomplete="off"
              value={amount()} disabled={busy()}
              onInput={(e) => { setAmount(e.currentTarget.value); setAmountError(''); }}
              aria-invalid={!!amountError()} aria-describedby={amountError() ? `${id}-amount-error` : undefined}
            />
            <Show when={amountError()}><p class="donate-panel__error" id={`${id}-amount-error`} role="alert">{amountError()}</p></Show>
          </div>
          <div class="field">
            <label for={`${id}-memo`}>メモ（任意）/ Memo (optional)</label>
            <input id={`${id}-memo`} type="text" maxlength="120" value={memo()} disabled={busy()} onInput={(e) => setMemo(e.currentTarget.value)} />
          </div>
          <p class="donate-panel__status" role="status" aria-live="polite">{statusLabel()}</p>
          <Show when={error()}><p class="donate-panel__error" role="alert">{error()}</p></Show>
          <button type="submit" class="donate-panel__submit" disabled={busy()}>
            {busy() ? '処理中… / Working…' : 'ウォレットを接続して寄付 / Connect wallet & donate'}
          </button>
        </form>
      </Show>
      <Show when={result()}>
        {(r) => (
          <div class="donate-panel__success" role="status">
            <strong>寄付が確認されました / Donation confirmed</strong>
            <p>{shortAddress(r().address)} から / from {shortAddress(r().address)}</p>
            <p>Block {r().donateBlockNumber} · {r().confirmations}+ confirmations</p>
            <p><a href={sepoliaTxUrl(r().donateTxHash)} target="_blank" rel="noreferrer">寄付トランザクションを表示 / View donate transaction</a></p>
            <p><a href={sepoliaTxUrl(r().approveTxHash)} target="_blank" rel="noreferrer">承認トランザクションを表示 / View approval (block {r().approveBlockNumber})</a></p>
            <button type="button" class="donate-panel__refresh" onClick={() => location.reload()}>基金残高を更新 / Refresh fund</button>
          </div>
        )}
      </Show>
    </section>
  );
}
