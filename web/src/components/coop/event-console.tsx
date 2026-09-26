'use client';

// Co-op event console: every reference event's lifecycle as four steps -- data crossed the line, co-op
// accepts, anchored on-chain (attest), settled per plot -- with the one action that moves it forward.
// Actions POST /api/coop/events with the co-op passcode (COOP_PASSCODE); reads are public chain state.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatUnits } from 'viem';
import styles from '@/components/ui/ui.module.css';
import type { EventStage, EventStatus, PlotState } from '@/lib/keeper/event-status';

const TX = 'https://sepolia.etherscan.io/tx/';
const LINK = { color: 'var(--ops-accent)' } as const;

const STEPS: { stage: EventStage | 'fired'; label: string }[] = [
  { stage: 'fired', label: 'Data crossed the line' },
  { stage: 'awaiting_coop', label: 'Co-op accepts' },
  { stage: 'anchored', label: 'Anchored on-chain' },
  { stage: 'settled', label: 'Settled' },
];

const STAGE_RANK: Record<EventStage, number> = { not_fired: 0, awaiting_coop: 1, anchored: 2, settled: 3 };
// Per step: the stage rank at which it's done, and the rank at which it's the next thing to happen.
const STEP_DONE_AT = [1, 2, 2, 3];
const STEP_CURRENT_AT = [0, 1, -1, 2];

const STAGE_BADGE: Record<EventStage, { text: string; cls: string | undefined }> = {
  not_fired: { text: 'Not checked', cls: styles.badgeNeutral },
  awaiting_coop: { text: 'Needs co-op', cls: styles.badgeWarn },
  anchored: { text: 'Anchored', cls: styles.badgeAccent },
  settled: { text: 'Settled', cls: styles.badgeGood },
};

const PLOT_BADGE: Record<PlotState, string | undefined> = {
  Unsettled: styles.badgeNeutral,
  Paid: styles.badgeGood,
  Claimed: styles.badgeGood,
  Held: styles.badgeWarn,
  Swept: styles.badgeBad,
};

const PERIL_LABEL: Record<string, string> = {
  BANWEEKS: 'Toxin shipping ban',
  HEAT: 'Marine heatwave',
};

type Action = 'check' | 'accept' | 'settle';

const ACTION_FOR: Partial<Record<EventStage, { action: Action; label: string; busy: string }>> = {
  not_fired: { action: 'check', label: 'Check event', busy: 'Checking…' },
  awaiting_coop: { action: 'accept', label: 'Accept & anchor', busy: 'Anchoring…' },
  anchored: { action: 'settle', label: 'Settle plots', busy: 'Settling…' },
};

function jpyc(wei?: string): string {
  if (!wei) return '—';
  return `¥${Number(formatUnits(BigInt(wei), 18)).toLocaleString('en-US')}`;
}

function short(hex: string): string {
  return `${hex.slice(0, 10)}…${hex.slice(-4)}`;
}

