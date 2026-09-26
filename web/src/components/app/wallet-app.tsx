'use client';

// /app: the wallet-or-LINE entry point (issue: let people without a LINE account use the farmer app). Two
// ways in, same destination (components/farmer/farmer-app.tsx):
//
//   Continue with LINE -- a plain link out to the LIFF endpoint (?plot= preserved), same as always.
//   Connect wallet      -- Reown AppKit modal (WalletConnect/injected/Coinbase, Sepolia only) connects a
//                           wallet, then a Sign-In With Ethereum (EIP-4361) round trip
//                           (GET /api/wallet-auth/nonce -> wallet signs -> POST /api/wallet-auth/verify)
//                           proves it holds the key and mints the same session cookie the LIFF flow uses,
//                           with `kind: 'wallet'` (lib/session.ts).
//
// Split into an "unconfigured" and "configured" half (see the bottom of this file) so `useAppKit()` -- which
// assumes `createAppKit()` already ran -- is never called when NEXT_PUBLIC_REOWN_PROJECT_ID is unset
// (Rules of Hooks: it must not be called conditionally from one component).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, useDisconnect, useSignMessage, useSwitchChain } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import type { Address } from 'viem';
import { CHAIN_ID } from '@repo/shared';
import { buildSiweMessage } from '@/lib/siwe';
import { shortAddress } from '@/lib/format';
import { FarmerApp } from '@/components/farmer/farmer-app';
import { useReownConfigured } from './wallet-providers';

export interface WalletAppProps {
  addresses: { reliefPool?: Address; humanRegistry?: Address };
  sepoliaRpcUrl?: string;
  reliefPoolDeployBlock?: string;
  initialPlotLabel: string | null;
}

const LIFF_URL = 'https://liff.line.me/2011749457-SgvM5ahH';

function lineLoginHref(plot: string | null): string {
  return plot ? `${LIFF_URL}?plot=${encodeURIComponent(plot)}` : LIFF_URL;
}

const styles = {
  main: { maxWidth: 420, margin: '0 auto', paddingBottom: 32 },
  brand: { fontSize: 28, fontWeight: 700, margin: 0 },
  tagline: { color: '#6b7280', marginTop: 4, fontSize: 14 },
  card: { border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginTop: 16 },
  cardTitleJa: { fontWeight: 700, fontSize: 15, margin: 0 },
  cardTitleEn: { color: '#6b7280', fontSize: 12, margin: '2px 0 0' },
  button: {
    marginTop: 12,
    width: '100%',
    padding: '12px 16px',
    borderRadius: 8,
    border: 'none',
    background: '#06c755',
    color: '#fff',
    fontWeight: 700,
    fontSize: 15,
    cursor: 'pointer',
    display: 'block',
    textAlign: 'center' as const,
    textDecoration: 'none',
  },
  buttonSecondary: {
    marginTop: 8,
    width: '100%',
    padding: '12px 16px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#111827',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
  buttonDisabled: { opacity: 0.5, cursor: 'default' },
  error: { color: '#b91c1c', fontSize: 13, marginTop: 12 },
  smallMuted: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  note: { color: '#9ca3af', fontSize: 11, marginTop: 24, lineHeight: 1.5 },
  addressBox: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 13,
    background: '#f9fafb',
    borderRadius: 8,
    padding: '10px 12px',
    marginTop: 8,
  },
};

interface SessionCheck {
  loading: boolean;
  wallet: Address | null;
}

/** GET /api/session on mount: skips straight to the farmer app on a return visit that already has a
 *  wallet-kind session cookie, without waiting for wagmi to reconnect first (reads never need an active
 *  wallet connection -- only signing new authorizations does, and that reconnects lazily on its own). */
