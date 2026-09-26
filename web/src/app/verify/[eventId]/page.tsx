import type { Metadata } from 'next';
import Link from 'next/link';
import type { Hex } from 'viem';
import { VerifyClient, type OnChainProps } from '@/components/verify/VerifyClient';
import { getBuoy, getCsv } from '@/lib/feed-client';
import { readOnChainTrigger } from '@/lib/onchain-trigger';
import { resolveEvent } from '@/lib/resolve-event';
import '@/styles/ocean-theme.css';
import styles from './verify.module.css';

export const metadata: Metadata = { title: 'Verify a trigger — Real Deal' };

export default async function VerifyPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const resolved = /^0x[0-9a-fA-F]{64}$/.test(eventId) ? await resolveEvent(eventId) : null;

  if (!resolved) {
    return (
      <main className={`oceanRoot ${styles.page}`}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Real Deal — recompute</p>
          <h1 className={styles.title}>Unknown event</h1>
          <p className={styles.eventId}>{eventId}</p>
        </header>
        <div className={styles.notFound}>
          <p>
            This doesn&apos;t match any (zone, species, peril, tier) combination in RULES for the 2022-2025 replay or the 2026
            toxin ban. Pick an event from <Link className={styles.link} href="/map">the map</Link> instead.
          </p>
        </div>
      </main>
    );
  }

  const isHeat = resolved.peril !== 'BANWEEKS';
  const [csv, buoy, onChainRaw] = await Promise.all([
    isHeat ? getCsv(resolved.zone, resolved.dataSeason) : Promise.resolve(null),
    getBuoy(resolved.firedOn.slice(0, 7)),
    readOnChainTrigger(eventId as Hex),
  ]);

  const onChain: OnChainProps = !onChainRaw.deployed
    ? { deployed: false }
    : !onChainRaw.found
      ? { deployed: true, found: false, error: onChainRaw.error }
      : {
          deployed: true,
          found: true,
          dataHash: onChainRaw.data.dataHash,
          firedAt: onChainRaw.data.firedAt.toString(),
          index: onChainRaw.data.index,
          threshold: onChainRaw.data.threshold,
          txHash: onChainRaw.data.txHash,
          blockNumber: onChainRaw.data.blockNumber.toString(),
        };

  return (
    <main className={`oceanRoot ${styles.page}`}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>Real Deal — recompute</p>
        <h1 className={styles.title}>
          {resolved.zone} · {resolved.label} · {resolved.dataSeason}
        </h1>
        <p className={styles.eventId}>{eventId}</p>
      </header>
      <VerifyClient resolved={resolved} csv={csv} onChain={onChain} buoy={buoy} />
    </main>
  );
}
