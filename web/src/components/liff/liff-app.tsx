'use client';

// The whole farmer journey inside LINE (issue #15): liff.init + session (issue #13) is unchanged from that
// shell; this adds "request this season's slot", the World ID bind/upgrade flow (embedding #12's
// WorldVerify), and a status screen with the four paths a farmer can be in for a given plot:
//
//   1. no_slot         -- nobody (or someone else) currently holds this plot's season slot.
//   2. held_unverified  -- Held(UNVERIFIED): verify with World ID above, then claim.
//   3. paid             -- settled (directly, or via claim) -- the relief payment landed.
//   4. held_other       -- Held for any other reason (NO_FARMER/PLOT_EXPIRED/CAP/ZONE_MISMATCH), or the
//                          claim window elapsed -- nothing to do here; contact the co-op.
//
// On-chain reads (World ID level, Paid/Held history, payoutTarget) run client-side via a plain viem
// publicClient against NEXT_PUBLIC_SEPOLIA_RPC_URL -- no secrets, no wagmi/WalletConnect needed for an
// in-app wallet the farmer never has to "connect". Every address comes from the server-rendered parent
// (app/liff/page.tsx); an unset one renders a "not deployed yet" state instead of crashing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import liff from '@line/liff';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { WorldVerify, type WorldVerifyOutcome } from '@/components/WorldVerify';
import { heldReasonText } from '@/lib/held-reasons';
import { formatJpyc } from '@/lib/format';
import { DEMO_PLOTS, SEASON_LABEL } from '@/lib/plots';
import { fetchLiffStatus, fetchWorldLevel, type StatusPath } from '@/lib/liff/status';
import type { SlotRequest } from '@/lib/slot-request-store';
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
    cursor: 'pointer',
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
  select: {
    marginTop: 8,
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    fontSize: 14,
    background: '#fff',
  },
  error: { color: '#b91c1c', fontSize: 13, marginTop: 12 },
  note: { color: '#9ca3af', fontSize: 11, marginTop: 24, lineHeight: 1.5 },
  smallMuted: { color: '#6b7280', fontSize: 12, marginTop: 4 },
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
  badgeRow: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' as const },
  badge: {
    display: 'inline-block',
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 999,
    padding: '4px 10px',
  },
  badgeMuted: { background: '#f3f4f6', color: '#374151' },
  badgeSuccess: { background: '#e7f6ec', color: '#0f9d58' },
  badgeHeld: { background: '#fdf3e2', color: '#b6790a' },
  banner: { borderRadius: 8, padding: '10px 12px', marginTop: 8, fontSize: 13 },
  bannerSuccess: { background: '#e7f6ec', color: '#0f6b39' },
  bannerError: { background: '#fdecec', color: '#b91c1c' },
};

function NotDeployedInline({ text }: { text: string }) {
  return (
    <p style={{ ...styles.smallMuted, marginTop: 8 }}>
      🚧 {text}
    </p>
  );
}

