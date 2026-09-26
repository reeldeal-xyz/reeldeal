'use client';

// "Needs co-op review" card (sponsor-polish task, docs/JEV.md attest gate): lists keeper runs the Jev
// gate held for a human review, with an "Approve and attest" button gated by a shared co-op passcode
// (COOP_PASSCODE) -- never the browser-facing KEEPER_API_TOKEN. See web/src/app/api/coop/approve-attest.
import { useState } from 'react';
import styles from '@/components/ui/ui.module.css';
import { useEscalatedRuns, useInvalidateEscalatedRuns } from '@/hooks/use-escalated-runs';
import type { EscalatedRun } from '@/lib/keeper-runs';

const DECISION_LABEL: Record<string, string> = {
  co_op_review: 'co-op review',
  attest_now: 'attest now',
};

function jevSummary(run: EscalatedRun): string {
  const label = run.jevDecision ? (DECISION_LABEL[run.jevDecision] ?? run.jevDecision) : 'unavailable';
  const pct = run.jevConfidence !== null ? `${Math.round(run.jevConfidence * 100)}%` : '—';
  return `Jev: ${label} ${pct}`;
}

export function EscalationCard() {
  const { data: runs, isLoading } = useEscalatedRuns();
  const invalidate = useInvalidateEscalatedRuns();
  const [passcode, setPasscode] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resultByRun, setResultByRun] = useState<Record<string, { good: boolean; message: string }>>({});

  if (!isLoading && (!runs || runs.length === 0)) return null;

  const approve = async (run: EscalatedRun) => {
    setBusyId(run.id);
    setResultByRun((prev) => ({ ...prev, [run.id]: undefined as unknown as { good: boolean; message: string } }));
    try {
      const res = await fetch('/api/coop/approve-attest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: run.referenceEventId, passcode }),
      });
      const json = (await res.json()) as { ok?: boolean; status?: string; attestTxHash?: string; error?: string; message?: string };
      if (!res.ok || !json.ok) {
        setResultByRun((prev) => ({ ...prev, [run.id]: { good: false, message: json.message ?? json.error ?? `failed (${res.status})` } }));
        return;
      }
      setResultByRun((prev) => ({
        ...prev,
        [run.id]: { good: true, message: json.attestTxHash ? `Attested — tx ${json.attestTxHash.slice(0, 10)}…` : 'Attested' },
      }));
      invalidate();
    } catch {
      setResultByRun((prev) => ({ ...prev, [run.id]: { good: false, message: 'Request failed — check your connection.' } }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Needs co-op review · 要確認</h2>
        <span className={styles.sectionHint}>Jev held these for a human before attesting (docs/JEV.md)</span>
      </div>

      <div className={styles.field} style={{ maxWidth: 280 }}>
        <label className={styles.label} htmlFor="coop-passcode">
          Co-op passcode
        </label>
        <input
          id="coop-passcode"
          type="password"
          className={styles.input}
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="required to approve"
        />
      </div>

      <div className={styles.stack}>
        {(runs ?? []).map((run) => {
          const result = resultByRun[run.id];
          return (
            <div key={run.id} className={styles.card}>
              <div className={styles.spread}>
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>{run.referenceEventId}</p>
                  <p className={styles.hint} style={{ margin: '4px 0 0' }}>
                    {jevSummary(run)} · {run.jevReason ?? 'unknown reason'}
                  </p>
                </div>
                <button
                  type="button"
                  className={`${styles.buttonPrimary} ${styles.buttonSmall}`}
                  disabled={busyId === run.id || !passcode}
                  onClick={() => approve(run)}
                >
                  {busyId === run.id ? 'Approving…' : 'Approve and attest'}
                </button>
              </div>
              {result ? (
                <p className={styles.hint} style={{ marginTop: 8, color: result.good ? 'var(--ops-good)' : 'var(--ops-bad)' }}>
                  {result.message}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
