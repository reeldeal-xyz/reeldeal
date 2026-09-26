'use client';

// Wallet tab for the LIFF app (wallet management): address + QR + copy, JPYC/ETH balances, World ID level
// badge, recent activity, gasless "Send JPYC", and the recovery-key backup/import flow. Split out of
// liff-app.tsx (like WorldVerify.tsx) so that file doesn't have to grow to hold all of this.
//
// Read-only mode: the server pins one wallet per LINE user (POST /api/liff/session's `wallet`) so a farmer
// always sees the *same* payout address across devices/reinstalls -- but this device can only sign for that
// address if its own on-device key (lib/wallet.ts, localStorage) happens to be the one that got pinned. When
// `deviceAddress` and `identityAddress` differ, this device holds a *different* key than the one this LINE
// account actually receives JPYC at, so signing here would just produce a signature that recovers to the
// wrong address and gets rejected by the relay (lib/liff/wallet-relay.ts checks `signer === pinned wallet`).
// Rather than let the farmer hit that dead end, the send/backup actions are disabled up front with a plain
// explanation, and "Import key" lets them restore the actual pinned wallet's key here if they have it.
import { useCallback, useEffect, useState } from 'react';
import type { Address, Hex, PublicClient } from 'viem';
import { parseUnits } from 'viem';
import { useSignTypedData, useWriteContract } from 'wagmi';
import QRCode from 'qrcode';
import { CHAIN_ID, JPYC, JPYC_DECIMALS, JPYC_EIP712_DOMAIN, JpycAbi } from '@repo/shared';
import { formatJpyc, shortAddress } from '@/lib/format';
import { exportPrivateKey, getOrCreateWalletAccount, hasWallet, importPrivateKey } from '@/lib/wallet';
import {
  randomNonce,
  signTransferAuthorization,
  TRANSFER_AUTHORIZATION_WINDOW_SECONDS,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
} from '@/lib/liff/wallet-authorization';
import { fetchWalletActivity, type WalletActivityItem } from '@/lib/liff/wallet-activity';
import { credentialLabelForSchema, LEVEL2_LABEL_BILINGUAL } from '@/lib/world/schema';
import type { SessionKind } from '@/lib/session';

export type WalletPanelClient = Pick<PublicClient, 'readContract' | 'getBalance' | 'getLogs'>;

export interface WalletPanelProps {
  client: WalletPanelClient | null;
  /** This device's own signing key (lib/wallet.ts) for a LINE session. For a wallet session, callers pass
   *  the same value as `identityAddress` -- the connected wallet is its own signer, so this always "matches"
   *  and the canSign check below stays true. Null until the effect that reads it has run. */
  deviceAddress: Address | null;
  /** The session's pinned wallet -- where this farmer's payouts actually land (POST /api/liff/session), or
   *  the connected wallet itself for a wallet session. */
  identityAddress: Address | null;
  /** 'line': sign the gasless authorization with the on-device key (lib/wallet.ts) and offer the local
   *  backup/import flow. 'wallet': sign it with the connected wallet via wagmi instead, offer a
   *  pay-your-own-gas direct transfer, and hide the local-key backup UI (there's no local key). */
  sessionKind: SessionKind;
  worldLevel: number | null;
  worldSchemaId: number | null;
  reliefPoolAddress?: Address;
  reliefPoolDeployBlock: bigint;
}

