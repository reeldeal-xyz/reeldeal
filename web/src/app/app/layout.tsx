// Server wrapper for /app (wallet-only sign-in, no LINE account needed): resolves the request's own origin
// server-side (never client-supplied) so Reown AppKit's metadata.url is correct from the very first
// server-rendered paint, and reads NEXT_PUBLIC_REOWN_PROJECT_ID via publicEnv the same way every other
// server-rendered address/config value in this app is threaded down to a client component.
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { WalletProviders } from '@/components/app/wallet-providers';
import { publicEnv } from '@/lib/env';

async function resolveAppUrl(): Promise<string> {
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const forwardedProto = h.get('x-forwarded-proto');
  const proto = forwardedProto ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const appUrl = await resolveAppUrl();
  return (
    <WalletProviders projectId={publicEnv.reownProjectId()} appUrl={appUrl}>
      {children}
    </WalletProviders>
  );
}
