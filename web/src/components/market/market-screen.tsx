'use client';

// Fish market (issue #65 / SP-11): buy Karakuwa / Kesennuma seafood in JPYC. Each purchase is one
// SaleRouter.checkout that pays the co-op seller and donates 5% to ReliefPool in the same transaction.
import { useMemo, useState } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { parseUnits, type Address, type Hex } from 'viem';
import { DEPLOYED, SaleRouterAbi } from '@repo/shared';
import styles from '@/components/ui/ui.module.css';
import { useReliefPoolLedger } from '@/hooks/use-relief-pool-ledger';
import { Erc20Abi, JPYC, JPYC_DECIMALS } from '@/lib/contracts';
import { formatJpyc, shortHex } from '@/lib/format';
import { LISTINGS, MARKET_RELIEF_BPS, MARKET_SELLER, splitSale, type Listing } from '@/lib/market/listings';

const TX = 'https://sepolia.etherscan.io/tx/';
const ROUTER = DEPLOYED.SaleRouter as Address;
const LINK = { color: 'var(--ops-accent)' } as const;

const SPECIES_TINT: Record<Listing['species'], string> = {
  katsuo: '#4f7fbe',
  sanma: '#9aa9b8',
  saba: '#4fbe8e',
  hotate: '#e8834a',
  mebachi: '#e2685f',
  awabi: '#8aa6b8',
};

type Step = 'quote' | 'approve' | 'checkout' | 'done' | 'error';

interface PurchaseState {
  step: Step;
  message?: string;
  lot?: number;
  approveTx?: Hex;
  checkoutTx?: Hex;
  relief?: bigint;
}

interface QuoteResponse {
  lot: number;
  signature: Hex;
  quote: {
    orderId: Hex;
    listingId: Hex;
    buyer: Address;
    seller: Address;
    total: string;
    reliefBps: number;
    nonce: string;
    expiry: string;
  };
  error?: string;
  message?: string;
}

const STEP_TEXT: Record<Exclude<Step, 'done' | 'error'>, string> = {
  quote: 'Getting a signed price from the co-op…',
  approve: 'Approve JPYC in your wallet…',
  checkout: 'Confirm the purchase in your wallet…',
};

