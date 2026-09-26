'use client';

// The farmer journey shared by both sign-in paths (issue: Reown wallet login, extending #15's LIFF-only
// flow): plot pick, "request this season's slot", the World ID bind/upgrade flow, the status screen's four
// paths, and the wallet tab -- all identical regardless of *how* the farmer authenticated. What differs
// between the two callers (components/liff/liff-app.tsx for LINE, components/app/wallet-app.tsx for a
// connected wallet) is only how a session gets established in the first place; once one exists, this is the
// entire farmer-facing app. See lib/session.ts's header comment for the two session kinds.
//
// On-chain reads (World ID level, Paid/Held history, payoutTarget) run client-side via a plain viem
// publicClient against NEXT_PUBLIC_SEPOLIA_RPC_URL -- no secrets. Every address comes from the caller's
// server-rendered parent; an unset one renders a "not deployed yet" state instead of crashing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPublicClient, fallback, http, type Address, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { WorldVerify, type WorldVerifyOutcome } from '@/components/WorldVerify';
import { WalletPanel } from '@/components/liff/wallet-panel';
import { heldReasonText } from '@/lib/held-reasons';
import { formatJpyc } from '@/lib/format';
import { DEMO_PLOTS, SEASON_LABEL, ensNameForPlot } from '@/lib/plots';
import { fetchLiffStatus, fetchWorldLevel, fetchWorldSchema, type StatusPath } from '@/lib/liff/status';
import { LEVEL2_LABEL_BILINGUAL, LEVEL2_LABEL_EN, LEVEL2_LABEL_JA } from '@/lib/world/schema';
import type { SlotRequest } from '@/lib/slot-request-store';
import type { SessionKind } from '@/lib/session';

const styles = {
  card: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
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
  },
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
  return <p style={{ ...styles.smallMuted, marginTop: 8 }}>🚧 {text}</p>;
}

export interface FarmerAppProps {
  addresses: { reliefPool?: Address; humanRegistry?: Address };
  sepoliaRpcUrl?: string;
  reliefPoolDeployBlock?: string;
  sessionKind: SessionKind;
  /** The session's resolved wallet -- LINE's pinned wallet, or the connected wallet itself (lib/session.ts's
   *  `resolveSessionWallet`, mirrored client-side by whichever caller establishes the session). */
  address: Address;
  /** This device's own signing key, for WalletPanel's canSign check. LINE: the in-app key from
   *  lib/wallet.ts (may differ from `address` on a new/other device). Wallet session: always pass the same
   *  value as `address` -- the connected wallet is its own signer, there's no separate "device key". */
  deviceAddress: Address | null;
  initialPlotLabel?: string | null;
  /** LINE-only friend-add card (Official Account push notifications). Omit for a wallet session -- a
   *  "notifications need LINE" hint renders in its place instead. */
  lineFriendPrompt?: { isFriend: boolean | null; onAddFriend: () => void; error: string | null };
}

