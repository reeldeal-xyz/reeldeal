'use client';

import { computeIndices, evaluateRules, parseErddapCsv, sha256Hex, type BuoyFile } from '@repo/shared';
import { useEffect, useState } from 'react';
import { FixtureBadge } from '@/components/ui/FixtureBadge';
import type { FeedSource } from '@/lib/feed-client';
import styles from './VerifyClient.module.css';

export interface ResolvedEventProps {
  zone: string;
  dataSeason: string;
  label: string;
  species: string;
  peril: string;
  tier: number;
  firedOn: string;
  dataHash: string;
  index: number;
  threshold: number;
  triggersSource: FeedSource;
}

export type OnChainProps =
  | { deployed: false }
  | { deployed: true; found: false; error?: string }
  | {
      deployed: true;
      found: true;
      dataHash: string;
      firedAt: string; // unix seconds, as a string (bigint doesn't cross the RSC boundary cleanly)
      index: number;
      threshold: number;
      txHash: string;
      blockNumber: string;
    };

export interface VerifyClientProps {
  resolved: ResolvedEventProps;
  csv: { text: string; source: FeedSource; url: string } | null;
  onChain: OnChainProps;
  buoy: { data: BuoyFile; source: FeedSource } | null;
}

type Recompute = { status: 'pending' } | { status: 'error' } | { status: 'done'; hash: string; firedOn: string | null; index: number | null };

function Pill({ ok, label }: { ok: boolean | null; label?: string }) {
  const cls = ok === null ? styles.pillPending : ok ? styles.pillMatch : styles.pillMismatch;
  const text = label ?? (ok === null ? 'pending' : ok ? 'match' : 'mismatch');
  return <span className={`${styles.pill} ${cls}`}>{text}</span>;
}

function unixToDate(seconds: string | bigint): string {
  return new Date(Number(seconds) * 1000).toISOString().slice(0, 10);
}