const styles = {
  card: { border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginTop: 16 },
  cardTitleJa: { fontWeight: 700, fontSize: 15, margin: 0 },
  cardTitleEn: { color: '#6b7280', fontSize: 12, margin: '2px 0 0' },
  addressBox: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 13,
    wordBreak: 'break-all' as const,
    background: '#f9fafb',
    borderRadius: 8,
    padding: '10px 12px',
    marginTop: 8,
  },
  qrWrap: { display: 'flex', justifyContent: 'center', marginTop: 12 },
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
  buttonDanger: {
    marginTop: 8,
    width: '100%',
    padding: '12px 16px',
    borderRadius: 8,
    border: '1px solid #fca5a5',
    background: '#fff5f5',
    color: '#b91c1c',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
  buttonDisabled: { opacity: 0.5, cursor: 'default' },
  input: {
    marginTop: 8,
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    fontSize: 14,
    boxSizing: 'border-box' as const,
  },
  label: { fontSize: 12, color: '#6b7280', marginTop: 10, display: 'block' },
  error: { color: '#b91c1c', fontSize: 13, marginTop: 8 },
  smallMuted: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  banner: { borderRadius: 8, padding: '10px 12px', marginTop: 8, fontSize: 13 },
  bannerSuccess: { background: '#e7f6ec', color: '#0f6b39' },
  bannerError: { background: '#fdecec', color: '#b91c1c' },
  bannerWarn: { background: '#fdf3e2', color: '#8a5a0a' },
  badgeRow: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' as const },
  badge: { display: 'inline-block', fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '4px 10px' },
  badgeMuted: { background: '#f3f4f6', color: '#374151' },
  badgeSuccess: { background: '#e7f6ec', color: '#0f9d58' },
  activityRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderTop: '1px solid #f3f4f6',
    padding: '8px 0',
    fontSize: 13,
  },
  link: { color: '#2563eb', fontSize: 12, textDecoration: 'none' },
  recoveryBox: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    wordBreak: 'break-all' as const,
    background: '#111827',
    color: '#f9fafb',
    borderRadius: 8,
    padding: '10px 12px',
    marginTop: 8,
  },
};

const ETHERSCAN = 'https://sepolia.etherscan.io';

function activityLabel(item: WalletActivityItem): { ja: string; en: string } {
  switch (item.kind) {
    case 'paid':
      return { ja: `お見舞金受け取り${item.plotLabel ? ` (${item.plotLabel})` : ''}`, en: `Relief payout${item.plotLabel ? ` (${item.plotLabel})` : ''}` };
    case 'claimed':
      return { ja: `受け取り${item.plotLabel ? ` (${item.plotLabel})` : ''}`, en: `Claimed${item.plotLabel ? ` (${item.plotLabel})` : ''}` };
    case 'sent':
      return { ja: `送金${item.counterparty ? ` → ${shortAddress(item.counterparty)}` : ''}`, en: `Sent${item.counterparty ? ` to ${shortAddress(item.counterparty)}` : ''}` };
    case 'received':
      return { ja: `受け取り${item.counterparty ? ` ← ${shortAddress(item.counterparty)}` : ''}`, en: `Received${item.counterparty ? ` from ${shortAddress(item.counterparty)}` : ''}` };
  }
}