export function MarketScreen({ reliefPool, reliefPoolDeployBlock }: { reliefPool?: Address; reliefPoolDeployBlock: bigint }) {
  const { address, isConnected, chainId } = useAccount();
  const canBuy = isConnected && chainId === sepolia.id && !!address;
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const { writeContractAsync } = useWriteContract();
  const [purchases, setPurchases] = useState<Record<string, PurchaseState>>({});
  const busy = Object.values(purchases).some((p) => p.step === 'quote' || p.step === 'approve' || p.step === 'checkout');

  const ledger = useReliefPoolLedger(reliefPool, reliefPoolDeployBlock);
  const marketSales = useMemo(
    () =>
      (ledger.data ?? []).filter(
        (e) => e.type === 'Donated' && typeof e.args.memo === 'string' && (e.args.memo as string).startsWith('sale:'),
      ),
    [ledger.data],
  );
  const raised = marketSales.reduce((sum, e) => sum + ((e.args.amount as bigint | undefined) ?? 0n), 0n);

  const set = (slug: string, next: PurchaseState) => setPurchases((prev) => ({ ...prev, [slug]: { ...prev[slug], ...next } }));

  const buy = async (listing: Listing) => {
    if (!address || !publicClient) return;
    try {
      set(listing.slug, { step: 'quote', message: undefined, approveTx: undefined, checkoutTx: undefined });
      const res = await fetch('/api/market/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ listing: listing.slug, buyer: address }),
      });
      const json = (await res.json()) as QuoteResponse;
      if (!res.ok) throw new Error(json.error === 'sold_out' ? 'Sold out.' : (json.message ?? json.error ?? `Quote failed (HTTP ${res.status}).`));

      const quote = {
        ...json.quote,
        total: BigInt(json.quote.total),
        nonce: BigInt(json.quote.nonce),
        expiry: BigInt(json.quote.expiry),
      };
      const expected = parseUnits(String(listing.priceYen), JPYC_DECIMALS);
      if (quote.total !== expected || quote.buyer.toLowerCase() !== address.toLowerCase() || quote.seller !== MARKET_SELLER) {
        throw new Error('The signed quote did not match this listing. Nothing was sent.');
      }

      const balance = await publicClient.readContract({ address: JPYC, abi: Erc20Abi, functionName: 'balanceOf', args: [address] });
      if (balance < quote.total) throw new Error(`Not enough JPYC: you have ${formatJpyc(balance)}.`);

      const allowance = await publicClient.readContract({ address: JPYC, abi: Erc20Abi, functionName: 'allowance', args: [address, ROUTER] });
      if (allowance < quote.total) {
        set(listing.slug, { step: 'approve', lot: json.lot });
        const approveTx = await writeContractAsync({ address: JPYC, abi: Erc20Abi, functionName: 'approve', args: [ROUTER, quote.total], chainId: sepolia.id });
        set(listing.slug, { step: 'approve', approveTx });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }

      set(listing.slug, { step: 'checkout', lot: json.lot });
      const checkoutTx = await writeContractAsync({
        address: ROUTER,
        abi: SaleRouterAbi,
        functionName: 'checkout',
        args: [quote, json.signature],
        chainId: sepolia.id,
      });
      set(listing.slug, { step: 'checkout', checkoutTx });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: checkoutTx });
      if (receipt.status !== 'success') throw new Error('The purchase transaction reverted.');
      set(listing.slug, { step: 'done', relief: splitSale(quote.total, quote.reliefBps).relief });
      void ledger.refetch();
    } catch (err) {
      const text = (err instanceof Error ? err.message.split('\n')[0] : undefined) ?? String(err);
      set(listing.slug, { step: 'error', message: /rejected|denied/i.test(text) ? 'You cancelled in your wallet.' : text });
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Fish market · 魚市場</p>
          <h1 className={styles.title}>Buy from the coast, fund the relief pool</h1>
          <p className={styles.subtitle}>
            Pay in JPYC. One transaction pays the co-op and sends {MARKET_RELIEF_BPS / 100}% of every sale into the relief fund
            that pays these farmers when the sea turns on them.
          </p>
        </div>
      </header>

      <div className={styles.grid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Raised by market sales</span>
          <span className={styles.statValue}>{formatJpyc(raised)}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Sales</span>
          <span className={styles.statValue}>{marketSales.length}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>To relief per sale</span>
          <span className={styles.statValue}>{MARKET_RELIEF_BPS / 100}%</span>
        </div>
      </div>

      {!canBuy ? (
        <p className={styles.hint} style={{ marginTop: 16 }}>
          Connect a Sepolia wallet holding JPYC to buy (faucet: faucet.jpyc.co.jp).
        </p>
      ) : null}

      <section className={styles.section}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
            gap: 16,
          }}
        >
          {LISTINGS.map((listing) => {
            const p = purchases[listing.slug];
            const total = parseUnits(String(listing.priceYen), JPYC_DECIMALS);
            const { relief } = splitSale(total);
            const working = p && (p.step === 'quote' || p.step === 'approve' || p.step === 'checkout');
            return (
              <article key={listing.slug} className={styles.card} style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
                <div
                  aria-hidden="true"
                  style={{
                    height: 88,
                    borderRadius: 10,
                    background: `linear-gradient(135deg, ${SPECIES_TINT[listing.species]} 0%, var(--ops-surface) 110%)`,
                    display: 'flex',
                    alignItems: 'flex-end',
                    padding: 12,
                    fontSize: 22,
                    fontWeight: 700,
                    color: '#fff',
                  }}
                >
                  {listing.nameJa}
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>{listing.name}</p>
                  <p className={styles.hint} style={{ margin: '2px 0 0' }}>
                    {listing.origin} · {listing.unit}
                  </p>
                </div>
                <p className={styles.hint} style={{ margin: 0 }}>
                  {listing.blurb}
                </p>
                <div className={styles.spread}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatJpyc(total)}</p>
                    <p className={styles.hint} style={{ margin: 0 }}>
                      {formatJpyc(relief)} to relief
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`${styles.buttonPrimary} ${styles.buttonSmall}`}
                    disabled={!canBuy || busy}
                    onClick={() => buy(listing)}
                  >
                    {working ? 'Buying…' : 'Buy'}
                  </button>
                </div>

                {p ? (
                  <div className={styles.hint} style={{ margin: 0 }}>
                    {working ? <p style={{ margin: 0 }}>{STEP_TEXT[p.step as Exclude<Step, 'done' | 'error'>]}</p> : null}
                    {p.step === 'error' ? <p style={{ margin: 0, color: 'var(--ops-bad)' }}>{p.message}</p> : null}
                    {p.step === 'done' ? (
                      <p style={{ margin: 0, color: 'var(--ops-good)' }}>
                        Bought lot {p.lot}. {formatJpyc(p.relief ?? 0n)} went to the relief fund.
                      </p>
                    ) : null}
                    {p.checkoutTx ? (
                      <p style={{ margin: '4px 0 0' }}>
                        Purchase{' '}
                        <a href={`${TX}${p.checkoutTx}`} target="_blank" rel="noreferrer" className={styles.mono} style={LINK}>
                          {shortHex(p.checkoutTx, 6)}
                        </a>
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {marketSales.length ? (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Recent sales into the fund</h2>
            <a href="/donate" className={styles.sectionHint} style={LINK}>
              Full fund ledger
            </a>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>To relief</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {[...marketSales].reverse().slice(0, 8).map((e) => (
                  <tr key={`${e.transactionHash}-${e.logIndex}`}>
                    <td className={styles.mono}>{shortHex((e.args.memo as string).slice(5), 6)}</td>
                    <td className={styles.mono}>{formatJpyc((e.args.amount as bigint | undefined) ?? 0n)}</td>
                    <td>
                      <a href={`${TX}${e.transactionHash}`} target="_blank" rel="noreferrer" className={styles.mono} style={LINK}>
                        {shortHex(e.transactionHash ?? '', 6)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
