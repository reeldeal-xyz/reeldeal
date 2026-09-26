'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from '@/components/ui/ui.module.css';
import { WalletConnectButton } from '@/components/ui/wallet-connect-button';

const LINKS = [
  { href: '/holder', label: 'Holder' },
  { href: '/coop', label: 'Co-op' },
  { href: '/donate', label: 'Donate' },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className={`${styles.nav} ${styles.noPrint}`}>
      <Link href="/" className={styles.brand}>
        <span className={styles.brandMark}>Reel Deal</span>
        <span className={styles.brandSub}>Kesennuma relief fund</span>
      </Link>
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
