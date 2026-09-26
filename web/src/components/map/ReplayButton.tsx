import Link from 'next/link';
import styles from './ReplayButton.module.css';

/**
 * Sends the viewer to the co-op event console (/coop#events), where a replayed trigger is checked,
 * accepted by the co-op, anchored on-chain and settled step by step. Running the keeper spends real
 * JPYC and gas, so it stays behind the co-op passcode there rather than on this public map.
 */
export function ReplayButton({ zone, season }: { zone: string; season: string }) {
  return (
    <div className={styles.wrap}>
      <Link href="/coop#events" className={styles.button}>
        Replay this trigger
      </Link>
      <span className={styles.status}>
        {zone} · {season}: opens the co-op event console
      </span>
    </div>
  );
}
