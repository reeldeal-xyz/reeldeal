import { useEffect, useRef, useState } from 'react';
import { holderAction } from '../guards';
import type { ActionPhase, HolderContext, OperationsPlot } from '../props';

/** Local state only. Never opens a wallet, updates a request or submits a transaction. */
export default function HolderActionPreview({ row, context, initialPhase = 'idle' }: {
  row: OperationsPlot; context: HolderContext; initialPhase?: ActionPhase;
}) {
  const guard = holderAction(row, context);
  const [phase, setPhase] = useState(initialPhase);
  const previousPhase = useRef(phase);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const resultMessage = useRef<HTMLParagraphElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // A saved story or another queue row must never take initial focus.
    if (previousPhase.current === phase) return;
    previousPhase.current = phase;
    const target = phase === 'confirm' ? reviewHeading.current
      : phase === 'idle' ? previewButton.current : resultMessage.current;
    target?.focus({ preventScroll: true });
  }, [phase]);
  if (!guard.action) return <p className="ops-preview__note">{guard.reason} No action preview is available.</p>;
  const action = guard.action;
  return <div className="ops-preview__action" aria-label={`${action} preview for ${row.plotLabel}`}>
    {phase === 'confirm' ? <div className="ops-preview__confirm">
      <h3 ref={reviewHeading} tabIndex={-1}>Review {action} preview</h3>
      <p>{action === 'issue' ? 'Issuing would assign this season slot to the requested farmer.' : 'Revoking would remove this season-slot registration.'} Review {row.plotLabel} · season {row.seasonLabel} before continuing.</p>
      <p>This is a local demonstration. No wallet will open.</p>
      <div className="ops-preview__buttons">
        <button type="button" className="rd-ui-button rd-ui-button--yellow" onClick={() => setPhase('pending')}>Confirm demo {action}</button>
        <button type="button" className="rd-ui-button rd-ui-button--secondary" onClick={() => setPhase('cancelled')}>Cancel preview</button>
      </div>
    </div> : phase === 'pending' ? <>
      <p ref={resultMessage} tabIndex={-1} role="status">Demo {action} pending. The recorded slot is unchanged; no transaction was submitted or confirmed.</p>
      <button type="button" className="rd-ui-button rd-ui-button--secondary" onClick={() => setPhase('idle')}>Reset local demo</button>
    </> : <>
      {phase === 'cancelled' && <p ref={resultMessage} tabIndex={-1} role="status">Preview cancelled. The recorded slot is unchanged.</p>}
      {phase === 'wallet-rejected' && <p ref={resultMessage} tabIndex={-1} role="status">Example wallet cancellation. No transaction was submitted; the recorded slot is unchanged.</p>}
      <button ref={previewButton} type="button" className="rd-ui-button rd-ui-button--yellow" onClick={() => setPhase('confirm')}>Preview {action}</button>
    </>}
  </div>;
}