export function LiffApp({ addresses, sepoliaRpcUrl, reliefPoolDeployBlock }: LiffAppProps) {
  const [status, setStatus] = useState<BootStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [address, setAddress] = useState<Address | null>(null);
  const [isFriend, setIsFriend] = useState<boolean | null>(null);
  const [friendPromptError, setFriendPromptError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // --- Plot selection ("scan → request → verify → status") -------------------------------------
  const [plotLabel, setPlotLabel] = useState<string | null>(null);
  const [pickerValue, setPickerValue] = useState<string>(DEMO_PLOTS[0]?.plotLabel ?? '');

  // --- Slot request ------------------------------------------------------------------------------
  const [myRequests, setMyRequests] = useState<SlotRequest[]>([]);
  const [slotRequestBusy, setSlotRequestBusy] = useState(false);
  const [slotRequestError, setSlotRequestError] = useState<string | null>(null);

  // --- World ID bind/upgrade -----------------------------------------------------------------
  const [worldLevel, setWorldLevel] = useState<number | null>(null);
  const [worldBanner, setWorldBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  // --- Status screen -------------------------------------------------------------------------
  const [statusPath, setStatusPath] = useState<StatusPath | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimTxHash, setClaimTxHash] = useState<Hex | null>(null);

  const publicClient = useMemo(() => {
    if (!sepoliaRpcUrl) return null;
    return createPublicClient({ chain: sepolia, transport: http(sepoliaRpcUrl) });
  }, [sepoliaRpcUrl]);

  const fromBlock = useMemo(() => {
    try {
      return reliefPoolDeployBlock ? BigInt(reliefPoolDeployBlock) : 0n;
    } catch {
      return 0n;
    }
  }, [reliefPoolDeployBlock]);

  const refreshMyRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/liff/slot-request');
      if (!res.ok) return;
      const json = (await res.json()) as { requests: SlotRequest[] };
      setMyRequests(json.requests);
    } catch {
      // best-effort; the slot-request card just shows no prior request.
    }
  }, []);

  const refreshLevel = useCallback(async () => {
    if (!publicClient || !addresses.humanRegistry || !address) return;
    try {
      const level = await fetchWorldLevel(publicClient, addresses.humanRegistry, address);
      setWorldLevel(level);
      return level;
    } catch (err) {
      console.warn('[liff] failed to read World ID level', err);
      return null;
    }
  }, [publicClient, addresses.humanRegistry, address]);

  const refreshStatus = useCallback(async () => {
    if (!publicClient || !addresses.reliefPool || !address || !plotLabel) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const path = await fetchLiffStatus({
        client: publicClient,
        reliefPoolAddress: addresses.reliefPool,
        plotLabel,
        seasonLabel: SEASON_LABEL,
        wallet: address,
        fromBlock,
      });
      setStatusPath(path);
    } catch (err) {
      console.error('[liff] failed to read status', err);
      setStatusError(err instanceof Error ? err.message : 'could not read status');
    } finally {
      setStatusLoading(false);
    }
  }, [publicClient, addresses.reliefPool, address, plotLabel, fromBlock]);

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
        if (scannedPlot) setPlotLabel(scannedPlot);

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

  useEffect(() => {
    if (status === 'ready') refreshMyRequests();
  }, [status, refreshMyRequests]);

  useEffect(() => {
    refreshLevel();
  }, [refreshLevel]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  async function handleAddFriend() {
    setFriendPromptError(null);
    try {
      await liff.requestFriendship();
      // requestFriendship() doesn't report the outcome; re-check on next visit.
    } catch (err) {
      console.warn('[liff] requestFriendship failed', err);
      setFriendPromptError('友だち追加を開けませんでした。LINEアプリから直接追加してください。 / Could not open the friend-add dialog. Please add Reel Deal from your LINE app.');
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

  async function submitSlotRequest() {
    if (!plotLabel || !address) return;
    setSlotRequestBusy(true);
    setSlotRequestError(null);
    try {
      const res = await fetch('/api/liff/slot-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plotLabel, wallet: address }),
      });
      const json = (await res.json()) as { request?: SlotRequest; error?: string };
      if (!res.ok || !json.request) {
        setSlotRequestError(json.error ?? `request failed (${res.status})`);
        return;
      }
      setMyRequests((prev) => [json.request!, ...prev.filter((r) => r.id !== json.request!.id)]);
    } catch {
      setSlotRequestError('リクエストを送信できませんでした / Could not send the request.');
    } finally {
      setSlotRequestBusy(false);
    }
  }

  async function handleWorldComplete(outcome: WorldVerifyOutcome) {
    if (outcome.status === 'success') {
      setWorldBanner({ kind: 'success', message: '確認が完了しました / Verification complete.' });
      if (address) {
        try {
          await fetch('/api/liff/world-bind', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet: address }),
          });
        } catch (err) {
          // Best-effort: the wallet is already bound on-chain (HumanRegistry) either way; this only affects
          // whether a future Paid/Held push reaches this LINE user (see lib/payout-directory.ts).
          console.warn('[liff] world-bind (LINE mapping) failed', err);
        }
      }
      // The bind tx may still be pending: re-read the level until it shows up (up to ~45s).
      for (let i = 0; i < 15; i++) {
        const level = await refreshLevel();
        if (level && level > 0) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
      refreshStatus();
    } else {
      setWorldBanner({ kind: 'error', message: outcome.message });
    }
  }

  async function handleClaim(path: Extract<StatusPath, { kind: 'held_unverified' }>) {
    setClaimBusy(true);
    setClaimError(null);
    setClaimTxHash(null);
    try {
      const res = await fetch('/api/liff/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: path.eventId, plotLabel: path.plotLabel }),
      });
      const json = (await res.json()) as { ok?: boolean; txHash?: Hex; message?: string; error?: string };
      if (!res.ok || !json.ok) {
        setClaimError(json.message ?? json.error ?? `claim failed (${res.status})`);
        return;
      }
      setClaimTxHash(json.txHash ?? null);
      refreshStatus();
    } catch {
      setClaimError('受け取りに失敗しました / Could not claim. Please try again.');
    } finally {
      setClaimBusy(false);
    }
  }

  const activeRequest = plotLabel ? myRequests.find((r) => r.plotLabel === plotLabel && r.status !== 'revoked') : undefined;

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

          {/* --- Plot selection ---------------------------------------------------------------- */}
          <div style={styles.card}>
            <p style={styles.cardTitleJa}>区画</p>
            <p style={styles.cardTitleEn}>Plot</p>
            {plotLabel ? (
              <>
                <div style={styles.badgeRow}>
                  <span style={{ ...styles.badge, ...styles.badgeMuted }}>{plotLabel}</span>
                </div>
                <button type="button" style={styles.linkButton} onClick={() => setPlotLabel(null)}>
                  区画を変更 / Change plot
                </button>
              </>
            ) : (
              <>
                <p style={styles.smallMuted}>
                  組合の画面のQRコードをスキャンするか、下から区画を選んでください。
                  <br />
                  Scan the QR code from the co-op screen, or pick a plot below.
                </p>
                <select style={styles.select} value={pickerValue} onChange={(e) => setPickerValue(e.target.value)}>
                  {DEMO_PLOTS.map((p) => (
                    <option key={p.plotLabel} value={p.plotLabel}>
                      {p.plotLabel} ({p.species})
                    </option>
                  ))}
                </select>
                <button type="button" style={styles.button} onClick={() => setPlotLabel(pickerValue)} disabled={!pickerValue}>
                  この区画を使う / Use this plot
                </button>
              </>
            )}
          </div>

          {/* --- Slot request -------------------------------------------------------------------- */}
          {plotLabel && (
            <div style={styles.card}>
              <p style={styles.cardTitleJa}>今季の区画をリクエスト</p>
              <p style={styles.cardTitleEn}>Request this season&rsquo;s slot ({SEASON_LABEL})</p>

              {activeRequest ? (
                <div style={styles.badgeRow}>
                  <span
                    style={{
                      ...styles.badge,
                      ...(activeRequest.status === 'issued' ? styles.badgeSuccess : styles.badgeHeld),
                    }}
                  >
                    {activeRequest.status === 'issued' ? '発行済み / Issued' : 'リクエスト中 / Pending'}
                  </span>
                </div>
              ) : (
                <button type="button" style={styles.button} onClick={submitSlotRequest} disabled={slotRequestBusy}>
                  {slotRequestBusy ? '送信中… / Sending…' : 'リクエストする / Request slot'}
                </button>
              )}
              {slotRequestError && <p style={styles.error}>{slotRequestError}</p>}
            </div>
          )}

          {/* --- World ID bind / upgrade ---------------------------------------------------------- */}
          <div style={styles.card}>
            <p style={styles.cardTitleJa}>本人確認 (World ID)</p>
            <p style={styles.cardTitleEn}>Identity verification</p>

            <div style={styles.badgeRow}>
              <span style={{ ...styles.badge, ...(worldLevel && worldLevel > 0 ? styles.badgeSuccess : styles.badgeMuted) }}>
                {worldLevel === null ? '確認中… / Checking…' : worldLevel === 0 ? '未確認 / Not verified' : `レベル ${worldLevel} / Level ${worldLevel}`}
              </span>
            </div>

            {!addresses.humanRegistry ? (
              <NotDeployedInline text="HumanRegistry is not deployed yet — verification will be enabled once it is. / HumanRegistryが未デプロイです。" />
            ) : address ? (
              <>
                {(worldLevel ?? 0) === 0 && (
                  <WorldVerify
                    wallet={address}
                    level="level1"
                    label="World IDで確認する (かんたん本人確認) / Verify with World ID (Selfie Check)"
                    onComplete={handleWorldComplete}
                  />
                )}
                {worldLevel === 1 && (
                  <WorldVerify
                    wallet={address}
                    level="level2"
                    label="マイナンバーカードでアップグレード / Upgrade with My Number Card"
                    onComplete={handleWorldComplete}
                  />
                )}
                {worldLevel === 2 && <p style={styles.smallMuted}>最高レベルで確認済みです。 / Fully verified.</p>}
              </>
            ) : null}

            {worldBanner && (
              <div style={{ ...styles.banner, ...(worldBanner.kind === 'success' ? styles.bannerSuccess : styles.bannerError) }}>
                {worldBanner.message}
              </div>
            )}
          </div>

          {/* --- Status ---------------------------------------------------------------------------- */}
          {plotLabel && (
            <div style={styles.card}>
              <p style={styles.cardTitleJa}>ステータス</p>
              <p style={styles.cardTitleEn}>Status — {plotLabel}</p>

              {!addresses.reliefPool || !sepoliaRpcUrl ? (
                <NotDeployedInline text="ReliefPool is not deployed yet — status will show once it is. / ReliefPoolが未デプロイです。" />
              ) : statusLoading && !statusPath ? (
                <p style={styles.smallMuted}>読み込み中… / Loading…</p>
              ) : statusError ? (
                <p style={styles.error}>{statusError}</p>
              ) : statusPath?.kind === 'paid' ? (
                <>
                  <div style={styles.badgeRow}>
                    <span style={{ ...styles.badge, ...styles.badgeSuccess }}>受け取り済み / Paid</span>
                  </div>
                  <p style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>{formatJpyc(statusPath.amountWei)}</p>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${statusPath.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12, color: '#2563eb' }}
                  >
                    Etherscanで見る / View on Etherscan
                  </a>
                </>
              ) : statusPath?.kind === 'held_unverified' ? (
                <>
                  <div style={styles.badgeRow}>
                    <span style={{ ...styles.badge, ...styles.badgeHeld }}>保留中 / Held</span>
                  </div>
                  <p style={styles.smallMuted}>{heldReasonText('UNVERIFIED').reasonJa}</p>
                  <p style={styles.smallMuted}>{heldReasonText('UNVERIFIED').reasonEn}</p>
                  {(worldLevel ?? 0) > 0 ? (
                    <button
                      type="button"
                      style={styles.button}
                      onClick={() => handleClaim(statusPath)}
                      disabled={claimBusy}
                    >
                      {claimBusy ? '受け取り中… / Claiming…' : '受け取る / Claim now'}
                    </button>
                  ) : (
                    <p style={styles.smallMuted}>上の「World IDで確認する」を完了してから戻ってきてください。 / Verify with World ID above, then come back here.</p>
                  )}
                  {claimError && <p style={styles.error}>{claimError}</p>}
                  {claimTxHash && (
                    <div style={{ ...styles.banner, ...styles.bannerSuccess }}>
                      受け取りました / Claimed —{' '}
                      <a href={`https://sepolia.etherscan.io/tx/${claimTxHash}`} target="_blank" rel="noreferrer">
                        Etherscan
                      </a>
                    </div>
                  )}
                </>
              ) : statusPath?.kind === 'held_other' ? (
                <>
                  <div style={styles.badgeRow}>
                    <span style={{ ...styles.badge, ...styles.badgeHeld }}>保留中 / Held</span>
                  </div>
                  <p style={styles.smallMuted}>{heldReasonText(statusPath.reason).reasonJa}</p>
                  <p style={styles.smallMuted}>{heldReasonText(statusPath.reason).reasonEn}</p>
                </>
              ) : statusPath?.kind === 'no_slot' ? (
                <>
                  <div style={styles.badgeRow}>
                    <span style={{ ...styles.badge, ...styles.badgeMuted }}>未発行 / No slot yet</span>
                  </div>
                  {statusPath.currentFarmer === null ? (
                    <p style={styles.smallMuted}>
                      まだ誰もこの区画の担い手ではありません。上のリクエストを送信してください。
                      <br />
                      No one holds this plot&rsquo;s season slot yet — submit the request above.
                    </p>
                  ) : address && statusPath.currentFarmer.toLowerCase() === address.toLowerCase() ? (
                    <p style={styles.smallMuted}>
                      あなたがこの区画の担い手です。まだ支払いイベントはありません。
                      <br />
                      You hold this plot&rsquo;s slot. No relief event has settled it yet.
                    </p>
                  ) : (
                    <p style={styles.smallMuted}>
                      この区画は別のウォレットの担い手です。
                      <br />
                      This plot&rsquo;s slot currently belongs to a different wallet.
                    </p>
                  )}
                </>
              ) : (
                <p style={styles.smallMuted}>読み込み中… / Loading…</p>
              )}
            </div>
          )}

          {isFriend === false && (
            <div style={styles.card}>
              <p style={styles.cardTitleJa}>お知らせを受け取るには友だち追加してください</p>
              <p style={styles.cardTitleEn}>Add Reel Deal as a friend to receive payout notifications</p>
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
