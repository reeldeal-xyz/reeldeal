import { useState } from 'react';

type Mode = 'verify' | 'claim' | 'request';

/** Local UI simulation only. No wallet, World, LINE, fetch or RPC client. */
export default function ReliefPreviewAction({ mode, initiallyCancelled = false, initiallyPending = false }: {
  mode: Mode;
  initiallyCancelled?: boolean;
  initiallyPending?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'opened' | 'cancelled' | 'pending'>(
    initiallyPending ? 'pending' : initiallyCancelled ? 'cancelled' : 'idle',
  );
  const label = mode === 'verify' ? 'Preview identity check' : mode === 'claim' ? 'Preview claim request' : 'Preview slot request';
  return <div className="farmer-relief__demo" aria-label={`${mode} preview`}>
    {state === 'cancelled' && <p role="status">Identity check cancelled. Verification is unchanged; no payment was requested.</p>}
    {state === 'opened' && <div className="farmer-relief__demo-check">
      <p role="status">Demo identity check opened. No World ID session or wallet request was created.</p>
      <button type="button" className="rd-ui-button rd-ui-button--secondary" onClick={() => setState('cancelled')}>Cancel demo check</button>
    </div>}
    {state === 'pending' && <div className="farmer-relief__demo-check">
      <p role="status">{mode === 'claim'
        ? 'Demo claim request pending. Relief remains Held; no payment is confirmed.'
        : 'Demo slot request pending. The season slot has not been issued.'}</p>
      <button type="button" className="rd-ui-button rd-ui-button--secondary" onClick={() => setState('idle')}>Reset demo</button>
    </div>}
    {(state === 'idle' || state === 'cancelled') && <button type="button" className="rd-ui-button rd-ui-button--yellow rd-ui-button--primary" onClick={() => setState(mode === 'verify' ? 'opened' : 'pending')}>{label}</button>}
    <p className="farmer-relief__small">Local preview only · no request is sent.</p>
  </div>;
}
