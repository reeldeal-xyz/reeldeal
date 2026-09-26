'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import type { Address } from 'viem';
import styles from '@/components/ui/ui.module.css';
import { NotDeployedNotice } from '@/components/ui/not-deployed-notice';
import { useReliefPoolLedger, type LedgerEntry, type LedgerEventName } from '@/hooks/use-relief-pool-ledger';
import { ReliefPoolAbi, Erc20Abi, JPYC } from '@/lib/contracts';
import { decodeReason, formatJpyc, parseJpyc, shortAddress } from '@/lib/format';

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

export function DonateScreen({ reliefPool, reliefPoolDeployBlock }: { reliefPool?: Address; reliefPoolDeployBlock: bigint }) {
  const { address, isConnected, chainId } = useAccount();
  const canWrite = isConnected && chainId === sepolia.id;

  const [amountInput, setAmountInput] = useState('20000');
  const [memo, setMemo] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const amount = useMemo(() => {
    if (!amountInput.trim()) return null;
    try {
      return parseJpyc(amountInput);
    } catch {
      return null;
    }
  }, [amountInput]);

  const { data: balance } = useReadContract({
    address: JPYC,
    abi: Erc20Abi,
    functionName: 'balanceOf',
    args: [address ?? ZERO_ADDRESS],
    query: { enabled: Boolean(address) },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: JPYC,
    abi: Erc20Abi,
    functionName: 'allowance',
    args: [address ?? ZERO_ADDRESS, reliefPool ?? ZERO_ADDRESS],
    query: { enabled: Boolean(address) && Boolean(reliefPool) },
  });

  const approve = useWriteContract();
  const donate = useWriteContract();
  const approveReceipt = useWaitForTransactionReceipt({ hash: approve.data });
  const donateReceipt = useWaitForTransactionReceipt({ hash: donate.data });

  useEffect(() => {
    if (approveReceipt.isSuccess) refetchAllowance();
  }, [approveReceipt.isSuccess, refetchAllowance]);

  const ledger = useReliefPoolLedger(reliefPool, reliefPoolDeployBlock);

  const totalDonated = useMemo(() => {
    if (!ledger.data) return 0n;
    return ledger.data
      .filter((entry) => entry.type === 'Donated')
      .reduce((sum, entry) => sum + ((entry.args.amount as bigint | undefined) ?? 0n), 0n);
  }, [ledger.data]);

  const needsApproval = amount !== null && amount > 0n && (allowance ?? 0n) < amount;

  const handleApprove = () => {
    if (!reliefPool || amount === null) return;
    setFormError(null);
    approve.writeContract({ address: JPYC, abi: Erc20Abi, functionName: 'approve', args: [reliefPool, amount] });
  };

  const handleDonate = () => {
    if (!reliefPool || amount === null || amount <= 0n) {
      setFormError('Enter a donation amount in yen.');
      return;
    }
    setFormError(null);
    donate.writeContract({ address: reliefPool, abi: ReliefPoolAbi, functionName: 'donate', args: [amount, memo] });
  };

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Donor</p>
          <h1 className={styles.title}>Give JPYC, see it land</h1>
          <p className={styles.subtitle}>
            Donations sit in the pool until an ocean-heat trigger fires, then pay the plots it hits — every step on Sepolia, public.
          </p>
        </div>
      </header>

      <div className={styles.grid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total donated</span>
          <span className={styles.statValue}>{formatJpyc(totalDonated)}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Your JPYC balance</span>
          <span className={styles.statValue}>{balance !== undefined ? formatJpyc(balance) : '—'}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>JPYC token</span>
          <span className={styles.statValue} style={{ fontSize: 14 }}>
            {shortAddress(JPYC)}
          </span>
        </div>
      </div>

      {!reliefPool ? (
        <div className={styles.section}>
          <NotDeployedNotice
            title="ReliefPool not deployed yet"
            body="Donating needs the pool's Sepolia address from #16. JPYC itself is already live on Sepolia — the address above is real."
            envVars={['NEXT_PUBLIC_RELIEF_POOL_ADDRESS']}
          />
        </div>
      ) : (
        <section className={styles.section}>
          <div className={styles.card} style={{ maxWidth: 440 }}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="donate-amount">
                Amount (¥)
              </label>
              <input
                id="donate-amount"
                className={styles.input}
                inputMode="numeric"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="20000"
              />
              <span className={styles.hint}>JPYC has 18 decimals — ¥20,000 becomes 20000e18 on-chain.</span>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="donate-memo">
                Memo
              </label>
              <input
                id="donate-memo"
                className={styles.input}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="For the scallop growers"
                maxLength={140}
              />
            </div>
            <div className={styles.row}>
              {needsApproval ? (
                <button
                  type="button"
                  className={`${styles.buttonPrimary} ${styles.buttonSmall}`}
                  disabled={!canWrite || approve.isPending || approveReceipt.isLoading}
                  onClick={handleApprove}
                >
                  {approve.isPending || approveReceipt.isLoading ? 'Approving…' : 'Approve JPYC'}
                </button>
              ) : (
                <button
                  type="button"
                  className={`${styles.buttonPrimary} ${styles.buttonSmall}`}
                  disabled={!canWrite || amount === null || amount <= 0n || donate.isPending || donateReceipt.isLoading}
                  onClick={handleDonate}
                >
                  {donate.isPending || donateReceipt.isLoading ? 'Donating…' : 'Donate'}
                </button>
              )}
            </div>
            {!canWrite ? <p className={styles.hint}>Connect a Sepolia wallet to donate.</p> : null}
            {formError ? (
              <p className={styles.hint} style={{ color: 'var(--ops-bad)' }}>
                {formError}
              </p>
            ) : null}
            {approve.error ? (
              <p className={styles.hint} style={{ color: 'var(--ops-bad)' }}>
                {approve.error.message}
              </p>
            ) : null}
            {donate.error ? (
              <p className={styles.hint} style={{ color: 'var(--ops-bad)' }}>
                {donate.error.message}
              </p>
            ) : null}
            {donateReceipt.isSuccess ? (
              <p className={styles.hint} style={{ color: 'var(--ops-good)' }}>
                Donated — tx {shortAddress(donate.data ?? '')}
              </p>
            ) : null}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Ledger</h2>
          <span className={styles.sectionHint}>Donated, Attested, Paid, Held, Claimed, Swept — straight from ReliefPool events</span>
        </div>
        {!reliefPool ? (
          <div className={styles.emptyState}>No pool deployed yet — nothing to show.</div>
        ) : ledger.isLoading ? (
          <div className={styles.emptyState}>Loading ledger…</div>
        ) : !ledger.data || ledger.data.length === 0 ? (
          <div className={styles.emptyState}>No events yet. Be the first donor.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Block</th>
                  <th>Detail</th>
                  <th>Amount</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.map((entry) => (
                  <tr key={`${entry.transactionHash}-${entry.logIndex}`}>
                    <td>
                      <EventBadge type={entry.type} />
                    </td>
                    <td className={styles.mono}>{entry.blockNumber.toString()}</td>
                    <td>{describeEntry(entry)}</td>
                    <td>
                      {typeof entry.args.amount === 'bigint' ? (
                        formatJpyc(entry.args.amount)
                      ) : (
                        <span style={{ color: 'var(--ops-muted-soft)' }}>—</span>
                      )}
                    </td>
                    <td className={styles.mono}>{shortAddress(entry.transactionHash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function EventBadge({ type }: { type: LedgerEventName }) {
  if (type === 'Paid' || type === 'Claimed') return <span className={styles.badgeGood}>{type}</span>;
  if (type === 'Held') return <span className={styles.badgeWarn}>{type}</span>;
  if (type === 'Swept') return <span className={styles.badgeBad}>{type}</span>;
  return <span className={styles.badgeNeutral}>{type}</span>;
}

function describeEntry(entry: LedgerEntry): string {
  const plotLabel = entry.args.plotLabel as string | undefined;
  switch (entry.type) {
    case 'Donated':
      return (entry.args.memo as string) || `from ${shortAddress((entry.args.from as string | undefined) ?? '')}`;
    case 'Enrolled':
      return `plot ${plotLabel ?? '—'}`;
    case 'Attested':
      return `event ${shortAddress((entry.args.eventId as string | undefined) ?? '')}`;
    case 'Paid':
    case 'Claimed':
      return `plot ${plotLabel ?? '—'} → ${shortAddress((entry.args.farmer as string | undefined) ?? '')}`;
    case 'Held':
      return `plot ${plotLabel ?? '—'} — ${decodeReason((entry.args.reason as `0x${string}` | undefined) ?? '0x')}`;
    case 'Swept':
      return `plot ${plotLabel ?? '—'}`;
    default:
      return '';
  }
}
