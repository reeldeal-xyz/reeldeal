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

export default function DonateForm(props: { lang?: 'en' | 'ja' }) {
  const t = (en: string, ja: string) => props.lang === 'ja' ? ja : en;
  const id = createUniqueId();
  const [amount, setAmount] = createSignal('20000');
  const [memo, setMemo] = createSignal('');
  const [amountError, setAmountError] = createSignal('');
  const [error, setError] = createSignal('');
  const [step, setStep] = createSignal<DonateStep | 'idle'>('idle');
  const [result, setResult] = createSignal<Awaited<ReturnType<typeof donate>>>();
  const busy = () => step() !== 'idle';

  const statusLabel = () => ({
    idle: '', connecting: t('Connecting wallet…', 'ウォレットに接続中…'),
    approving: t('Approve JPYC in your wallet.', 'ウォレットでJPYCの使用を承認してください。'),
    'waiting-approval': t('Confirming approval…', '承認を確認中…'),
    donating: t('Confirm the donation in your wallet.', 'ウォレットで寄付を確認してください。'),
    'waiting-donation': t('Confirming donation…', '寄付を確認中…'),
  })[step()];

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy()) return;
    setError(''); setAmountError('');
    const value = parseJpycAmount(amount());
    if (value === null) {
      setAmountError(t('Enter a positive whole number of JPYC.', 'JPYCの金額を正の整数で入力してください。'));
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
      <h2>{t('Donate', '寄付する')}</h2>
      <p class="donate-panel__hint">
        {t('Sepolia test funds · JPYC', 'Sepoliaのテスト資金 · JPYC')}
      </p>
      <Show when={!result()}>
        <form onSubmit={submit} novalidate>
          <div class="field">
            <label for={`${id}-amount`}>{t('Amount (JPYC)', '金額 (JPYC)')}</label>
            <input
              id={`${id}-amount`} type="text" inputmode="numeric" autocomplete="off"
              value={amount()} disabled={busy()}
              onInput={(e) => { setAmount(e.currentTarget.value); setAmountError(''); }}
              aria-invalid={!!amountError()} aria-describedby={amountError() ? `${id}-amount-error` : undefined}
            />
            <Show when={amountError()}><p class="donate-panel__error" id={`${id}-amount-error`} role="alert">{amountError()}</p></Show>
          </div>
          <div class="field">
            <label for={`${id}-memo`}>{t('Memo (optional)', 'メモ（任意）')}</label>
            <input id={`${id}-memo`} type="text" maxlength="120" value={memo()} disabled={busy()} onInput={(e) => setMemo(e.currentTarget.value)} />
          </div>
          <p class="donate-panel__status" role="status" aria-live="polite">{statusLabel()}</p>
          <Show when={error()}><p class="donate-panel__error" role="alert">{error()}</p></Show>
          <button type="submit" class="donate-panel__submit" disabled={busy()}>
            {busy() ? t('Working…', '処理中…') : t('Donate with wallet', 'ウォレットで寄付する')}
          </button>
        </form>
      </Show>
      <Show when={result()}>
        {(r) => (
          <div class="donate-panel__success" role="status">
            <strong>{t('Donation confirmed', '寄付が確認されました')}</strong>
            <p>{t('From', '送信元')} {shortAddress(r().address)}</p>
            <p>Block {r().donateBlockNumber} · {r().confirmations}+ confirmations</p>
            <p><a href={sepoliaTxUrl(r().donateTxHash)} target="_blank" rel="noreferrer">{t('View donation', '寄付の取引を表示')}</a></p>
            <p><a href={sepoliaTxUrl(r().approveTxHash)} target="_blank" rel="noreferrer">{t('View approval', '承認の取引を表示')}</a></p>
            <button type="button" class="donate-panel__refresh" onClick={() => location.reload()}>{t('Refresh fund', '基金残高を更新')}</button>
          </div>
        )}
      </Show>
    </section>
  );
}