function useExistingWalletSession(): SessionCheck {
  const [state, setState] = useState<SessionCheck>({ loading: true, wallet: null });
  useEffect(() => {
    let cancelled = false;
    fetch('/api/session')
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { ok?: boolean; kind?: string; wallet?: string | null } | null) => {
        if (cancelled) return;
        const wallet = json?.ok && json.kind === 'wallet' && json.wallet ? (json.wallet as Address) : null;
        setState({ loading: false, wallet });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, wallet: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

function Header() {
  return (
    <>
      <h1 style={styles.brand}>Reel Deal</h1>
      <p style={styles.tagline}>養殖業者の見舞金アプリ / Relief payouts for aquaculture farmers</p>
    </>
  );
}

export function WalletApp(props: WalletAppProps) {
  const reownConfigured = useReownConfigured();
  return reownConfigured ? <WalletAppConfigured {...props} /> : <WalletAppUnconfigured {...props} />;
}

/** NEXT_PUBLIC_REOWN_PROJECT_ID is unset: explain rather than render a "Connect wallet" button that can
 *  never open a modal. LINE sign-in still works fine either way. */
function WalletAppUnconfigured({ initialPlotLabel }: WalletAppProps) {
  return (
    <main style={styles.main}>
      <Header />
      <div style={styles.card}>
        <p style={styles.cardTitleJa}>ログイン方法を選択</p>
        <p style={styles.cardTitleEn}>Choose how to sign in</p>
        <a href={lineLoginHref(initialPlotLabel)} style={styles.button}>
          LINEで続ける / Continue with LINE
        </a>
        <button type="button" style={{ ...styles.buttonSecondary, ...styles.buttonDisabled }} disabled>
          ウォレットを接続 / Connect wallet
        </button>
        <p style={styles.smallMuted}>
          ウォレットでのログインは現在設定されていません（NEXT_PUBLIC_REOWN_PROJECT_ID 未設定）。 / Wallet
          sign-in isn&rsquo;t configured yet (NEXT_PUBLIC_REOWN_PROJECT_ID is unset).
        </p>
      </div>
    </main>
  );
}

function WalletAppConfigured({ addresses, sepoliaRpcUrl, reliefPoolDeployBlock, initialPlotLabel }: WalletAppProps) {
  const existing = useExistingWalletSession();
  const { address, isConnected, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switchingChain } = useSwitchChain();
  const appKit = useAppKit();

  const [sessionWallet, setSessionWallet] = useState<Address | null>(null);
  const [siweBusy, setSiweBusy] = useState(false);
  const [siweError, setSiweError] = useState<string | null>(null);
  const attemptedFor = useRef<string | null>(null);

  useEffect(() => {
    if (existing.wallet) setSessionWallet(existing.wallet);
  }, [existing.wallet]);

  const runSiwe = useCallback(async () => {
    if (!address) return;
    setSiweBusy(true);
    setSiweError(null);
    try {
      const nonceRes = await fetch('/api/wallet-auth/nonce');
      if (!nonceRes.ok) throw new Error('nonce_failed');
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      const issuedAt = new Date();
      const message = buildSiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in to Reel Deal.',
        uri: `${window.location.origin}/app`,
        version: '1',
        chainId: CHAIN_ID,
        nonce,
        issuedAt: issuedAt.toISOString(),
        expirationTime: new Date(issuedAt.getTime() + 5 * 60 * 1000).toISOString(),
      });

      const signature = await signMessageAsync({ message });

      const verifyRes = await fetch('/api/wallet-auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });
      const json = (await verifyRes.json().catch(() => ({}))) as { ok?: boolean; wallet?: Address; error?: string };
      if (!verifyRes.ok || !json.ok || !json.wallet) {
        throw new Error(json.error ?? 'verify_failed');
      }
      setSessionWallet(json.wallet);
    } catch (err) {
      console.warn('[wallet-app] SIWE sign-in failed', err);
      setSiweError('署名の確認に失敗しました。もう一度お試しください。 / Could not verify your signature. Please try again.');
    } finally {
      setSiweBusy(false);
    }
  }, [address, signMessageAsync]);

  // Auto-run SIWE once per newly-connected address on the right chain -- no extra tap needed beyond the
  // wallet connection itself. Doesn't retry on its own after a rejection/failure; the button below does.
  useEffect(() => {
    if (!isConnected || !address || chainId !== CHAIN_ID || sessionWallet || existing.loading) return;
    if (attemptedFor.current === address) return;
    attemptedFor.current = address;
    runSiwe();
  }, [isConnected, address, chainId, sessionWallet, existing.loading, runSiwe]);

  async function handleLogout() {
    try {
      await fetch('/api/session', { method: 'DELETE' });
    } catch {
      // best-effort
    }
    disconnect();
    setSessionWallet(null);
    attemptedFor.current = null;
  }

  if (existing.loading) {
    return (
      <main style={styles.main}>
        <Header />
        <p>読み込み中… / Loading…</p>
      </main>
    );
  }

  if (sessionWallet) {
    return (
      <main style={styles.main}>
        <Header />
        <div style={styles.card}>
          <p style={styles.cardTitleJa}>ウォレットでログイン中</p>
          <p style={styles.cardTitleEn}>Signed in with wallet</p>
          <div style={styles.addressBox}>{sessionWallet}</div>
          <button type="button" style={styles.buttonSecondary} onClick={handleLogout}>
            ログアウト / Sign out
          </button>
        </div>

        <FarmerApp
          addresses={addresses}
          sepoliaRpcUrl={sepoliaRpcUrl}
          reliefPoolDeployBlock={reliefPoolDeployBlock}
          sessionKind="wallet"
          address={sessionWallet}
          deviceAddress={sessionWallet}
          initialPlotLabel={initialPlotLabel}
        />

        <p style={styles.note}>
          このウォレットはあなた自身が管理しています。秘密鍵はこのアプリに保存されません。
          <br />
          You control this wallet yourself. Its private key is never stored by this app.
        </p>
      </main>
    );
  }

  return (
    <main style={styles.main}>
      <Header />
      <div style={styles.card}>
        <p style={styles.cardTitleJa}>ログイン方法を選択</p>
        <p style={styles.cardTitleEn}>Choose how to sign in</p>
        <a href={lineLoginHref(initialPlotLabel)} style={styles.button}>
          LINEで続ける / Continue with LINE
        </a>

        {!isConnected ? (
          <button type="button" style={styles.buttonSecondary} onClick={() => appKit.open()}>
            ウォレットを接続 / Connect wallet
          </button>
        ) : chainId !== CHAIN_ID ? (
          <button type="button" style={styles.buttonSecondary} disabled={switchingChain} onClick={() => switchChain({ chainId: CHAIN_ID })}>
            {switchingChain ? '切り替え中… / Switching…' : 'Sepoliaに切り替え / Switch to Sepolia'}
          </button>
        ) : (
          <>
            <p style={{ ...styles.smallMuted, marginTop: 12 }}>
              接続済み / Connected: {shortAddress(address ?? '')}
            </p>
            <button type="button" style={{ ...styles.button, ...(siweBusy ? styles.buttonDisabled : {}) }} disabled={siweBusy} onClick={runSiwe}>
              {siweBusy ? '署名を確認中… / Verifying signature…' : 'メッセージに署名して続ける / Sign message to continue'}
            </button>
            <button type="button" style={styles.buttonSecondary} onClick={() => disconnect()}>
              切断 / Disconnect
            </button>
          </>
        )}
        {siweError && <p style={styles.error}>{siweError}</p>}
      </div>

      <p style={styles.note}>
        ウォレットでの署名はSepoliaテストネット専用です。秘密鍵はこのアプリに送信されません。
        <br />
        Wallet sign-in is Sepolia-testnet only. Your private key is never sent to this app.
      </p>
    </main>
  );
}
