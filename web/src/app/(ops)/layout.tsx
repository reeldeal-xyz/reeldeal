import type { ReactNode } from 'react';
import { Fraunces, Inter, JetBrains_Mono } from 'next/font/google';
import { Nav } from '@/components/nav';
import styles from '@/components/ui/ui.module.css';

// Route-group-scoped fonts (issues #19/#20/#21's shared visual language) — loaded here rather than the root
// layout so the map screen at "/" is untouched. next/font self-hosts these at build time, no runtime request.
const display = Fraunces({ subsets: ['latin'], weight: ['500', '600'], variable: '--ops-font-display', display: 'swap' });
const body = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--ops-font-body', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--ops-font-mono', display: 'swap' });

export default function OpsLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${styles.shell} ${display.variable} ${body.variable} ${mono.variable}`}>
      <Nav />
      {children}
    </div>
  );
}
