import type { ReactNode } from 'react';
export const metadata = { title: 'Umi Relief', description: 'Kesennuma ocean-heat relief fund' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="ja"><body style={{ fontFamily: 'system-ui', margin: 24 }}>{children}</body></html>);
}