export function VerifyClient({ resolved, csv, onChain, buoy }: VerifyClientProps) {
  const [recompute, setRecompute] = useState<Recompute>({ status: 'pending' });

  useEffect(() => {
    if (!csv) return;
    let cancelled = false;
    (async () => {
      try {
        const hash = await sha256Hex(csv.text);
        const indices = computeIndices(parseErddapCsv(csv.text));
        const fired = evaluateRules(indices).find(
          (f) => f.rule.species === resolved.species && f.rule.peril === resolved.peril && f.rule.tier === resolved.tier,
        );
        if (!cancelled) setRecompute({ status: 'done', hash, firedOn: fired?.firedOn ?? null, index: fired?.index ?? null });
      } catch {
        if (!cancelled) setRecompute({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [csv, resolved.species, resolved.peril, resolved.tier]);

  // BANWEEKS events are pinned to a PDF, not a CSV — the in-browser recompute here only implements the
  // HEAT/SST path (#24's scope). Show what's recorded and the on-chain comparison, skip the CSV step.
  if (!csv) {
    return (
      <div>
        <div className={`${styles.banner} ${styles.bannerPending}`}>
          <span className={styles.bannerIcon}>ℹ️</span>
          Recorded, not recomputed — {resolved.peril} events are sourced from a PDF toxin-ban record, and
          in-browser recompute here only covers the SST/HEAT path.
        </div>
        <RecordedCard resolved={resolved} />
        <OnChainCard onChain={onChain} recomputedHash={null} />
      </div>
    );
  }

  const hashMatch = recompute.status === 'done' ? `0x${recompute.hash}`.toLowerCase() === resolved.dataHash.toLowerCase() : null;
  const dateMatch = recompute.status === 'done' ? recompute.firedOn === resolved.firedOn : null;
  const overall = recompute.status === 'pending' ? 'pending' : recompute.status === 'error' ? 'mismatch' : hashMatch && dateMatch ? 'match' : 'mismatch';

  return (
    <div>
      <div
        className={`${styles.banner} ${overall === 'match' ? styles.bannerMatch : overall === 'mismatch' ? styles.bannerMismatch : styles.bannerPending}`}
      >
        <span className={styles.bannerIcon}>{overall === 'match' ? '✓' : overall === 'mismatch' ? '✕' : '…'}</span>
        {overall === 'pending'
          ? 'Computing sha256 and re-running the index in your browser…'
          : overall === 'match'
            ? 'Recomputed from the pinned CSV — matches the recorded trigger.'
            : recompute.status === 'error'
              ? 'Could not parse the pinned CSV in this browser.'
              : `Recomputed from the pinned CSV — does not match the recorded trigger.`}
      </div>

      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Recomputed in your browser (Web Crypto)</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>CSV source</span>
          <span className={styles.rowValue}>
            <FixtureBadge source={csv.source} /> <a href={csv.url}>{csv.url.length > 60 ? `${csv.url.slice(0, 60)}…` : csv.url}</a>
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>sha256(csv)</span>
          <span className={styles.rowValue}>
            {recompute.status === 'done' ? `0x${recompute.hash}` : '…'}
            <Pill ok={hashMatch} />
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Fire date ({resolved.label})</span>
          <span className={styles.rowValue}>
            {recompute.status === 'done' ? (recompute.firedOn ?? 'never fires') : '…'}
            <Pill ok={dateMatch} />
          </span>
        </div>
      </div>

      <RecordedCard resolved={resolved} />
      <OnChainCard onChain={onChain} recomputedHash={recompute.status === 'done' ? `0x${recompute.hash}` : null} />
      {buoy ? <BuoyCard buoy={buoy} firedOn={resolved.firedOn} /> : null}
    </div>
  );
}

function RecordedCard({ resolved }: { resolved: ResolvedEventProps }) {
  return (
    <div className={styles.card}>
      <h2 className={styles.sectionTitle}>Recorded (off-chain feed/fixture)</h2>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Zone / season</span>
        <span className={styles.rowValue}>
          {resolved.zone} · {resolved.dataSeason} <FixtureBadge source={resolved.triggersSource} />
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>dataHash</span>
        <span className={styles.rowValue}>{resolved.dataHash}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Fired on</span>
        <span className={styles.rowValue}>{resolved.firedOn}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Index / threshold</span>
        <span className={styles.rowValue}>
          {resolved.index} / {resolved.threshold}
        </span>
      </div>
    </div>
  );
}

function OnChainCard({ onChain, recomputedHash }: { onChain: OnChainProps; recomputedHash: string | null }) {
  if (!onChain.deployed) {
    return (
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>On-chain</h2>
        <p className={styles.footnote}>ReliefPool is not deployed yet (issue #16) — set RELIEF_POOL to enable this check.</p>
      </div>
    );
  }
  if (!onChain.found) {
    return (
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>On-chain</h2>
        <p className={styles.footnote}>{onChain.error ? `Could not read ReliefPool: ${onChain.error}` : 'No Attested event found for this eventId yet.'}</p>
      </div>
    );
  }
  const hashMatch = recomputedHash ? recomputedHash.toLowerCase() === onChain.dataHash.toLowerCase() : null;
  return (
    <div className={styles.card}>
      <h2 className={styles.sectionTitle}>On-chain (ReliefPool.Attested)</h2>
      <div className={styles.row}>
        <span className={styles.rowLabel}>dataHash</span>
        <span className={styles.rowValue}>
          {onChain.dataHash}
          <Pill ok={hashMatch} />
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Fired at</span>
        <span className={styles.rowValue}>{unixToDate(onChain.firedAt)}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Transaction</span>
        <span className={styles.rowValue}>
          {onChain.txHash.slice(0, 10)}… (block {onChain.blockNumber})
        </span>
      </div>
    </div>
  );
}

function BuoyCard({ buoy, firedOn }: { buoy: { data: BuoyFile; source: FeedSource }; firedOn: string }) {
  const idx = buoy.data.readings.findIndex((r) => r.at.startsWith(firedOn));
  const window = idx >= 0 ? buoy.data.readings.slice(Math.max(0, idx - 2), idx + 3) : buoy.data.readings.slice(0, 5);
  return (
    <div className={styles.card}>
      <h2 className={styles.sectionTitle}>
        Futatsune buoy overlay <FixtureBadge source={buoy.source} />
      </h2>
      {buoy.data.vsSatellite ? (
        <p className={styles.footnote}>
          Buoy runs {buoy.data.vsSatellite.meanDiffC.toFixed(2)}°C vs. satellite on average this month (range{' '}
          {buoy.data.vsSatellite.minDiffC.toFixed(2)} to {buoy.data.vsSatellite.maxDiffC.toFixed(2)}) — the in-bay reality check.
        </p>
      ) : null}
      <table className={styles.buoyTable}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Temp (°C)</th>
          </tr>
        </thead>
        <tbody>
          {window.map((r) => (
            <tr key={r.at} style={r.at.startsWith(firedOn) ? { color: 'var(--heat-300)' } : undefined}>
              <td>{r.at}</td>
              <td>{r.tempC.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
