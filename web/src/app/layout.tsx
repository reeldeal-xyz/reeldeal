import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { publicEnv } from '@/lib/env';
export const metadata = { title: 'ETHGlobal Tokyo', description: 'Kesennuma ocean-heat relief fund' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: 'system-ui', margin: 24 }}>
        <Providers rpcUrl={publicEnv.sepoliaRpcUrl()}>{children}</Providers>
      </body>
    </html>
  );
}
