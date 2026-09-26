'use client';

// "Fund activity" panel (sponsor-polish task, Curvegrid MultiBaas track): totals + a per-event table
// sourced from MultiBaas's indexed ReliefPool events, with a graceful fallback to direct viem log reads
// when MultiBaas is unreachable (see web/src/lib/fund-activity.ts). Bilingual JA/EN labels, matching the
// existing ops visual language (web/src/components/ui/ui.module.css).
import type { ReactNode } from 'react';
import styles from '@/components/ui/ui.module.css';
import { useFundActivity } from '@/hooks/use-fund-activity';
import { formatJpyc, formatTimestamp, shortAddress } from '@/lib/format';
import type { FundActivityEvent } from '@/lib/fund-activity';

const etherscanTx = (txHash: string) => `https://sepolia.etherscan.io/tx/${txHash}`;

export function FundActivityPanel() {
  const { data, isLoading, error } = useFundActivity();

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Fund activity · 資金の動き</h2>
        <SourceBadge source={data?.source} />
      </div>

      {isLoading && !data ? (
        <div className={styles.emptyState}>Loading fund activity… / 読み込み中…</div>
      ) : !data || data.source === 'unavailable' ? (
        <div className={styles.emptyState}>
          No fund activity source is available yet — set MULTIBAAS_URL/MULTIBAAS_API_KEY or
          NEXT_PUBLIC_RELIEF_POOL_ADDRESS + SEPOLIA_RPC_URL.
        </div>
      ) : (
        <>
          <div className={styles.grid}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Donated · 寄付合計</span>
              <span className={styles.statValue}>{formatJpyc(BigInt(data.totals?.donatedWei ?? '0'))}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Paid out · 支払済み</span>
              <span className={styles.statValue}>{formatJpyc(BigInt(data.totals?.paidWei ?? '0'))}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Currently held · 保留中</span>
              <span className={styles.statValue}>{data.totals?.heldCount ?? 0}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Available in pool · プール残高</span>
              <span className={styles.statValue}>
                {data.totals?.availableWei ? formatJpyc(BigInt(data.totals.availableWei)) : '—'}
              </span>
            </div>
          </div>

          {error ? (
            <p className={styles.hint} style={{ color: 'var(--ops-warn)', marginTop: 10 }}>
              {(error as Error).message}
            </p>
          ) : data.error ? (
            <p className={styles.hint} style={{ color: 'var(--ops-warn)', marginTop: 10 }}>
              {data.error}
            </p>
          ) : null}

          <div className={styles.tableWrap} style={{ marginTop: 14 }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>When</th>
                  <th>Block</th>
                  <th>Detail</th>
                  <th>Amount</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {data.events.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <span style={{ color: 'var(--ops-muted-soft)' }}>No events yet. Be the first donor.</span>
                    </td>
                  </tr>
                ) : (
                  data.events.map((e, i) => (
                    <tr key={`${e.txHash}-${i}`}>
                      <td>
                        <EventBadge type={e.type} />
                      </td>
                      <td className={styles.mono}>{e.triggeredAt ? formatTimestamp(Math.floor(Date.parse(e.triggeredAt) / 1000)) : '—'}</td>
                      <td className={styles.mono}>{e.blockNumber}</td>
                      <td>{describeEvent(e)}</td>
                      <td>{e.amountWei ? formatJpyc(BigInt(e.amountWei)) : <Muted>—</Muted>}</td>
                      <td className={styles.mono}>
                        <a href={etherscanTx(e.txHash)} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                          {shortAddress(e.txHash)}
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className={styles.hint} style={{ marginTop: 10 }}>
        Powered by Curvegrid MultiBaas — event indexing over ReliefPool (`reliefpool` alias). / Curvegrid
        MultiBaas 提供
      </p>
    </section>
  );
}

function SourceBadge({ source }: { source?: 'multibaas' | 'viem' | 'unavailable' }) {
  if (source === 'multibaas') return <span className={styles.badgeGood}>MultiBaas indexed</span>;
  if (source === 'viem') return <span className={styles.badgeWarn}>Direct on-chain (fallback)</span>;
  return <span className={styles.sectionHint}>—</span>;
}

function EventBadge({ type }: { type: FundActivityEvent['type'] }) {
  if (type === 'Paid' || type === 'Claimed') return <span className={styles.badgeGood}>{type}</span>;
  if (type === 'Held') return <span className={styles.badgeWarn}>{type}</span>;
  if (type === 'Swept') return <span className={styles.badgeBad}>{type}</span>;
  return <span className={styles.badgeNeutral}>{type}</span>;
}

function Muted({ children }: { children: ReactNode }) {
  return <span style={{ color: 'var(--ops-muted-soft)' }}>{children}</span>;
}

function describeEvent(e: FundActivityEvent): ReactNode {
  switch (e.type) {
    case 'Donated':
      if (e.isMarketplaceSale) {
        return (
          <span>
            <span className={styles.badgeAccent}>Marketplace sale · 販売</span>{' '}
            <span style={{ color: 'var(--ops-muted-soft)' }}>{e.memo}</span>
          </span>
        );
      }
      return e.memo || `from ${shortAddress(e.farmer ?? '')}`;
    case 'Attested':
      return 'trigger attested';
    case 'Paid':
    case 'Claimed':
      return `plot ${e.plotLabel ?? '—'} → ${shortAddress(e.farmer ?? '')}`;
    case 'Held':
      return `plot ${e.plotLabel ?? '—'} — ${e.reason ?? ''}`;
    case 'Swept':
      return `plot ${e.plotLabel ?? '—'} swept back to pool`;
    default:
      return '';
  }
}
