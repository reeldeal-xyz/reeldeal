import type { FeedSource } from '@/lib/feed-client';
import styles from './FixtureBadge.module.css';

/**
 * Visible provenance marker for every panel of data on /map and /verify: "live" when it came from the
 * pipeline feed (PIPELINE_FEED_URL), "fixture data" when the feed was unreachable and we fell back to
 * web/src/fixtures. Never leave data on screen without this — issue #18/#24 both depend on the demo
 * being honest about which state it's in.
 */
export function FixtureBadge({ source }: { source: FeedSource }) {
  const isFixture = source === 'fixture';
  return (
    <span className={`${styles.badge} ${isFixture ? styles.fixture : styles.live}`}>
      <span className={styles.dot} aria-hidden />
      {isFixture ? 'Fixture data' : 'Live feed'}
    </span>
  );
}
