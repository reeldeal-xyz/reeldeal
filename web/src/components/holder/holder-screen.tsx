'use client';

import { useState } from 'react';
import { useAccount, useConfig } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import styles from '@/components/ui/ui.module.css';
import { NotDeployedNotice } from '@/components/ui/not-deployed-notice';
import { useSlotRequests, useUpdateSlotRequestStatus } from '@/hooks/use-slot-requests';
import { issueSeasonSlot, revokeSeasonSlot, type EnsAddresses } from '@/lib/ens-adapter';
import { shortAddress } from '@/lib/format';
import type { SlotRequest } from '@/lib/slot-request-store';

// 2026 season slots expire 2027-03-31 (issue #10).
const SEASON_2026_EXPIRY = BigInt(Math.floor(Date.UTC(2027, 2, 31) / 1000));

export function HolderScreen({ ensAddresses }: { ensAddresses: EnsAddresses }) {
  const { address, isConnected, chainId } = useAccount();
  const config = useConfig();
  const { data: requests, isLoading } = useSlotRequests();
  const updateStatus = useUpdateSlotRequestStatus();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [txByRequest, setTxByRequest] = useState<Record<string, string>>({});
  const [errorByRequest, setErrorByRequest] = useState<Record<string, string>>({});

  const canWrite = isConnected && chainId === sepolia.id;
  const registryDeployed = Boolean(ensAddresses.slotRegistry || ensAddresses.parentRegistry);

  const pending = requests?.filter((r) => r.status === 'pending') ?? [];
  const issued = requests?.filter((r) => r.status === 'issued') ?? [];

  const runAction = async (request: SlotRequest, action: 'issue' | 'revoke') => {
    setBusyId(request.id);
    setErrorByRequest((prev) => ({ ...prev, [request.id]: '' }));

    const result =
      action === 'issue'
        ? await issueSeasonSlot(config, ensAddresses, {
            plotLabel: request.plotLabel,
            farmer: request.farmerAddress as `0x${string}`,
            seasonLabel: request.seasonLabel,
            expires: SEASON_2026_EXPIRY,
          })
        : await revokeSeasonSlot(config, ensAddresses, request.plotLabel, request.seasonLabel);

    setBusyId(null);
    if (result.ok) {
      setTxByRequest((prev) => ({ ...prev, [request.id]: result.hash ?? '' }));
      updateStatus.mutate({ id: request.id, status: action === 'issue' ? 'issued' : 'revoked' });
    } else {
      setErrorByRequest((prev) => ({ ...prev, [request.id]: result.error ?? `${action} failed` }));
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Plot holder · karakuwa-east</p>
          <h1 className={styles.title}>Issue this season&rsquo;s slot</h1>
          <p className={styles.subtitle}>
            Farmers request a plot from the LINE app. Issuing hands them the {requests?.[0]?.seasonLabel ?? '2026'} season
            slot on-chain; revoking takes it back.
          </p>
        </div>
      </header>

      <div className={styles.grid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Pending requests</span>
          <span className={styles.statValue}>{pending.length}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Slots issued</span>
          <span className={styles.statValue}>{issued.length}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Your wallet</span>
          <span className={styles.statValue} style={{ fontSize: 16 }}>
            {isConnected ? shortAddress(address ?? '') : 'Not connected'}
          </span>
        </div>
      </div>

      {!registryDeployed ? (
        <div className={styles.section}>
          <NotDeployedNotice
            title="ENS slot registry not deployed yet"
            body="Issue and revoke need the per-plot season-slot registry (#10) and its Sepolia address (#16). Requests below still list from the LIFF stand-in store."
            envVars={['NEXT_PUBLIC_ENS_SLOT_REGISTRY_ADDRESS']}
          />
        </div>
      ) : !canWrite ? (
        <div className={styles.section}>
          <NotDeployedNotice
            title="Connect a Sepolia wallet to issue or revoke"
            body="Requests list below either way; issuing and revoking need a connected browser wallet on Sepolia."
          />
        </div>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Slot requests</h2>
          <span className={styles.sectionHint}>From the LINE app · TODO(#15): live once the LIFF request API ships</span>
        </div>

        {isLoading ? (
          <div className={styles.emptyState}>Loading requests…</div>
        ) : !requests || requests.length === 0 ? (
          <div className={styles.emptyState}>No slot requests yet.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Plot</th>
                  <th>Season</th>
                  <th>Farmer</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => {
                  const requestError = errorByRequest[request.id];
                  const requestTx = txByRequest[request.id];
                  return (
                  <tr key={request.id}>
                    <td className={styles.mono}>{request.plotLabel}</td>
                    <td>{request.seasonLabel}</td>
                    <td className={styles.mono}>{shortAddress(request.farmerAddress)}</td>
                    <td>{new Date(request.requestedAt).toLocaleDateString()}</td>
                    <td>
                      <StatusBadge status={request.status} />
                    </td>
                    <td>
                      <div className={styles.row}>
                        {request.status !== 'issued' ? (
                          <button
                            type="button"
                            className={`${styles.buttonPrimary} ${styles.buttonSmall}`}
                            disabled={!canWrite || !registryDeployed || busyId === request.id}
                            onClick={() => runAction(request, 'issue')}
                          >
                            {busyId === request.id ? 'Issuing…' : 'Issue'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`${styles.buttonDanger} ${styles.buttonSmall}`}
                            disabled={!canWrite || !registryDeployed || busyId === request.id}
                            onClick={() => runAction(request, 'revoke')}
                          >
                            {busyId === request.id ? 'Revoking…' : 'Revoke'}
                          </button>
                        )}
                      </div>
                      {requestError ? (
                        <p className={styles.hint} style={{ color: 'var(--ops-bad)' }}>
                          {requestError}
                        </p>
                      ) : null}
                      {requestTx ? <p className={styles.hint}>tx {shortAddress(requestTx)}</p> : null}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: SlotRequest['status'] }) {
  return status === 'issued' ? (
    <span className={styles.badgeGood}>Issued</span>
  ) : status === 'revoked' ? (
    <span className={styles.badgeBad}>Revoked</span>
  ) : (
    <span className={styles.badgeWarn}>Pending</span>
  );
}
