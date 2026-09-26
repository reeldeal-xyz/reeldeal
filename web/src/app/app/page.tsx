// /app -- the wallet-or-LINE entry point (mirrors app/liff/page.tsx's pattern): NEXT_PUBLIC_* addresses are
// read here (a Server Component) via `publicEnv` and passed down as props, since `publicEnv`'s dynamic
// `process.env[k]` lookups only resolve at runtime on the server, not via Next's client-bundle inlining. The
// actual chooser (Continue with LINE / Connect wallet) and, once a wallet's connected + SIWE-signed, the
// full farmer app lives in the client component below.
import { WalletApp } from '@/components/app/wallet-app';
import { asAddress } from '@/lib/contracts';
import { publicEnv } from '@/lib/env';

export const metadata = { title: 'Reel Deal' };

export default async function AppEntryPage({ searchParams }: { searchParams: Promise<{ plot?: string }> }) {
  const { plot } = await searchParams;
  return (
    <WalletApp
      addresses={{
        reliefPool: asAddress(publicEnv.reliefPool()),
        humanRegistry: asAddress(publicEnv.humanRegistry()),
      }}
      sepoliaRpcUrl={publicEnv.sepoliaRpcUrl()}
      reliefPoolDeployBlock={publicEnv.reliefPoolDeployBlock()}
      initialPlotLabel={plot ?? null}
    />
  );
}
