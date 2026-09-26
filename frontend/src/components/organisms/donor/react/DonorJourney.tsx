import { useEffect, useId, useReducer, useRef, type ReactNode } from 'react';
import { formatAmount, jpycFromBaseUnits } from '../../../../lib/format-amount';
import { createDonorState, donorBlocker, parseDonationAmount, transitionDonor, type DonorAction, type DonorFixture } from '../model';

function amountLabel(baseUnits: string | null) {
  const amount = jpycFromBaseUnits(baseUnits);
  return amount === null ? 'Unavailable' : `${formatAmount(amount)} JPYC`;
}

export default function DonorJourney({ fixture, children }: { fixture: DonorFixture; children: ReactNode }) {
  const [state, reduce] = useReducer((current: ReturnType<typeof createDonorState>, action: DonorAction) => transitionDonor(current, action, fixture), fixture, createDonorState);
  const progress = useRef<HTMLParagraphElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const lastAction = useRef<DonorAction['type'] | null>(null);
  const previousPhase = useRef(state.phase);
  function dispatch(action: DonorAction) {
    lastAction.current = action.type;
    reduce(action);
  }
  useEffect(() => {
    if (previousPhase.current === state.phase) return;
    previousPhase.current = state.phase;
    // Preserve the keyboard position when a phase action removes its own button.
    // Initial rendering and edits in the amount/memo fields must not move focus.
    if (lastAction.current === 'amount' || lastAction.current === 'memo') return;
    if (['approved', 'cancelled', 'rejected', 'failed', 'editing'].includes(state.phase) && reviewButton.current && !reviewButton.current.disabled) {
      reviewButton.current.focus();
    } else {
      progress.current?.focus({ preventScroll: true });
    }
  }, [state.phase]);
  const id = useId();
  const blocked = donorBlocker(state, fixture);
  const locked = ['review', 'pending', 'confirmed', 'unavailable'].includes(state.phase);
  const parsed = parseDonationAmount(state.amount);
  const approvalNeeded = parsed.ok && state.allowanceBaseUnits !== null && /^\d+$/.test(state.allowanceBaseUnits)
    ? BigInt(state.allowanceBaseUnits) < BigInt(parsed.baseUnits) : null;
  const operation = state.operation === 'approval' ? 'approval' : 'donation';
  const phaseMessage = {
    editing: 'Choose an amount, then review the next step.',
    review: `Review the sample ${operation}. No request has been submitted.`,
    pending: `Sample ${operation} pending. Submission is not confirmation.`,
    approved: 'Sample approval confirmed. It changes allowance only; no donation has been made.',
    confirmed: 'Sample donation confirmed. This is a local simulation; no real JPYC moved.',
    cancelled: `Sample ${operation} cancelled before submission. No transaction was sent.`,
    rejected: `Sample ${operation} rejected before submission. No transaction was sent.`,
    failed: `Sample ${operation} failed. No successful transfer is recorded; retry requires a new review.`,
    unavailable: `Sample ${operation} confirmation is unavailable. Resolve its status before preparing another attempt.`,
  }[state.phase];
  const receipt = [...state.activity].reverse().find(item => item.operation === 'donation' && item.status === 'confirmed');

  return <div className="donor-preview__journey">
    <section className="donor-preview__account" aria-label="Sample account">
      <dl className="donor-preview__facts">
        <div><dt>Wallet</dt><dd>{fixture.connection === 'connected' ? 'Connected sample · Sepolia' : fixture.connection === 'wrong-network' ? 'Sample wallet · wrong network' : 'Disconnected'}</dd></div>
        <div><dt>Sample balance</dt><dd>{fixture.readState === 'loading' ? 'Loading…' : fixture.readState === 'unavailable' ? 'Unavailable' : amountLabel(state.balanceBaseUnits)}</dd></div>
        <div><dt>Sample allowance</dt><dd>{fixture.readState === 'loading' ? 'Loading…' : fixture.readState === 'unavailable' ? 'Unavailable' : amountLabel(state.allowanceBaseUnits)}</dd></div>
      </dl>
      <p className="donor-preview__note">These account values are local examples. No wallet is connected by this screen.</p>
    </section>

    <div className="donor-preview__columns">
      <section className="donor-preview__panel" aria-labelledby={`${id}-form-title`}>
        <h2 id={`${id}-form-title`}>Choose your contribution</h2>
        <p>Contributions support the pooled relief fund. They are not assigned to a particular farmer.</p>
        {blocked && <p className="notice" role="status">{blocked}</p>}
        <form onSubmit={event => { event.preventDefault(); dispatch({ type: 'review' }); }} noValidate>
          <div className="field">
            <label htmlFor={`${id}-amount`}>Amount (JPYC)</label>
            <input id={`${id}-amount`} className="input" inputMode="decimal" autoComplete="off" value={state.amount}
              disabled={locked || !!blocked} aria-describedby={`${id}-amount-help${state.error ? ` ${id}-error` : ''}`}
              aria-invalid={state.error ? true : undefined} onChange={event => dispatch({ type: 'amount', value: event.target.value })} />
            <p id={`${id}-amount-help`} className="donor-preview__note">Use up to 18 decimal places. Amounts are kept exact.</p>
          </div>
          <div className="field">
            <label htmlFor={`${id}-memo`}>Public memo (optional)</label>
            <textarea id={`${id}-memo`} className="input" rows={3} maxLength={140} value={state.memo} disabled={locked || !!blocked}
              aria-describedby={`${id}-memo-help`} onChange={event => dispatch({ type: 'memo', value: event.target.value })} />
            <p id={`${id}-memo-help`} className="donor-preview__note">{state.memo.length}/140 · use a general message without personal details.</p>
          </div>
          {state.error && <p id={`${id}-error`} role="alert" className="donor-preview__error">{state.error}</p>}
          {!locked && <button ref={reviewButton} type="submit" className="rd-ui-button rd-ui-button--yellow" disabled={!!blocked}>
            {approvalNeeded === false ? 'Review sample donation' : 'Review sample approval'}
          </button>}
        </form>
      </section>

      <section className="donor-preview__panel" aria-labelledby={`${id}-progress-title`}>
        <p className="market-kicker">Two separate steps</p>
        <h2 id={`${id}-progress-title`}>Approve, then donate</h2>
        <ol className="donor-preview__steps"><li>Approve a spending allowance.</li><li>Submit a donation and wait for its own confirmation.</li></ol>
        <p ref={progress} tabIndex={-1} role="status" aria-live="polite" data-donor-progress>{phaseMessage}</p>
        {state.snapshot && <dl className="donor-preview__facts donor-preview__review">
          <div><dt>Review amount</dt><dd>{amountLabel(state.snapshot.baseUnits)}</dd></div>
          <div><dt>Memo</dt><dd>{state.snapshot.memo || 'No memo'}</dd></div>
          <div><dt>Destination</dt><dd>Sample pooled relief fund</dd></div>
        </dl>}
        {state.phase === 'review' && <div className="donor-preview__actions">
          <button type="button" className="rd-ui-button rd-ui-button--yellow" onClick={() => dispatch({ type: 'submit' })}>Submit sample {operation}</button>
          <button type="button" className="rd-ui-button rd-ui-button--secondary" onClick={() => dispatch({ type: 'cancel' })}>Cancel review</button>
          <button type="button" className="rd-ui-button rd-ui-button--secondary" onClick={() => dispatch({ type: 'reject' })}>Simulate rejection</button>
        </div>}
        {state.phase === 'pending' && <div className="donor-preview__actions">
          <button type="button" className="rd-ui-button rd-ui-button--yellow" onClick={() => dispatch({ type: 'confirm' })}>Confirm sample {operation}</button>
          <button type="button" className="rd-ui-button rd-ui-button--secondary" onClick={() => dispatch({ type: 'fail' })}>Simulate failure</button>
          <button type="button" className="rd-ui-button rd-ui-button--secondary" onClick={() => dispatch({ type: 'unavailable' })}>Simulate status unavailable</button>
        </div>}
        {state.phase === 'unavailable' && <button type="button" className="rd-ui-button rd-ui-button--secondary" onClick={() => dispatch({ type: 'restore' })}>Restore sample pending status</button>}
        {state.phase === 'confirmed' && <button type="button" className="rd-ui-button rd-ui-button--secondary" onClick={() => dispatch({ type: 'edit' })}>Prepare another sample donation</button>}
        <p className="donor-preview__note">Every control changes this demo only. Closing the page clears this session.</p>
      </section>
    </div>

    {receipt && <section className="donor-preview__panel donor-preview__receipt" aria-label="Sample donation receipt">
      <div className="donor-preview__section-heading"><h2>Sample donation receipt</h2><span className="rd-ui-badge rd-ui-badge--lime"><strong>Donation confirmed · demo</strong></span></div>
      <p className="donor-preview__receipt-amount">{amountLabel(receipt.baseUnits)}</p>
      <dl className="donor-preview__facts">
        <div><dt>Demo reference</dt><dd>DEMO-DONATION-{receipt.id}</dd></div>
        <div><dt>Memo</dt><dd>{receipt.memo || 'No memo'}</dd></div>
        <div><dt>Chain receipt</dt><dd>Not connected · synthetic confirmation only</dd></div>
      </dl>
      <p>No blockchain transaction or farmer payout is represented by this receipt.</p>
    </section>}

    <section className="donor-preview__panel" aria-label="Demo transaction history">
      <h2>Demo transaction history</h2>
      <p className="donor-preview__note">Only actions in this local session. Approval and donation are separate entries.</p>
      {state.activity.length === 0 ? <p>No sample actions yet.</p> : <ol className="donor-preview__activity">
        {[...state.activity].reverse().map(item => <li key={item.id}>
          <div><strong>{item.operation === 'approval' ? 'JPYC approval' : 'Pool donation'}</strong><span>{item.status === 'review' ? 'Awaiting review' : item.status === 'unavailable' ? 'Confirmation unavailable' : item.status}</span></div>
          <p>{amountLabel(item.baseUnits)}</p>
          <small>{item.operation === 'approval' ? 'Allowance only · not a contribution.' : item.status === 'confirmed' ? 'Synthetic contribution confirmation · no real transfer.' : 'No donation confirmed for this attempt.'}</small>
        </li>)}
      </ol>}
    </section>
    {children}
  </div>;
}
