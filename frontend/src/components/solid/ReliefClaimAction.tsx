/** @jsxImportSource solid-js */
import { createSignal, Show } from 'solid-js';
import type { Address, Hex } from 'viem';
import { claimHeld, type ReliefClaimStep } from './relief-claim-services';
import { sepoliaTxUrl, shortAddress, WalletUnavailableError } from '../../lib/chain/wallet.client';
import './ReliefClaimAction.css';

interface Props {
  eventId: Hex;
  plotLabel: string;
  season: string;
  farmer: Address;
  amount: string;
}

export default function ReliefClaimAction(props: Props) {
  const [step, setStep] = createSignal<ReliefClaimStep | 'idle'>('idle');
  const [error, setError] = createSignal('');
  const [result, setResult] = createSignal<Awaited<ReturnType<typeof claimHeld>>>();
  const busy = () => step() !== 'idle';

  const status = () => ({
    idle: '',
    connecting: 'Connecting registered farmer wallet…',
    submitting: 'Submitting claimHeld to ReliefPool…',
    confirming: 'Waiting for 2 Sepolia confirmations…',
    verifying: 'Verifying the final on-chain settlement…',
  })[step()];

  async function submit() {
    if (busy()) return;
    setError('');
    try {
      const value = await claimHeld(props, (next) => setStep(next));
      setResult(value);
    } catch (cause) {
      setError(cause instanceof WalletUnavailableError ? cause.message : cause instanceof Error ? cause.message : 'Claim failed.');
    } finally {
      setStep('idle');
    }
  }

  return <div class="relief-claim">
    <Show when={!result()}>
      <button type="button" onClick={submit} disabled={busy()}>
        {busy() ? 'Working…' : `Claim ${props.amount} JPYC`}
      </button>
      <p class="relief-claim__status" role="status" aria-live="polite">{status()}</p>
      <Show when={error()}><p class="relief-claim__error" role="alert">{error()}</p></Show>
    </Show>
    <Show when={result()}>
      {(value) => <div class="relief-claim__confirmed" role="status">
        <strong>Claim confirmed</strong>
        <p>Wallet {shortAddress(value().address)} · block {value().blockNumber} · {value().confirmations}+ confirmations</p>
        <p>ReliefPool state: {value().settlementState}</p>
        <a href={sepoliaTxUrl(value().txHash)} target="_blank" rel="noreferrer">View confirmed claim transaction</a>
        <button type="button" onClick={() => location.reload()}>Refresh relief status</button>
      </div>}
    </Show>
  </div>;
}