export function FarmerApp({
  addresses,
  sepoliaRpcUrl,
  reliefPoolDeployBlock,
  sessionKind,
  address,
  deviceAddress,
  initialPlotLabel,
  lineFriendPrompt,
}: FarmerAppProps) {
  // --- Plot selection ("scan → request → verify → status") -------------------------------------
  const [plotLabel, setPlotLabel] = useState<string | null>(initialPlotLabel ?? null);
  const [pickerValue, setPickerValue] = useState<string>(DEMO_PLOTS[0]?.plotLabel ?? '');

  // --- Slot request ------------------------------------------------------------------------------
  const [myRequests, setMyRequests] = useState<SlotRequest[]>([]);
  const [slotRequestBusy, setSlotRequestBusy] = useState(false);
  const [slotRequestError, setSlotRequestError] = useState<string | null>(null);

  // --- World ID bind/upgrade -----------------------------------------------------------------
  const [worldLevel, setWorldLevel] = useState<number | null>(null);
  const [worldSchemaId, setWorldSchemaId] = useState<number | null>(null);
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
    // NEXT_PUBLIC_SEPOLIA_RPC_URL may list several comma-separated RPCs; fail over when one rate-limits.
    const urls = sepoliaRpcUrl.split(',').map((u) => u.trim()).filter(Boolean);
    return createPublicClient({ chain: sepolia, transport: fallback(urls.map((u) => http(u, { retryCount: 1 })), { retryCount: 2 }) });
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
    if (!publicClient || !addresses.humanRegistry) return;
    try {
      const level = await fetchWorldLevel(publicClient, addresses.humanRegistry, address);
      setWorldLevel(level);
      // Cheap extra read (same client/call shape as levelOf) so the wallet tab can show which credential
      // verified this farmer without a second IDKit round trip -- see WalletPanel's "confirmed via" line.
      fetchWorldSchema(publicClient, addresses.humanRegistry, address)
        .then(setWorldSchemaId)
        .catch((err) => console.warn('[farmer-app] failed to read World ID schema', err));
      return level;
    } catch (err) {
      console.warn('[farmer-app] failed to read World ID level', err);
      return null;
    }
  }, [publicClient, addresses.humanRegistry, address]);

  const refreshStatus = useCallback(async () => {
    if (!publicClient || !addresses.reliefPool || !plotLabel) return;
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
      console.error('[farmer-app] failed to read status', err);
      setStatusError(err instanceof Error ? err.message : 'could not read status');
    } finally {
      setStatusLoading(false);
    }
  }, [publicClient, addresses.reliefPool, address, plotLabel, fromBlock]);

  useEffect(() => {
    refreshMyRequests();
  }, [refreshMyRequests]);

  useEffect(() => {
    refreshLevel();
  }, [refreshLevel]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  async function submitSlotRequest() {
    if (!plotLabel) return;
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
      try {
        // Best-effort: /api/world/verify already recorded this server-side (see that route's own
        // bindWalletToLineUser call); this is a fallback in case that response was dropped on the way
        // back from World App. Harmless no-op for a wallet session (it just self-maps wallet -> wallet).
        await fetch('/api/liff/world-bind', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: address }),
        });
      } catch (err) {
        console.warn('[farmer-app] world-bind (push mapping) failed', err);
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
    <>
      <WalletPanel
        client={publicClient}
        deviceAddress={deviceAddress}
        identityAddress={address}
        sessionKind={sessionKind}
        worldLevel={worldLevel}
        worldSchemaId={worldSchemaId}
        reliefPoolAddress={addresses.reliefPool}
        reliefPoolDeployBlock={fromBlock}
      />

      {/* --- Plot selection ---------------------------------------------------------------- */}
      <div style={styles.card}>
        <p style={styles.cardTitleJa}>区画</p>
        <p style={styles.cardTitleEn}>Plot</p>
        {plotLabel ? (
          <>
            <div style={styles.badgeRow}>
              <span style={{ ...styles.badge, ...styles.badgeMuted }}>{plotLabel}</span>
            </div>
            <p style={{ ...styles.smallMuted, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {ensNameForPlot(plotLabel)}
            </p>
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
            {worldLevel === null
              ? '確認中… / Checking…'
              : worldLevel === 0
                ? '未確認 / Not verified'
                : worldLevel === 2
                  ? LEVEL2_LABEL_BILINGUAL
                  : 'レベル1:セルフィーチェック / Level 1: Selfie Check'}
          </span>
        </div>

        {!addresses.humanRegistry ? (
          <NotDeployedInline text="HumanRegistry is not deployed yet — verification will be enabled once it is. / HumanRegistryが未デプロイです。" />
        ) : (
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
                label={`「${LEVEL2_LABEL_JA}」にアップグレード / Upgrade to ${LEVEL2_LABEL_EN}`}
                onComplete={handleWorldComplete}
              />
            )}
            {worldLevel === 2 && <p style={styles.smallMuted}>{LEVEL2_LABEL_BILINGUAL}で確認済みです。 / Fully verified at {LEVEL2_LABEL_BILINGUAL}.</p>}
          </>
        )}

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
                <button type="button" style={styles.button} onClick={() => handleClaim(statusPath)} disabled={claimBusy}>
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
              ) : statusPath.currentFarmer.toLowerCase() === address.toLowerCase() ? (
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

      {/* --- Push notifications: LINE-only ------------------------------------------------------ */}
      {lineFriendPrompt ? (
        lineFriendPrompt.isFriend === false && (
          <div style={styles.card}>
            <p style={styles.cardTitleJa}>お知らせを受け取るには友だち追加してください</p>
            <p style={styles.cardTitleEn}>Add Reel Deal as a friend to receive payout notifications</p>
            <button type="button" style={styles.button} onClick={lineFriendPrompt.onAddFriend}>
              友だち追加 / Add friend
            </button>
            {lineFriendPrompt.error && <p style={styles.error}>{lineFriendPrompt.error}</p>}
          </div>
        )
      ) : (
        <div style={styles.card}>
          <p style={styles.cardTitleJa}>お知らせ</p>
          <p style={styles.cardTitleEn}>Notifications</p>
          <p style={styles.smallMuted}>
            支払い通知を受け取るにはLINEでログインしてください。ウォレットでのログインでは、このステータス画面で直接確認してください。
            <br />
            Payout notifications need LINE. Signed in with a wallet: check back on this status screen directly.
          </p>
        </div>
      )}
    </>
  );
}