export function WalletPanel({
  client,
  deviceAddress,
  identityAddress,
  sessionKind,
  worldLevel,
  worldSchemaId,
  reliefPoolAddress,
  reliefPoolDeployBlock,
}: WalletPanelProps) {
  const canSign = Boolean(deviceAddress && identityAddress && deviceAddress.toLowerCase() === identityAddress.toLowerCase());

  // Only touched for a wallet session (sessionKind === 'wallet') -- these hooks are always called (Rules of
  // Hooks) but idle otherwise; there's no wallet connected via wagmi on a LINE session's plain WagmiProvider.
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [jpycBalance, setJpycBalance] = useState<bigint | null>(null);
  const [ethBalance, setEthBalance] = useState<bigint | null>(null);
  const [activity, setActivity] = useState<WalletActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendTxHash, setSendTxHash] = useState<Hex | null>(null);

  // Wallet-session-only: send JPYC directly on-chain from the connected wallet, paying its own Sepolia gas,
  // as an alternative to the gasless relay below (spec: "wallet users can also send JPYC directly").
  const [directSendBusy, setDirectSendBusy] = useState(false);
  const [directSendError, setDirectSendError] = useState<string | null>(null);
  const [directSendTxHash, setDirectSendTxHash] = useState<Hex | null>(null);

  const [showBackupConfirm, setShowBackupConfirm] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importValue, setImportValue] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);

  useEffect(() => {
    if (!identityAddress) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(identityAddress, { margin: 1, width: 220 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [identityAddress]);

  const refreshBalances = useCallback(async () => {
    if (!client || !identityAddress) return;
    try {
      const [jpyc, eth] = await Promise.all([
        client.readContract({ address: JPYC, abi: JpycAbi, functionName: 'balanceOf', args: [identityAddress] }) as Promise<bigint>,
        client.getBalance({ address: identityAddress }),
      ]);
      setJpycBalance(jpyc);
      setEthBalance(eth);
    } catch (err) {
      console.warn('[wallet] balance read failed', err);
    }
  }, [client, identityAddress]);

  const refreshActivity = useCallback(async () => {
    if (!client || !identityAddress) return;
    setActivityLoading(true);
    try {
      const items = await fetchWalletActivity({
        client,
        reliefPoolAddress,
        jpycAddress: JPYC,
        wallet: identityAddress,
        fromBlock: reliefPoolDeployBlock,
      });
      setActivity(items);
    } catch (err) {
      console.warn('[wallet] activity read failed', err);
    } finally {
      setActivityLoading(false);
    }
  }, [client, identityAddress, reliefPoolAddress, reliefPoolDeployBlock]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  useEffect(() => {
    refreshActivity();
  }, [refreshActivity]);

  async function copyAddress() {
    if (!identityAddress) return;
    try {
      await navigator.clipboard.writeText(identityAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API can be unavailable in some in-app browsers; not fatal.
    }
  }

  async function handleSend() {
    if (!canSign || !identityAddress) return;
    setSendError(null);
    setSendTxHash(null);

    if (!/^0x[0-9a-fA-F]{40}$/.test(sendTo.trim())) {
      setSendError('宛先アドレスが正しくありません / Invalid recipient address.');
      return;
    }
    if (sendTo.trim().toLowerCase() === identityAddress.toLowerCase()) {
      setSendError('自分のウォレットには送金できません / You cannot send JPYC to your own wallet.');
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(sendAmount.trim()) || Number(sendAmount) <= 0) {
      setSendError('金額が正しくありません / Invalid amount.');
      return;
    }

    let amountWei: bigint;
    try {
      amountWei = parseUnits(sendAmount.trim(), JPYC_DECIMALS);
    } catch {
      setSendError('金額が正しくありません / Invalid amount.');
      return;
    }
    if (jpycBalance !== null && amountWei > jpycBalance) {
      setSendError('残高が不足しています / Amount exceeds your JPYC balance.');
      return;
    }

    setSendBusy(true);
    try {
      const to = sendTo.trim() as Address;
      let signed: Awaited<ReturnType<typeof signTransferAuthorization>>;
      if (sessionKind === 'wallet') {
        // Same EIP-3009 authorization, signed by the connected wallet (wagmi) instead of the LIFF in-app
        // device key -- the relay endpoint doesn't care which signed it, only that the signer recovers to
        // this session's pinned wallet (lib/liff/wallet-relay.ts).
        const nowSeconds = Math.floor(Date.now() / 1000);
        const validAfter = 0n;
        const validBefore = BigInt(nowSeconds + TRANSFER_AUTHORIZATION_WINDOW_SECONDS);
        const nonce = randomNonce();
        const signature = await signTypedDataAsync({
          domain: { ...JPYC_EIP712_DOMAIN, chainId: CHAIN_ID, verifyingContract: JPYC },
          types: TRANSFER_WITH_AUTHORIZATION_TYPES,
          primaryType: 'TransferWithAuthorization',
          message: { from: identityAddress, to, value: amountWei, validAfter, validBefore, nonce },
        });
        signed = { from: identityAddress, to, value: amountWei, validAfter, validBefore, nonce, signature };
      } else {
        const account = getOrCreateWalletAccount();
        signed = await signTransferAuthorization(account, to, amountWei);
      }

      const res = await fetch('/api/liff/wallet/relay-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: signed.to,
          value: signed.value.toString(),
          validAfter: signed.validAfter.toString(),
          validBefore: signed.validBefore.toString(),
          nonce: signed.nonce,
          signature: signed.signature,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; txHash?: Hex; message?: string; error?: string };
      if (!res.ok || !json.ok) {
        setSendError(json.message ?? json.error ?? `送信に失敗しました (${res.status})`);
        return;
      }
      setSendTxHash(json.txHash ?? null);
      setSendTo('');
      setSendAmount('');
      refreshBalances();
      refreshActivity();
    } catch {
      setSendError('送信できませんでした。もう一度お試しください。 / Could not send. Please try again.');
    } finally {
      setSendBusy(false);
    }
  }

  /** Wallet-session-only alternative to the gasless relay above: calls JPYC's plain `transfer` straight from
   *  the connected wallet, which pays its own Sepolia gas. Duplicates handleSend's input validation rather
   *  than sharing it -- small enough, and keeps the two send paths independently readable. */
  async function handleDirectSend() {
    if (!identityAddress) return;
    setDirectSendError(null);
    setDirectSendTxHash(null);

    if (!/^0x[0-9a-fA-F]{40}$/.test(sendTo.trim())) {
      setDirectSendError('宛先アドレスが正しくありません / Invalid recipient address.');
      return;
    }
    if (sendTo.trim().toLowerCase() === identityAddress.toLowerCase()) {
      setDirectSendError('自分のウォレットには送金できません / You cannot send JPYC to your own wallet.');
      return;
    }
    let amountWei: bigint;
    try {
      amountWei = parseUnits(sendAmount.trim(), JPYC_DECIMALS);
      if (amountWei <= 0n) throw new Error('non-positive');
    } catch {
      setDirectSendError('金額が正しくありません / Invalid amount.');
      return;
    }
    if (jpycBalance !== null && amountWei > jpycBalance) {
      setDirectSendError('残高が不足しています / Amount exceeds your JPYC balance.');
      return;
    }

    setDirectSendBusy(true);
    try {
      const txHash = await writeContractAsync({
        address: JPYC,
        abi: JpycAbi,
        functionName: 'transfer',
        args: [sendTo.trim() as Address, amountWei],
      });
      setDirectSendTxHash(txHash);
      setSendTo('');
      setSendAmount('');
      refreshBalances();
      refreshActivity();
    } catch (err) {
      console.warn('[wallet] direct transfer failed', err);
      setDirectSendError('送信できませんでした（ガス代不足の可能性があります）。 / Could not send (you may be out of Sepolia ETH for gas).');
    } finally {
      setDirectSendBusy(false);
    }
  }

  function handleRevealBackup() {
    setShowBackupConfirm(true);
  }

  function confirmRevealBackup() {
    try {
      setRevealedKey(exportPrivateKey());
    } catch {
      setRevealedKey(null);
    }
    setShowBackupConfirm(false);
  }

  function handleImportSubmit() {
    setImportError(null);
    setImportSuccess(false);
    try {
      const restored = importPrivateKey(importValue);
      if (identityAddress && restored.toLowerCase() !== identityAddress.toLowerCase()) {
        setImportError('この復元キーは現在のウォレットと一致しません / This recovery key does not match your linked wallet.');
        return;
      }
      setImportValue('');
      setImportSuccess(true);
      // The device's local key just changed underneath every other piece of state (World ID signal, claim
      // flow, etc.) -- reload so the whole app re-reads it from scratch instead of running with stale state.
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : '復元キーが正しくありません / Invalid recovery key.');
    }
  }

  const credential = worldSchemaId ? credentialLabelForSchema(worldSchemaId) : null;

  return (
    <div style={styles.card}>
      <p style={styles.cardTitleJa}>ウォレット</p>
      <p style={styles.cardTitleEn}>Your in-app wallet</p>

      <div style={styles.addressBox}>{identityAddress ?? '—'}</div>
      <button type="button" style={styles.buttonSecondary} onClick={copyAddress} disabled={!identityAddress}>
        {copied ? 'コピーしました / Copied' : 'アドレスをコピー / Copy address'}
      </button>
      {identityAddress && (
        <a href={`${ETHERSCAN}/address/${identityAddress}`} target="_blank" rel="noreferrer" style={{ ...styles.link, display: 'block', marginTop: 6, textAlign: 'center' }}>
          Etherscanで見る / View on Etherscan
        </a>
      )}
      {qrDataUrl && (
        <div style={styles.qrWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="wallet address QR code" width={220} height={220} />
        </div>
      )}

      {sessionKind === 'line' && !canSign && (
        <div style={{ ...styles.banner, ...styles.bannerWarn }}>
          このデバイスは、このLINEアカウントに紐づくウォレットの鍵を持っていません。閲覧のみ可能です。送金や復元キーの表示にはできません。「復元キーをインポート」から正しい鍵を復元してください。
          <br />
          <br />
          This device does not hold the signing key for the wallet linked to this LINE account. You can view
          balances and activity, but sending JPYC and showing a recovery key are disabled here. Use &ldquo;Import
          recovery key&rdquo; below to restore the correct key on this device.
        </div>
      )}

      {/* --- Balances -------------------------------------------------------------------------- */}
      <p style={{ ...styles.label, marginTop: 16 }}>JPYC残高 / JPYC balance</p>
      <p style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 0' }}>{jpycBalance !== null ? formatJpyc(jpycBalance) : '読み込み中… / Loading…'}</p>
      <p style={styles.smallMuted}>
        Sepolia ETH（参考情報）/ Sepolia ETH (informational): {ethBalance !== null ? `${(Number(ethBalance) / 1e18).toFixed(5)} ETH` : '…'}
      </p>

      {/* --- World ID badge ---------------------------------------------------------------------- */}
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
      {credential && (
        <p style={styles.smallMuted}>
          確認方法: {credential.ja} / Verified via: {credential.en}
        </p>
      )}

      {/* --- Send JPYC (gasless) ----------------------------------------------------------------- */}
      <p style={{ ...styles.cardTitleJa, marginTop: 20 }}>JPYCを送る（ガス代不要）</p>
      <p style={styles.cardTitleEn}>Send JPYC (gasless)</p>
      <label style={styles.label} htmlFor="wallet-send-to">
        宛先アドレス / Recipient address
      </label>
      <input
        id="wallet-send-to"
        style={styles.input}
        value={sendTo}
        onChange={(e) => setSendTo(e.target.value)}
        placeholder="0x..."
        disabled={!canSign || sendBusy}
      />
      <label style={styles.label} htmlFor="wallet-send-amount">
        金額 (JPYC) / Amount (JPYC)
      </label>
      <input
        id="wallet-send-amount"
        style={styles.input}
        value={sendAmount}
        onChange={(e) => setSendAmount(e.target.value)}
        placeholder="1000"
        inputMode="decimal"
        disabled={!canSign || sendBusy}
      />
      <button
        type="button"
        style={{ ...styles.button, ...(!canSign || sendBusy ? styles.buttonDisabled : {}) }}
        onClick={handleSend}
        disabled={!canSign || sendBusy}
      >
        {sendBusy ? '送信中… / Sending…' : '送る / Send'}
      </button>
      {sendError && <p style={styles.error}>{sendError}</p>}
      {sendTxHash && (
        <div style={{ ...styles.banner, ...styles.bannerSuccess }}>
          送金しました / Sent —{' '}
          <a href={`${ETHERSCAN}/tx/${sendTxHash}`} target="_blank" rel="noreferrer">
            Etherscan
          </a>
        </div>
      )}

      {/* --- Send JPYC directly (wallet session only): pays its own Sepolia gas, no relay involved ------ */}
      {sessionKind === 'wallet' && (
        <>
          <p style={{ ...styles.smallMuted, marginTop: 12 }}>
            またはウォレットから直接送る（ガス代が必要）/ Or send directly from your wallet (pays its own gas)
          </p>
          <button
            type="button"
            style={{ ...styles.buttonSecondary, ...(directSendBusy ? styles.buttonDisabled : {}) }}
            onClick={handleDirectSend}
            disabled={directSendBusy}
          >
            {directSendBusy ? '送信中… / Sending…' : '直接送る / Send directly'}
          </button>
          {directSendError && <p style={styles.error}>{directSendError}</p>}
          {directSendTxHash && (
            <div style={{ ...styles.banner, ...styles.bannerSuccess }}>
              送金しました / Sent —{' '}
              <a href={`${ETHERSCAN}/tx/${directSendTxHash}`} target="_blank" rel="noreferrer">
                Etherscan
              </a>
            </div>
          )}
        </>
      )}

      {/* --- Recent activity ----------------------------------------------------------------------- */}
      <p style={{ ...styles.cardTitleJa, marginTop: 20 }}>最近のアクティビティ</p>
      <p style={styles.cardTitleEn}>Recent activity</p>
      {activityLoading && activity.length === 0 ? (
        <p style={styles.smallMuted}>読み込み中… / Loading…</p>
      ) : activity.length === 0 ? (
        <p style={styles.smallMuted}>まだアクティビティはありません / No activity yet.</p>
      ) : (
        <div>
          {activity.map((item) => {
            const label = activityLabel(item);
            const sign = item.kind === 'sent' ? '-' : '+';
            return (
              <div key={`${item.txHash}-${item.kind}-${item.counterparty ?? ''}`} style={styles.activityRow}>
                <div>
                  <div>{label.ja}</div>
                  <div style={styles.smallMuted}>{label.en}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div>
                    {sign}
                    {formatJpyc(item.amountWei)}
                  </div>
                  <a href={`${ETHERSCAN}/tx/${item.txHash}`} target="_blank" rel="noreferrer" style={styles.link}>
                    Etherscan
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* --- Backup / import: LINE-only (there's no local private key for a wallet session) ---------- */}
      {sessionKind === 'line' && (
        <>
      <p style={{ ...styles.cardTitleJa, marginTop: 20 }}>バックアップ</p>
      <p style={styles.cardTitleEn}>Backup</p>
      <p style={styles.smallMuted}>
        テスト用デモです。実際の資産を守る仕組みではありません（本番導入前にTODO）。
        <br />
        This is a testnet demo, not production-grade custody (TODO before real funds).
      </p>

      {!showBackupConfirm && !revealedKey && (
        <button type="button" style={{ ...styles.buttonDanger, ...(!canSign ? styles.buttonDisabled : {}) }} onClick={handleRevealBackup} disabled={!canSign}>
          復元キーを表示 / Show recovery key
        </button>
      )}
      {showBackupConfirm && (
        <div style={{ ...styles.banner, ...styles.bannerWarn }}>
          警告: 復元キーが分かると、誰でもこのウォレットのJPYCを使えます。安全な場所以外では絶対に表示・共有しないでください。
          <br />
          Warning: anyone who sees this key can spend this wallet&rsquo;s JPYC. Never reveal or share it
          anywhere unsafe.
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" style={{ ...styles.buttonDanger, marginTop: 0 }} onClick={confirmRevealBackup}>
              理解した上で表示する / I understand, show it
            </button>
            <button type="button" style={{ ...styles.buttonSecondary, marginTop: 0 }} onClick={() => setShowBackupConfirm(false)}>
              キャンセル / Cancel
            </button>
          </div>
        </div>
      )}
      {revealedKey && (
        <>
          <div style={styles.recoveryBox}>{revealedKey}</div>
          <button type="button" style={styles.buttonSecondary} onClick={() => setRevealedKey(null)}>
            隠す / Hide
          </button>
        </>
      )}

      {!showImport ? (
        <button type="button" style={styles.buttonSecondary} onClick={() => setShowImport(true)}>
          復元キーをインポート / Import recovery key
        </button>
      ) : (
        <>
          <label style={styles.label} htmlFor="wallet-import-key">
            復元キー (0x...) / Recovery key (0x...)
          </label>
          <input
            id="wallet-import-key"
            style={styles.input}
            type="password"
            value={importValue}
            onChange={(e) => setImportValue(e.target.value)}
            placeholder="0x..."
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" style={{ ...styles.button, marginTop: 0 }} onClick={handleImportSubmit}>
              復元する / Restore
            </button>
            <button
              type="button"
              style={{ ...styles.buttonSecondary, marginTop: 0 }}
              onClick={() => {
                setShowImport(false);
                setImportValue('');
                setImportError(null);
              }}
            >
              キャンセル / Cancel
            </button>
          </div>
          {importError && <p style={styles.error}>{importError}</p>}
          {importSuccess && (
            <div style={{ ...styles.banner, ...styles.bannerSuccess }}>
              復元しました。再読み込みします… / Restored. Reloading…
            </div>
          )}
        </>
      )}
      {!hasWallet() && <p style={styles.smallMuted}>このデバイスにはまだウォレットがありません。 / No wallet on this device yet.</p>}
        </>
      )}
    </div>
  );
}
