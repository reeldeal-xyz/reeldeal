import { describe, expect, test } from 'bun:test';
import { pad, stringToHex, zeroAddress, type Address, type Hex } from 'viem';
import { fetchLiffStatus, fetchWorldLevel, type LiffStatusClient } from './status';

const POOL = '0x1111111111111111111111111111111111111111' as Address;
const HUMAN_REGISTRY = '0x2222222222222222222222222222222222222222' as Address;
const WALLET = '0x3333333333333333333333333333333333333333' as Address;
const OTHER_WALLET = '0x4444444444444444444444444444444444444444' as Address;
const PLOT = 'p1213-001';
const SEASON = '2026';
const EVENT_ID = pad('0xabc' as Hex, { size: 32 });

function reasonBytes(label: string): Hex {
  return pad(stringToHex(label) as Hex, { size: 32, dir: 'right' });
}

interface MakeClientOverrides {
  getLogs?: (args: unknown) => Promise<unknown[]>;
  readContract?: (args: { functionName: string }) => Promise<unknown>;
  plotSettlements?: readonly [number, Hex];
  attestation?: readonly unknown[];
}

// Mock objects are cast with `as never` per method (like lib/world/binder.test.ts does for BinderClients) --
// the real viem PublicClient methods are generic/overloaded in a way a plain async function can't satisfy
// structurally, even though it satisfies every call `fetchLiffStatus` actually makes.
function makeClient(overrides: MakeClientOverrides = {}): LiffStatusClient {
  const getLogs = overrides.getLogs ?? (async () => []);

  const readContract =
    overrides.readContract ??
    (async (args: { functionName: string }) => {
      if (args.functionName === 'plotSettlements') return overrides.plotSettlements ?? [0, `0x${'0'.repeat(64)}` as Hex];
      if (args.functionName === 'attestations') return overrides.attestation ?? [];
      if (args.functionName === 'payoutTarget') return [zeroAddress, zeroAddress, 0n];
      if (args.functionName === 'levelOf') return 0;
      throw new Error(`unexpected functionName ${args.functionName}`);
    });

  return { getLogs: getLogs as never, readContract: readContract as never };
}

describe('fetchLiffStatus', () => {
  test('no_slot: no Paid/Held logs and no current farmer', async () => {
    const client = makeClient();
    const result = await fetchLiffStatus({ client, reliefPoolAddress: POOL, plotLabel: PLOT, seasonLabel: SEASON, wallet: WALLET });
    expect(result).toEqual({ kind: 'no_slot', currentFarmer: null });
  });

  test('no_slot: current farmer is a different wallet', async () => {
    const client = makeClient({
      readContract: async (args) => {
        if (args.functionName === 'payoutTarget') return [OTHER_WALLET, zeroAddress, 0n];
        return [0, `0x${'0'.repeat(64)}` as Hex];
      },
    });
    const result = await fetchLiffStatus({ client, reliefPoolAddress: POOL, plotLabel: PLOT, seasonLabel: SEASON, wallet: WALLET });
    expect(result).toEqual({ kind: 'no_slot', currentFarmer: OTHER_WALLET });
  });

  test('paid: a Paid log exists for this wallet and plot', async () => {
    // getLogs is called twice (Paid, then Held, per fetchLiffStatus's Promise.all) -- distinguish by order.
    let call = 0;
    const getLogs = async () => {
      call += 1;
      if (call === 1) {
        return [{ args: { plotLabel: PLOT, amount: 20000000000000000000n }, blockNumber: 10n, transactionHash: '0xpaid' as Hex }];
      }
      return [];
    };
    const result = await fetchLiffStatus({
      client: makeClient({ getLogs }),
      reliefPoolAddress: POOL,
      plotLabel: PLOT,
      seasonLabel: SEASON,
      wallet: WALLET,
    });
    expect(result).toEqual({ kind: 'paid', amountWei: 20000000000000000000n, txHash: '0xpaid' });
  });

  test('held_unverified: a Held(UNVERIFIED) log whose settlement is still Held', async () => {
    let call = 0;
    const getLogs = async () => {
      call += 1;
      if (call === 1) return []; // Paid
      return [{ args: { eventId: EVENT_ID, plotLabel: PLOT, reason: reasonBytes('UNVERIFIED') }, blockNumber: 5n, transactionHash: '0xheld' as Hex }];
    };
    const client = makeClient({ getLogs, plotSettlements: [2, reasonBytes('UNVERIFIED')] });
    const result = await fetchLiffStatus({ client, reliefPoolAddress: POOL, plotLabel: PLOT, seasonLabel: SEASON, wallet: WALLET });
    expect(result).toEqual({ kind: 'held_unverified', eventId: EVENT_ID, plotLabel: PLOT });
  });

  test('held_other: a Held(CAP) log whose settlement is still Held', async () => {
    let call = 0;
    const getLogs = async () => {
      call += 1;
      if (call === 1) return [];
      return [{ args: { eventId: EVENT_ID, plotLabel: PLOT, reason: reasonBytes('CAP') }, blockNumber: 5n, transactionHash: '0xheld' as Hex }];
    };
    const client = makeClient({ getLogs, plotSettlements: [2, reasonBytes('CAP')] });
    const result = await fetchLiffStatus({ client, reliefPoolAddress: POOL, plotLabel: PLOT, seasonLabel: SEASON, wallet: WALLET });
    expect(result).toEqual({ kind: 'held_other', reason: 'CAP' });
  });

  test('held_other: claim window elapsed (settlement swept)', async () => {
    let call = 0;
    const getLogs = async () => {
      call += 1;
      if (call === 1) return [];
      return [{ args: { eventId: EVENT_ID, plotLabel: PLOT, reason: reasonBytes('UNVERIFIED') }, blockNumber: 5n, transactionHash: '0xheld' as Hex }];
    };
    const client = makeClient({ getLogs, plotSettlements: [4, reasonBytes('UNVERIFIED')] });
    const result = await fetchLiffStatus({ client, reliefPoolAddress: POOL, plotLabel: PLOT, seasonLabel: SEASON, wallet: WALLET });
    expect(result).toEqual({ kind: 'held_other', reason: 'CLAIM_WINDOW_ELAPSED' });
  });

  test('paid: settlement was Claimed since the Held event -- reads amount off the attestation', async () => {
    let call = 0;
    const getLogs = async () => {
      call += 1;
      if (call === 1) return [];
      return [{ args: { eventId: EVENT_ID, plotLabel: PLOT, reason: reasonBytes('UNVERIFIED') }, blockNumber: 5n, transactionHash: '0xheld' as Hex }];
    };
    const client = makeClient({
      getLogs,
      plotSettlements: [3, `0x${'0'.repeat(64)}` as Hex],
      attestation: [`0x${'0'.repeat(64)}` as Hex, `0x${'0'.repeat(64)}` as Hex, SEASON, 5, 20000000000000000000n, 0n, 0n, 0n],
    });
    const result = await fetchLiffStatus({ client, reliefPoolAddress: POOL, plotLabel: PLOT, seasonLabel: SEASON, wallet: WALLET });
    expect(result).toEqual({ kind: 'paid', amountWei: 20000000000000000000n, txHash: '0xheld' });
  });
});

describe('fetchWorldLevel', () => {
  test('returns the wallet level as a number', async () => {
    const client = { readContract: (async () => 2) as never };
    const level = await fetchWorldLevel(client, HUMAN_REGISTRY, WALLET);
    expect(level).toBe(2);
  });
});
