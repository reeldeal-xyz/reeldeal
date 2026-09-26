'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from '@/components/ui/ui.module.css';
import { WalletConnectButton } from '@/components/ui/wallet-connect-button';

const LINKS = [
  { href: '/holder', label: 'Holder' },
  { href: '/coop', label: 'Co-op' },
  { href: '/donate', label: 'Donate' },
  { href: '/market', label: 'Market' },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className={`${styles.nav} ${styles.noPrint}`}>
      <a href="https://app.13-196-78-137.sslip.io/hmi" className={styles.brand} aria-label="ReelDeal co-op">
        <svg viewBox="154 150 946 946" width="48" height="48" aria-hidden="true" focusable="false">
          <image href="/images/reeldeal-logo.svg" width="1254" height="1254" />
        </svg>
      </a>
      <div className={styles.navLinks}>
        {LINKS.map((link) => {
          const active = pathname === link.href || pathname?.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
              aria-current={active ? 'page' : undefined}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
      <WalletConnectButton />
    </nav>
  );
}