function useEvents() {
  return useQuery({
    queryKey: ['coop-events'],
    refetchInterval: 15_000,
    queryFn: async (): Promise<EventStatus[]> => {
      const res = await fetch('/api/coop/events');
      const json = (await res.json()) as { events?: EventStatus[]; message?: string; error?: string };
      if (!res.ok || !json.events) throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`);
      return json.events;
    },
  });
}

interface ActionResponse {
  ok?: boolean;
  status?: 'ok' | 'escalated';
  jevGate?: { decision: string; confidence: number | null };
  attestTxHash?: string;
  settleTxHashes?: string[];
  alreadyAttested?: boolean;
  error?: string;
  message?: string;
}

function describe(action: Action, json: ActionResponse): string {
  if (json.status === 'escalated') {
    const pct = json.jevGate?.confidence != null ? `${Math.round(json.jevGate.confidence * 100)}%` : '—';
    return `Jev sent this to the co-op (${pct} confident). Review it, then accept.`;
  }
  if (action === 'settle') {
    const n = json.settleTxHashes?.length ?? 0;
    return n ? `Settled in ${n} transaction${n > 1 ? 's' : ''}. LINE messages sent to linked farmers.` : 'Nothing left to settle.';
  }
  if (json.attestTxHash) return `Anchored on-chain in ${short(json.attestTxHash)}.`;
  return json.alreadyAttested ? 'Already anchored.' : 'Done.';
}

export function EventConsole() {
  const { data: events, isLoading, error } = useEvents();
  const client = useQueryClient();
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, { good: boolean; text: string }>>({});

  const run = async (ev: EventStatus, action: Action) => {
    setBusy(ev.id);
    setNotes((prev) => {
      const next = { ...prev };
      delete next[ev.id];
      return next;
    });
    try {
      const res = await fetch('/api/coop/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: ev.id, action, passcode }),
      });
      const json = (await res.json()) as ActionResponse;
      const text = res.status === 401 ? 'Wrong co-op passcode.' : !res.ok || !json.ok ? (json.message ?? json.error ?? `Failed (HTTP ${res.status}).`) : describe(action, json);
      setNotes((prev) => ({ ...prev, [ev.id]: { good: res.ok && !!json.ok, text } }));
      await client.invalidateQueries({ queryKey: ['coop-events'] });
      await client.invalidateQueries({ queryKey: ['escalated-runs'] });
    } catch {
      setNotes((prev) => ({ ...prev, [ev.id]: { good: false, text: 'Request failed. Check your connection and try again.' } }));
    } finally {
      setBusy(null);
    }
  };

  const sorted = [...(events ?? [])].sort((a, b) => STAGE_RANK[b.stage] - STAGE_RANK[a.stage] || b.firedOn.localeCompare(a.firedOn));

  return (
    <section className={styles.section} id="events">
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Relief events · 救済イベント</h2>
        <span className={styles.sectionHint}>Check → co-op accepts → anchor on-chain → settle each plot</span>
      </div>

      <div className={styles.field} style={{ maxWidth: 280 }}>
        <label className={styles.label} htmlFor="coop-events-passcode">
          Co-op passcode
        </label>
        <input
          id="coop-events-passcode"
          type="password"
          className={styles.input}
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="required for actions"
        />
      </div>

      {isLoading ? <p className={styles.hint}>Reading ReliefPool…</p> : null}
      {error ? <p className={styles.hint} style={{ color: 'var(--ops-bad)' }}>Couldn&rsquo;t read events: {(error as Error).message}</p> : null}

      <div className={styles.stack}>
        {sorted.map((ev) => {
          const next = ACTION_FOR[ev.stage];
          const badge = STAGE_BADGE[ev.stage];
          const rank = STAGE_RANK[ev.stage];
          const note = notes[ev.id];
          return (
            <div key={ev.id} className={styles.card}>
              <div className={styles.spread}>
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {PERIL_LABEL[ev.peril] ?? ev.peril} · {ev.species} tier {ev.tier}
                  </p>
                  <p className={styles.hint} style={{ margin: '4px 0 0' }}>
                    <span className={styles.mono}>{ev.id}</span> · crossed {ev.firedOn}
                  </p>
                </div>
                <div className={styles.row}>
                  <span className={`${styles.badge} ${badge.cls}`}>{badge.text}</span>
                  {next ? (
                    <button
                      type="button"
                      className={`${styles.buttonPrimary} ${styles.buttonSmall}`}
                      disabled={busy !== null || !passcode}
                      onClick={() => run(ev, next.action)}
                    >
                      {busy === ev.id ? next.busy : next.label}
                    </button>
                  ) : null}
                </div>
              </div>

              <ol style={{ display: 'flex', flexWrap: 'wrap', gap: 6, listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
                {STEPS.map((step, i) => {
                  const done = rank >= (STEP_DONE_AT[i] ?? Infinity);
                  const current = !done && rank === STEP_CURRENT_AT[i];
                  return (
                    <li
                      key={step.stage}
                      className={`${styles.badge} ${done ? styles.badgeGood : current ? styles.badgeWarn : styles.badgeNeutral}`}
                    >
                      {done ? '✓ ' : ''}
                      {step.label}
                    </li>
                  );
                })}
              </ol>

              {ev.escalation ? (
                <p className={styles.hint} style={{ marginTop: 10 }}>
                  Jev: {ev.escalation.jevDecision === 'attest_now' ? 'attest now' : 'co-op review'}{' '}
                  {ev.escalation.jevConfidence != null ? `${Math.round(ev.escalation.jevConfidence * 100)}%` : ''} ·{' '}
                  {ev.escalation.jevReason ?? 'no reason given'}
                </p>
              ) : null}

              {ev.attestation ? (
                <p className={styles.hint} style={{ marginTop: 10 }}>
                  Anchored{' '}
                  {ev.attestation.txHash ? (
                    <a href={`${TX}${ev.attestation.txHash}`} target="_blank" rel="noreferrer" className={styles.mono} style={LINK}>
                      {short(ev.attestation.txHash)}
                    </a>
                  ) : null}
                  {ev.attestation.dataHash ? (
                    <>
                      {' '}
                      · data <span className={styles.mono}>{short(ev.attestation.dataHash)}</span>
                    </>
                  ) : null}
                  {' '}· {ev.attestation.signers?.length ?? '?'} signers · {jpyc(ev.attestation.perUnit)} per unit ·{' '}
                  <a href={`/verify/${ev.eventId}`} style={LINK}>verify</a>
                </p>
              ) : null}

              {ev.plots.length ? (
                <div className={styles.tableWrap} style={{ marginTop: 10 }}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Plot</th>
                        <th>Result</th>
                        <th>Amount</th>
                        <th>Tx</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ev.plots.map((p) => (
                        <tr key={p.plotLabel}>
                          <td className={styles.mono}>{p.plotLabel}</td>
                          <td>
                            <span className={`${styles.badge} ${PLOT_BADGE[p.state]}`}>
                              {p.state}
                              {p.reason ? ` · ${p.reason}` : ''}
                            </span>
                          </td>
                          <td className={styles.mono}>{jpyc(p.amount)}</td>
                          <td>
                            {p.txHash ? (
                              <a href={`${TX}${p.txHash}`} target="_blank" rel="noreferrer" className={styles.mono} style={LINK}>
                                {short(p.txHash)}
                              </a>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {note ? (
                <p className={styles.hint} style={{ marginTop: 8, color: note.good ? 'var(--ops-good)' : 'var(--ops-bad)' }}>
                  {note.text}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
