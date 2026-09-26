'use client';

// LIFF-specific shell around the shared farmer app (issue #15's LIFF boot dance, extended by the Reown
// wallet-login work to also offer "Use without LINE"): liff.init + session (issue #13) establishes a LINE
// session the same way it always has; everything after that (plot/slot-request/World ID/status/wallet) now
// lives in components/farmer/farmer-app.tsx, shared with components/app/wallet-app.tsx's wallet-only path.
import { useCallback, useEffect, useState } from 'react';
import liff from '@line/liff';
import type { Address } from 'viem';
import { FarmerApp } from '@/components/farmer/farmer-app';
import { getOrCreateWalletAddress } from '@/lib/wallet';

type BootStatus = 'loading' | 'redirecting' | 'ready' | 'error';

interface SessionUser {
  id: string;
  displayName: string | null;
  pictureUrl: string | null;
}

export interface LiffAppProps {
  addresses: { reliefPool?: Address; humanRegistry?: Address };
  sepoliaRpcUrl?: string;
  reliefPoolDeployBlock?: string;
}

const RELOGIN_KEY = 'reeldeal:liff-relogin';

const styles = {
  main: { maxWidth: 420, margin: '0 auto', paddingBottom: 32 },
  brand: { fontSize: 28, fontWeight: 700, margin: 0 },
  tagline: { color: '#6b7280', marginTop: 4, fontSize: 14 },
  card: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  cardTitleJa: { fontWeight: 700, fontSize: 15, margin: 0 },
  cardTitleEn: { color: '#6b7280', fontSize: 12, margin: '2px 0 0' },
  profileRow: { display: 'flex', alignItems: 'center', gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  error: { color: '#b91c1c', fontSize: 13, marginTop: 12 },
  note: { color: '#9ca3af', fontSize: 11, marginTop: 24, lineHeight: 1.5 },
  linkButton: {
    marginTop: 8,
    background: 'none',
    border: 'none',
    color: '#2563eb',
    fontSize: 13,
    padding: 0,
    cursor: 'pointer',
    textDecoration: 'underline',
  },
};

export function LiffApp({ addresses, sepoliaRpcUrl, reliefPoolDeployBlock }: LiffAppProps) {
  const [status, setStatus] = useState<BootStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  // `address` is the session's *pinned* wallet (server-resolved, issue #15): where this farmer's payouts
  // actually land, used for every on-chain read/claim. `deviceAddress` is this device's own on-device
  // signing key (lib/wallet.ts) -- the two only match when this is the device that originally minted the
  // pinned wallet. FarmerApp/WalletPanel need both to know whether it can sign here.
  const [address, setAddress] = useState<Address | null>(null);
  const [deviceAddress, setDeviceAddress] = useState<Address | null>(null);
  const [isFriend, setIsFriend] = useState<boolean | null>(null);
  const [friendPromptError, setFriendPromptError] = useState<string | null>(null);
  const [plotFromQuery, setPlotFromQuery] = useState<string | null>(null);
  // liff.init({ withLoginOnExternalBrowser: true }) means this component can render in a plain browser tab
  // too (LIFF's system-browser fallback) -- show the "use without LINE" escape hatch only then, never inside
  // the real LINE in-app browser where it'd be a confusing dead end (there's no separate wallet to connect).
  const [showWalletEscapeHatch, setShowWalletEscapeHatch] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
      if (!liffId) {
        setError('NEXT_PUBLIC_LIFF_ID is not configured.');
        setStatus('error');
        return;
      }

      try {
        await liff.init({ liffId, withLoginOnExternalBrowser: true });
        if (!cancelled) setShowWalletEscapeHatch(!liff.isInClient());

        if (!liff.isLoggedIn()) {
          // Outside LINE, withLoginOnExternalBrowser should already be redirecting; this is a
          // defensive fallback (e.g. re-consent) so the farmer never gets stuck on a blank screen.
          if (!cancelled) setStatus('redirecting');
          liff.login();
          return;
        }

        const idToken = liff.getIDToken();
        if (!idToken) throw new Error('no ID token from LIFF; try reopening the app');

        const res = await fetch('/api/liff/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken, wallet: getOrCreateWalletAddress() }),
        });
        const json = (await res.json()) as { ok?: boolean; user?: SessionUser; wallet?: string | null; error?: string };
        if (res.status === 401 && !sessionStorage.getItem(RELOGIN_KEY)) {
          // LIFF keeps returning its cached ID token after it expires (~1h), which LINE then rejects.
          // Log out and back in once to get a fresh token; the flag stops a redirect loop.
          sessionStorage.setItem(RELOGIN_KEY, '1');
          if (!cancelled) setStatus('redirecting');
          liff.logout();
          liff.login({ redirectUri: window.location.href });
          return;
        }
        if (!res.ok || !json.ok || !json.user) {
          throw new Error(json.error ?? `session request failed (${res.status})`);
        }
        sessionStorage.removeItem(RELOGIN_KEY);
        if (cancelled) return;
        setUser(json.user);

        // In-app wallet: generated on-device, never leaves this browser as a raw key. The server pins the first
        // wallet a LINE user presents, so a different browser context shows that same wallet (payouts and
        // claims are relayed, so this device never needs the pinned wallet's key).
        setAddress((json.wallet as `0x${string}` | null | undefined) ?? getOrCreateWalletAddress());

        // "Request this season's slot" via a QR from the co-op screen: https://liff.line.me/<id>?plot=<label>.
        // LIFF restores the original query string onto the endpoint URL before this code runs, so it's
        // already in window.location.search by now (see the world-id/LIFF platform's `liff.state` handoff).
        const scannedPlot = new URLSearchParams(window.location.search).get('plot');
        if (scannedPlot && !cancelled) setPlotFromQuery(scannedPlot);

        // Friend-add prompt for the Official Account.
        try {
          const friendship = await liff.getFriendship();
          if (!cancelled) setIsFriend(friendship.friendFlag);
        } catch (friendshipErr) {
          console.warn('[liff] getFriendship failed', friendshipErr);
          if (!cancelled) setIsFriend(null);
        }

        if (!cancelled) setStatus('ready');
      } catch (err) {
        console.error('[liff] boot failed', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  // Read this device's own signing key client-side only (getOrCreateWalletAddress touches localStorage,
  // which throws during SSR) -- a plain effect rather than folding it into boot()'s async flow keeps this
  // independent of the session request's success/failure.
  useEffect(() => {
    setDeviceAddress(getOrCreateWalletAddress());
  }, []);

  const handleAddFriend = useCallback(async () => {
    setFriendPromptError(null);
    try {
      await liff.requestFriendship();
      // requestFriendship() doesn't report the outcome; re-check on next visit.
    } catch (err) {
      console.warn('[liff] requestFriendship failed', err);
      setFriendPromptError('友だち追加を開けませんでした。LINEアプリから直接追加してください。 / Could not open the friend-add dialog. Please add Reel Deal from your LINE app.');
    }
  }, []);

  const walletAppHref = (() => {
    const plot = plotFromQuery ?? new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('plot');
    return plot ? `/app?plot=${encodeURIComponent(plot)}` : '/app';
  })();

  return (
    <main style={styles.main}>
      <h1 style={styles.brand}>Reel Deal</h1>
      <p style={styles.tagline}>養殖業者の見舞金アプリ / Relief payouts for aquaculture farmers</p>

      {status === 'loading' && <p>読み込み中… / Loading…</p>}
      {status === 'redirecting' && <p>LINEログインへ移動します… / Redirecting to LINE Login…</p>}

      {status === 'error' && (
        <div style={styles.card}>
          <p style={styles.cardTitleJa}>エラーが発生しました</p>
          <p style={styles.cardTitleEn}>Something went wrong</p>
          <p style={styles.error}>{error}</p>
          {showWalletEscapeHatch && (
            <a href={walletAppHref} style={{ ...styles.linkButton, display: 'block' }}>
              LINEを使わずに続ける（ウォレット接続） / Use without LINE (connect a wallet)
            </a>
          )}
        </div>
      )}

      {status === 'ready' && user && address && (
        <>
          <div style={{ ...styles.card, ...styles.profileRow }}>
            {user.pictureUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.pictureUrl} alt="" style={styles.avatar} />
            )}
            <div>
              <p style={styles.cardTitleJa}>ようこそ、{user.displayName ?? 'ゲスト'}さん</p>
              <p style={styles.cardTitleEn}>Welcome{user.displayName ? `, ${user.displayName}` : ''}</p>
            </div>
          </div>

          <FarmerApp
            addresses={addresses}
            sepoliaRpcUrl={sepoliaRpcUrl}
            reliefPoolDeployBlock={reliefPoolDeployBlock}
            sessionKind="line"
            address={address}
            deviceAddress={deviceAddress}
            initialPlotLabel={plotFromQuery}
            lineFriendPrompt={{ isFriend, onAddFriend: handleAddFriend, error: friendPromptError }}
          />
        </>
      )}

      {showWalletEscapeHatch && status !== 'error' && (
        <p style={{ ...styles.note, textAlign: 'center' }}>
          <a href={walletAppHref} style={styles.linkButton}>
            LINEアカウントをお持ちでない方はこちら（ウォレットで利用） / No LINE account? Use without LINE (connect a wallet)
          </a>
        </p>
      )}

      <p style={styles.note}>
        このウォレットは端末内でのみ管理されます。秘密鍵は表示・送信されません。
        <br />
        This wallet lives only on this device. The private key is never shown or sent anywhere.
      </p>
    </main>
  );
}
