'use client';

import { useEffect, useState } from 'react';
import liff from '@line/liff';
import { getOrCreateWalletAddress } from '@/lib/wallet';

type Status = 'loading' | 'redirecting' | 'ready' | 'error';

interface SessionUser {
  id: string;
  displayName: string | null;
  pictureUrl: string | null;
}

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
  addressBox: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 13,
    wordBreak: 'break-all' as const,
    background: '#f9fafb',
    borderRadius: 8,
    padding: '10px 12px',
    marginTop: 8,
  },
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
  },
  error: { color: '#b91c1c', fontSize: 13, marginTop: 12 },
  note: { color: '#9ca3af', fontSize: 11, marginTop: 24, lineHeight: 1.5 },
};

export default function LiffPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [isFriend, setIsFriend] = useState<boolean | null>(null);
  const [friendPromptError, setFriendPromptError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
          body: JSON.stringify({ idToken }),
        });
        const json = (await res.json()) as { ok?: boolean; user?: SessionUser; error?: string };
        if (!res.ok || !json.ok || !json.user) {
          throw new Error(json.error ?? `session request failed (${res.status})`);
        }
        if (cancelled) return;
        setUser(json.user);

        // In-app wallet: generated on-device, never leaves this browser as a raw key.
        setAddress(getOrCreateWalletAddress());

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

  async function handleAddFriend() {
    setFriendPromptError(null);
    try {
      await liff.requestFriendship();
      // requestFriendship() doesn't report the outcome; re-check on next visit.
    } catch (err) {
      console.warn('[liff] requestFriendship failed', err);
      setFriendPromptError('友だち追加を開けませんでした。LINEアプリから直接追加してください。 / Could not open the friend-add dialog. Please add UMI from your LINE app.');
    }
  }

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API can be unavailable in some in-app browsers; not fatal.
    }
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.brand}>UMI</h1>
      <p style={styles.tagline}>養殖業者の見舞金アプリ / Relief payouts for aquaculture farmers</p>

      {status === 'loading' && <p>読み込み中… / Loading…</p>}
      {status === 'redirecting' && <p>LINEログインへ移動します… / Redirecting to LINE Login…</p>}

      {status === 'error' && (
        <div style={styles.card}>
          <p style={styles.cardTitleJa}>エラーが発生しました</p>
          <p style={styles.cardTitleEn}>Something went wrong</p>
          <p style={styles.error}>{error}</p>
        </div>
      )}

      {status === 'ready' && (
        <>
          {user && (
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
          )}

          <div style={styles.card}>
            <p style={styles.cardTitleJa}>ウォレット</p>
            <p style={styles.cardTitleEn}>Your in-app wallet</p>
            <div style={styles.addressBox}>{address ?? '—'}</div>
            <button type="button" style={styles.buttonSecondary} onClick={copyAddress}>
              {copied ? 'コピーしました / Copied' : 'アドレスをコピー / Copy address'}
            </button>
          </div>

          {isFriend === false && (
            <div style={styles.card}>
              <p style={styles.cardTitleJa}>お知らせを受け取るには友だち追加してください</p>
              <p style={styles.cardTitleEn}>Add UMI as a friend to receive payout notifications</p>
              <button type="button" style={styles.button} onClick={handleAddFriend}>
                友だち追加 / Add friend
              </button>
              {friendPromptError && <p style={styles.error}>{friendPromptError}</p>}
            </div>
          )}
        </>
      )}

      <p style={styles.note}>
        このウォレットは端末内でのみ管理されます。秘密鍵は表示・送信されません。
        <br />
        This wallet lives only on this device. The private key is never shown or sent anywhere.
      </p>
    </main>
  );
}
