'use client';

import { useState } from 'react';
import styles from './ReplayButton.module.css';

/**
 * Calls the keeper replay stub (POST /api/keeper/replay, #17). It always 501s today — the keeper isn't
 * built yet — so this surfaces that honestly instead of pretending the payout ran.
 */
export function ReplayButton({ zone, season }: { zone: string; season: string }) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'done'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setStatus('pending');
    setMessage(null);
    try {
      const res = await fetch('/api/keeper/replay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ zone, season }),
      });
      const body = await res.json().catch(() => ({}));
      setMessage(res.status === 501 ? `Not yet — ${body.note ?? 'keeper lands in #17'}.` : `HTTP ${res.status}`);
    } catch {
      setMessage('Keeper endpoint unreachable.');
    } finally {
      setStatus('done');
    }
  }

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.button} onClick={handleClick} disabled={status === 'pending'}>
        {status === 'pending' ? 'Calling keeper…' : 'Replay this trigger'}
      </button>
      {message ? <span className={styles.status}>{message}</span> : null}
    </div>
  );
}
