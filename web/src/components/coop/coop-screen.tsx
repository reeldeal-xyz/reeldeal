'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useAccount, useConfig } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import type { Address } from 'viem';
import styles from '@/components/ui/ui.module.css';
import { NotDeployedNotice } from '@/components/ui/not-deployed-notice';
import { usePlotTable } from '@/hooks/use-plot-table';
import { useReliefPoolLedger, lastPaidByPlot } from '@/hooks/use-relief-pool-ledger';
import { attemptScienceKeySetAddress, setPlotZone, type EnsAddresses } from '@/lib/ens-adapter';
import { formatJpyc, shortAddress } from '@/lib/format';
import { DEMO_PLOTS, liffPlotUrl, SEASON_LABEL } from '@/lib/plots';
import { toCsv, downloadCsv } from '@/lib/csv';
import { PlotQrCode } from './plot-qr-code';

const FIRST_PLOT = DEMO_PLOTS[0]?.plotLabel ?? '';
// Well-known burn address — a harmless target for demonstrating the denied setAddress write.
const DEMO_DENIED_TARGET: Address = '0x000000000000000000000000000000000000dEaD';

export function CoopScreen({
  ensAddresses,
  reliefPool,
  humanRegistry,
  reliefPoolDeployBlock,
}: {
  ensAddresses: EnsAddresses;
  reliefPool?: Address;
  humanRegistry?: Address;
  reliefPoolDeployBlock: bigint;
}) {
  const { isConnected, chainId } = useAccount();
  const config = useConfig();
  const canWrite = isConnected && chainId === sepolia.id;

  const { rows, isLoading } = usePlotTable({ reliefPool, humanRegistry, parentRegistry: ensAddresses.parentRegistry });
  const ledger = useReliefPoolLedger(reliefPool, reliefPoolDeployBlock);
  const lastPayouts = useMemo(() => (ledger.data ? lastPaidByPlot(ledger.data) : new Map()), [ledger.data]);

  const [scienceKeyPlot, setScienceKeyPlot] = useState(FIRST_PLOT);
  const [zoneValue, setZoneValue] = useState('karakuwa-east');
  const [scienceKeyBusy, setScienceKeyBusy] = useState<'zone' | 'address' | null>(null);
  const [scienceKeyResult, setScienceKeyResult] = useState<{ good: boolean; message: string } | null>(null);

  const farmerCount = rows.filter((r) => r.farmer).length;
  const holderCount = rows.filter((r) => r.holder).length;

  const runSetZone = async () => {
    setScienceKeyBusy('zone');
    setScienceKeyResult(null);
    const result = await setPlotZone(config, ensAddresses, scienceKeyPlot, zoneValue);
    setScienceKeyBusy(null);
    setScienceKeyResult({
      good: result.ok,
      message: result.ok ? `Zone set on ${scienceKeyPlot} — tx ${shortAddress(result.hash ?? '')}` : (result.error ?? 'Set zone failed'),
    });
  };

  const runAttemptSetAddress = async () => {
    setScienceKeyBusy('address');
    setScienceKeyResult(null);
    const result = await attemptScienceKeySetAddress(config, ensAddresses, scienceKeyPlot, DEMO_DENIED_TARGET);
    setScienceKeyBusy(null);
    setScienceKeyResult(
      result.ok
        ? { good: false, message: 'Unexpected: setAddress succeeded — the science key role grant needs a second look.' }
        : { good: true, message: `Denied, as expected — ${result.error ?? 'reverted'}` },
    );
  };

  const exportCsv = () => {
    const csv = toCsv(
      rows.map((row) => ({
        plotLabel: row.plotLabel,
        zone: row.zone,
        species: row.species,
        holder: row.holder ?? '',
        farmer: row.farmer ?? '',
        level: row.level ?? '',
      })),
      [
        { key: 'plotLabel', label: 'Plot' },
        { key: 'zone', label: 'Zone' },
        { key: 'species', label: 'Species' },
        { key: 'holder', label: 'Holder' },
        { key: 'farmer', label: 'Current farmer' },
        { key: 'level', label: 'World ID level' },
      ],
    );
    downloadCsv(`umi-plots-${SEASON_LABEL}.csv`, csv);
  };

  return (
    <div className={styles.page}>
      <div className={styles.noPrint}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>Co-op · karakuwa-east</p>
            <h1 className={styles.title}>Holder vs. farmer, live</h1>
            <p className={styles.subtitle}>
              Every plot&rsquo;s licence holder against this season&rsquo;s slot owner, straight from ENSv2 and ReliefPool.
            </p>
          </div>
          <div className={styles.row}>
            <button type="button" className={`${styles.buttonGhost} ${styles.buttonSmall}`} onClick={exportCsv}>
              Export CSV
            </button>
            <button type="button" className={`${styles.buttonPrimary} ${styles.buttonSmall}`} onClick={() => window.print()}>
              Print QR codes
            </button>
          </div>
        </header>

        <div className={styles.grid}>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Plots</span>
            <span className={styles.statValue}>{DEMO_PLOTS.length}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Slots with a farmer</span>
            <span className={styles.statValue}>{farmerCount}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Holders on record</span>
            <span className={styles.statValue}>{holderCount}</span>
          </div>
        </div>

        {!reliefPool || !humanRegistry ? (
          <div className={styles.section}>
            <NotDeployedNotice
              title="ReliefPool / HumanRegistry not deployed yet"
              body="The current-farmer and World ID level columns need Sepolia addresses from #16."
              envVars={[
                ...(!reliefPool ? ['NEXT_PUBLIC_RELIEF_POOL_ADDRESS'] : []),
                ...(!humanRegistry ? ['NEXT_PUBLIC_HUMAN_REGISTRY_ADDRESS'] : []),
              ]}
            />
          </div>
        ) : null}
        {!ensAddresses.parentRegistry ? (
          <div className={styles.section}>
            <NotDeployedNotice
              title="ENS branch registry not deployed yet"
              body="The holder column reads the branch registry's findOwner(plotLabel) from #7's Sepolia deploy."
              envVars={['NEXT_PUBLIC_ENS_PARENT_REGISTRY_ADDRESS']}
            />
          </div>
        ) : null}

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Plots</h2>
            <span className={styles.sectionHint}>{isLoading ? 'Reading chain…' : `Season ${SEASON_LABEL}`}</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Plot</th>
                  <th>Species</th>
                  <th>Holder</th>
                  <th>Current farmer</th>
                  <th>Level</th>
                  <th>Last payout</th>
                  <th>QR</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const lastPaid = lastPayouts.get(row.plotLabel);
                  const amount = lastPaid?.args.amount;
                  return (
                    <tr key={row.plotLabel}>
                      <td className={styles.mono}>{row.plotLabel}</td>
                      <td style={{ textTransform: 'capitalize' }}>{row.species}</td>
                      <td className={styles.mono}>{row.holder ? shortAddress(row.holder) : <Muted>—</Muted>}</td>
                      <td className={styles.mono}>{row.farmer ? shortAddress(row.farmer) : <Muted>—</Muted>}</td>
                      <td>{row.level ? <span className={styles.badgeAccent}>L{row.level}</span> : <Muted>—</Muted>}</td>
                      <td>{typeof amount === 'bigint' ? formatJpyc(amount) : <Muted>—</Muted>}</td>
                      <td>
                        <PlotQrCode url={liffPlotUrl(row.plotLabel)} size={40} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Science key: edit plot records</h2>
            <span className={styles.sectionHint}>Zone/species writes succeed; every other field is denied on-chain</span>
          </div>
          <div className={styles.card}>
            {!ensAddresses.plotResolver ? (
              <NotDeployedNotice
                title="ENS resolver not deployed yet"
                body="Both demo writes below need the PermissionedResolver address from #7's Sepolia deploy."
                envVars={['NEXT_PUBLIC_ENS_PLOT_RESOLVER_ADDRESS']}
              />
            ) : (
              <>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="science-key-plot">
                    Plot
                  </label>
                  <select
                    id="science-key-plot"
                    className={styles.input}
                    value={scienceKeyPlot}
                    onChange={(e) => setScienceKeyPlot(e.target.value)}
                  >
                    {DEMO_PLOTS.map((p) => (
                      <option key={p.plotLabel} value={p.plotLabel}>
                        {p.plotLabel}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="science-key-zone">
                    Zone value
                  </label>
                  <input
                    id="science-key-zone"
                    className={styles.input}
                    value={zoneValue}
                    onChange={(e) => setZoneValue(e.target.value)}
                  />
                  <span className={styles.hint}>Written via setText(name, &quot;zone&quot;, value) — allowed for the science key.</span>
                </div>
                <div className={styles.row}>
                  <button
                    type="button"
                    className={`${styles.buttonPrimary} ${styles.buttonSmall}`}
                    disabled={!canWrite || scienceKeyBusy !== null}
                    onClick={runSetZone}
                  >
                    {scienceKeyBusy === 'zone' ? 'Setting…' : 'Set zone (allowed)'}
                  </button>
                  <button
                    type="button"
                    className={`${styles.buttonDanger} ${styles.buttonSmall}`}
                    disabled={!canWrite || scienceKeyBusy !== null}
                    onClick={runAttemptSetAddress}
                  >
                    {scienceKeyBusy === 'address' ? 'Attempting…' : 'Attempt setAddress (should be denied)'}
                  </button>
                </div>
                {!canWrite ? <p className={styles.hint}>Connect a Sepolia wallet holding the science key to try these.</p> : null}
                {scienceKeyResult ? (
                  <p className={styles.hint} style={{ color: scienceKeyResult.good ? 'var(--ops-good)' : 'var(--ops-bad)' }}>
                    {scienceKeyResult.message}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </section>
      </div>

      <div className={styles.printSheet}>
        {DEMO_PLOTS.map((p) => (
          <div key={p.plotLabel} className={styles.printTile}>
            <PlotQrCode url={liffPlotUrl(p.plotLabel)} size={120} />
            <strong>{p.plotLabel}</strong>
            <span>{p.species}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span style={{ color: 'var(--ops-muted-soft)' }}>{children}</span>;
}
