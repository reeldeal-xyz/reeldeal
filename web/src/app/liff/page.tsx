// Server wrapper (issue #15) — mirrors app/(ops)/holder/page.tsx's pattern: NEXT_PUBLIC_* addresses are read
// here (a Server Component) via `publicEnv` and passed down as props, since `publicEnv`'s dynamic
// `process.env[k]` lookups only resolve at runtime on the server, not via Next's client-bundle inlining
// (see lib/env.ts's comment on `publicEnv`). The actual LIFF flow (liff.init, session, wallet, slot
// request, World ID bind, status) lives in the client component below.
import { LiffApp } from '@/components/liff/liff-app';
import { asAddress } from '@/lib/contracts';
import { publicEnv } from '@/lib/env';

export const metadata = { title: 'Reel Deal' };

export default function LiffPage() {
  return (
    <LiffApp
      addresses={{
        reliefPool: asAddress(publicEnv.reliefPool()),
        humanRegistry: asAddress(publicEnv.humanRegistry()),
      }}
      sepoliaRpcUrl={publicEnv.sepoliaRpcUrl()}
      reliefPoolDeployBlock={publicEnv.reliefPoolDeployBlock()}
    />
  );
}
