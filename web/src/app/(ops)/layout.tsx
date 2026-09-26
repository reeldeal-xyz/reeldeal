import type { ReactNode } from 'react';
import { JetBrains_Mono } from 'next/font/google';
import { Nav } from '@/components/nav';
import styles from '@/components/ui/ui.module.css';

// Route-group-scoped fonts (issues #19/#20/#21's shared visual language) — loaded here rather than the root
// layout so the map screen at "/" is untouched. next/font self-hosts these at build time, no runtime request.
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--ops-font-mono', display: 'swap' });

export default function OpsLayout({ children }: { children: ReactNode }) {
  return (
    <div data-ops-shell className={`${styles.shell} ${mono.variable}`}>
      <Nav />
      {children}
    </div>
  );
}
