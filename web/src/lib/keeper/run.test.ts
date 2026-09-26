import { describe, expect, mock, test } from 'bun:test';
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  getAddress,
  pad,
  stringToHex,
  zeroHash,
  type AbiParameter,
  type Account,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ReliefPoolAbi, eventIdOf, idOf } from '@repo/shared';
import { runKeeper, type KeeperRunDeps } from './run';
import type { KeeperPublicClient, KeeperWalletClient } from './chain-clients';
import type { AttestGateState } from '@/lib/jev-gate';

const POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as Address;
const KEEPER_ACCOUNT = { address: '0x9999999999999999999999999999999999999999' } as unknown as Account;
const REF_ID = '2023-scallop-tier2';
const ZONE_ID = idOf('karakuwa-east');
const SPECIES_ID = idOf('scallop');
const EVENT_ID = eventIdOf('karakuwa-east', 'scallop', 'HEAT26', 2, '2026');

const PIPELINE_KEY = `0x${'11'.repeat(32)}` as Hex;
const COOP_KEY = `0x${'22'.repeat(32)}` as Hex;
void privateKeyToAccount; // used only if a test wants a real signer address; kept for parity with other specs

function asciiToBytes32(s: string): Hex {
  return pad(stringToHex(s), { size: 32, dir: 'right' });
}

type PlotOutcomeSpec = { type: 'Paid'; farmer: Address; amount: bigint } | { type: 'Held'; reason: string };

function makeLog(eventName: 'Paid' | 'Held', eventId: Hex, plotLabel: string, rest: Record<string, unknown>, dataArgs: unknown[]) {
  const abiItem = getAbiItem({ abi: ReliefPoolAbi, name: eventName }) as {
    inputs: readonly (AbiParameter & { indexed?: boolean })[];
  };
  const topics = encodeEventTopics({ abi: ReliefPoolAbi, eventName, args: { eventId, ...rest } } as never);
  const nonIndexed = abiItem.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(nonIndexed, [plotLabel, ...dataArgs]);
  return {
    address: POOL_ADDRESS,
    topics,
    data,
    blockNumber: 1n,
    blockHash: `0x${'00'.repeat(32)}` as Hex,
    transactionHash: `0x${'00'.repeat(32)}` as Hex,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };
}

interface FakeChainOptions {
  alreadyAttested?: boolean;
  threshold?: bigint;
  registeredSigners?: Address[];
  enrolledPlots?: string[];
  /** Pre-existing plotSettlements status (0 Unsettled default) keyed by plotLabel, for idempotency tests. */
  priorStatus?: Record<string, number>;
  /** What `settle` should produce for each plot label included in a batch. */
  settleOutcomes?: Record<string, PlotOutcomeSpec>;
  payoutTargets?: Record<string, Address>;
}

function buildFakeChain(opts: FakeChainOptions) {
  const threshold = opts.threshold ?? 2n;
  const registered = new Set((opts.registeredSigners ?? []).map((a) => a.toLowerCase()));
  const enrolledPlots = opts.enrolledPlots ?? [];
  const priorStatus = opts.priorStatus ?? {};
  const settleOutcomes = opts.settleOutcomes ?? {};
  const payoutTargets = opts.payoutTargets ?? {};

  let attested = opts.alreadyAttested ?? false;
  const txReceiptLogs = new Map<Hex, unknown[]>();
  let txCounter = 0;
  const simulateCalls: { functionName: string; args: unknown[] }[] = [];
  const writeCalls: { functionName: string; args: unknown[] }[] = [];

  const publicClient = {
    readContract: mock(async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      switch (functionName) {
        case 'attestations':
          return [ZONE_ID, SPECIES_ID, '2026', 8, 20000000000000000000000n, 160000000000000000000000n, attested ? 1700000000n : 0n, 1900000000n];
        case 'signerThreshold':
          return threshold;
        case 'isSigner':
          return registered.has((args[0] as Address).toLowerCase());
        case 'plotSettlements': {
          const plotLabel = args[1] as string;
          const status = priorStatus[plotLabel] ?? 0;
          return [status, status === 2 ? asciiToBytes32('NO_FARMER') : zeroHash];
        }
        case 'payoutTarget': {
          const plotLabel = args[0] as string;
          const farmer = payoutTargets[plotLabel];
          return [farmer ?? '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', farmer ? 2000000000n : 0n];
        }
        default:
          throw new Error(`unexpected readContract call: ${functionName}`);
      }
    }),
    getLogs: mock(async () => enrolledPlots.map((plotLabel) => ({ args: { plotLabel } }))),
    simulateContract: mock(async ({ functionName, args, account }: { functionName: string; args: unknown[]; account: unknown }) => {
      simulateCalls.push({ functionName, args });
      return { request: { functionName, args, account } };
    }),
    waitForTransactionReceipt: mock(async ({ hash }: { hash: Hex }) => ({ logs: txReceiptLogs.get(hash) ?? [] })),
  } as unknown as KeeperPublicClient;

  const walletClient = {
    writeContract: mock(async (request: { functionName: string; args: unknown[] }) => {
      writeCalls.push({ functionName: request.functionName, args: request.args });
      txCounter++;
      const hash = `0x${txCounter.toString(16).padStart(64, '0')}` as Hex;

      if (request.functionName === 'attest') {
        attested = true;
      } else if (request.functionName === 'settle') {
        const [eventId, batch] = request.args as [Hex, string[]];
        const logs: unknown[] = [];
        for (const plotLabel of batch) {
          const outcome = settleOutcomes[plotLabel];
          if (!outcome) continue;
          if (outcome.type === 'Paid') {
            logs.push(makeLog('Paid', eventId, plotLabel, { farmer: outcome.farmer, nullifier: `0x${'ab'.repeat(32)}` }, [outcome.amount]));
          } else {
            logs.push(makeLog('Held', eventId, plotLabel, {}, [asciiToBytes32(outcome.reason)]));
          }
        }
        txReceiptLogs.set(hash, logs);
      }
      return hash;
    }),
  } as unknown as KeeperWalletClient;

  return { publicClient, walletClient, simulateCalls, writeCalls };
}

function baseDeps(chain: ReturnType<typeof buildFakeChain>, overrides: Partial<KeeperRunDeps> = {}): KeeperRunDeps {
  return {
    publicClient: chain.publicClient,
    getSigningClient: () => ({ walletClient: chain.walletClient, account: KEEPER_ACCOUNT }),
    poolAddress: POOL_ADDRESS,
    feedUrl: 'http://localhost:8787',
    fallbackKeys: { pipeline: PIPELINE_KEY, coop: COOP_KEY },
    fetchFn: mock(async () => {
      throw new Error('feed unreachable in tests unless overridden');
    }) as unknown as typeof fetch,
    fromBlock: 0n,
    batchSize: 5,
    now: () => Date.parse('2026-01-01T00:00:00Z'),
    pushPaid: mock(async () => {}),
    pushHeld: mock(async () => {}),
    lineUserIdForWallet: mock(async () => null),
    lineUserIdForPlot: mock(async () => null),
    recordPlotWallet: mock(() => {}),
    // Defaults to a clean "go ahead" so the Jev gate is invisible to every test that isn't specifically
    // exercising it -- override to test co_op_review / --force behavior.
    decideAttest: mock(async () => ({
      decision: 'attest_now' as const,
      confidence: 0.95,
      probabilities: { attest_now: 0.95, co_op_review: 0.05 },
      reason: 'jev_choice' as const,
    })),
    ...overrides,
  };
}

const FARMER_A = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

describe('runKeeper', () => {
  test('feed unavailable: falls back, attests, settles a mixed Paid/Held batch, and pushes LINE', async () => {
    const chain = buildFakeChain({
      registeredSigners: [privateKeyToAccount(PIPELINE_KEY).address, privateKeyToAccount(COOP_KEY).address],
      enrolledPlots: ['p1', 'p2'],
      settleOutcomes: {
        p1: { type: 'Paid', farmer: FARMER_A, amount: 20000000000000000000000n },
        p2: { type: 'Held', reason: 'UNVERIFIED' },
      },
    });
    // listEnrolledPlots checks `plots(label)` (not exercised by readContract mock's 'plotSettlements'/'attestations'
    // cases above) -- add that case too.
    const readContractOriginal = chain.publicClient.readContract as unknown as (args: { functionName: string; args: readonly unknown[] }) => Promise<unknown>;
    (chain.publicClient as unknown as { readContract: unknown }).readContract = mock(async (call: { functionName: string; args: readonly unknown[] }) => {
      if (call.functionName === 'plots') {
        return [ZONE_ID, SPECIES_ID, true];
      }
      return readContractOriginal(call);
    });

    const lineUserIdForWallet = mock(async (w: string) => (w.toLowerCase() === FARMER_A.toLowerCase() ? 'U-FARMER-A' : null));
    const lineUserIdForPlot = mock(async (p: string) => (p === 'p2' ? 'U-FARMER-P2' : null));
    const pushPaid = mock(async () => {});
    const pushHeld = mock(async () => {});
    const recordPlotWallet = mock(() => {});

    const result = await runKeeper(
      { referenceEventId: REF_ID },
      baseDeps(chain, { lineUserIdForWallet, lineUserIdForPlot, pushPaid, pushHeld, recordPlotWallet }),
    );

    expect(result.triggerSource).toBe('fallback');
    expect(result.alreadyAttested).toBe(false);
    expect(result.attestTxHash).toBeDefined();
    expect(result.eventId).toBe(EVENT_ID);
    expect(result.settleTxHashes).toHaveLength(1);
    expect(result.eligiblePlots).toEqual(['p1', 'p2']);
    expect(result.unsettledPlots).toEqual(['p1', 'p2']);

    expect(chain.simulateCalls.map((c) => c.functionName)).toEqual(['attest', 'settle']);

    // Paid
    expect(recordPlotWallet).toHaveBeenCalledWith('p1', FARMER_A);
    expect(pushPaid).toHaveBeenCalledTimes(1);
    expect(pushPaid).toHaveBeenCalledWith('U-FARMER-A', expect.objectContaining({ plotCode: 'p1', amountWei: 20000000000000000000000n }));

    // Held
    expect(pushHeld).toHaveBeenCalledTimes(1);
    expect(pushHeld).toHaveBeenCalledWith('U-FARMER-P2', expect.objectContaining({ plotCode: 'p2', reasonEn: 'Verify your identity to receive the payout.' }));

    const paidOutcome = result.plotOutcomes.find((p) => p.plotLabel === 'p1');
    expect(paidOutcome).toMatchObject({ status: 'Paid', farmer: FARMER_A, amount: 20000000000000000000000n });
    const heldOutcome = result.plotOutcomes.find((p) => p.plotLabel === 'p2');
    expect(heldOutcome).toMatchObject({ status: 'Held', reason: 'UNVERIFIED' });

    expect(result.pushes).toEqual([
      { plotLabel: 'p1', kind: 'Paid', lineUserId: 'U-FARMER-A', sent: true },
      { plotLabel: 'p2', kind: 'Held', lineUserId: 'U-FARMER-P2', sent: true },
    ]);
  });

  test('already attested: skips attest entirely and goes straight to settle', async () => {
    const chain = buildFakeChain({ alreadyAttested: true, enrolledPlots: ['p1'], settleOutcomes: { p1: { type: 'Paid', farmer: FARMER_A, amount: 1n } } });
    (chain.publicClient as unknown as { readContract: unknown }).readContract = mock(async (call: { functionName: string; args: readonly unknown[] }) => {
      if (call.functionName === 'plots') return [ZONE_ID, SPECIES_ID, true];
      if (call.functionName === 'attestations') return [ZONE_ID, SPECIES_ID, '2026', 8, 1n, 8n, 1700000000n, 1900000000n];
      if (call.functionName === 'plotSettlements') return [0, zeroHash];
      if (call.functionName === 'payoutTarget') return ['0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', 0n];
      throw new Error(`unexpected: ${call.functionName}`);
    });

    const result = await runKeeper({ referenceEventId: REF_ID }, baseDeps(chain));

    expect(result.alreadyAttested).toBe(true);
    expect(result.triggerSource).toBe('already-attested');
    expect(result.attestTxHash).toBeUndefined();
    expect(result.trigger).toBeUndefined();
    expect(chain.simulateCalls.map((c) => c.functionName)).toEqual(['settle']);
  });

  test('idempotent: plots already Paid/Held/Claimed/Swept are excluded from the settle batch', async () => {
    const chain = buildFakeChain({
      alreadyAttested: true,
      enrolledPlots: ['already-paid', 'already-held', 'fresh'],
      priorStatus: { 'already-paid': 1, 'already-held': 2 },
      settleOutcomes: { fresh: { type: 'Paid', farmer: FARMER_A, amount: 5n } },
    });
    (chain.publicClient as unknown as { readContract: unknown }).readContract = mock(async (call: { functionName: string; args: readonly unknown[] }) => {
      if (call.functionName === 'plots') return [ZONE_ID, SPECIES_ID, true];
      if (call.functionName === 'attestations') return [ZONE_ID, SPECIES_ID, '2026', 8, 1n, 8n, 1700000000n, 1900000000n];
      if (call.functionName === 'plotSettlements') {
        const plotLabel = call.args[1] as string;
        const status = plotLabel === 'already-paid' ? 1 : plotLabel === 'already-held' ? 2 : 0;
        return [status, status === 2 ? asciiToBytes32('NO_FARMER') : zeroHash];
      }
      throw new Error(`unexpected: ${call.functionName}`);
    });

    const result = await runKeeper({ referenceEventId: REF_ID }, baseDeps(chain));

    expect(result.unsettledPlots).toEqual(['fresh']);
    expect(result.settleTxHashes).toHaveLength(1);
    // settle is called with only the unsettled plot -- never re-touches already-settled ones.
    const settleCall = chain.simulateCalls.find((c) => c.functionName === 'settle');
    expect(settleCall!.args[1]).toEqual(['fresh']);

    const skipped = result.plotOutcomes.filter((p) => p.status === 'skipped');
    expect(skipped).toEqual(
      expect.arrayContaining([
        { plotLabel: 'already-paid', status: 'skipped', reason: 'Paid' },
        { plotLabel: 'already-held', status: 'skipped', reason: 'Held' },
      ]),
    );
  });

  test('--dry-run never calls getSigningClient and sends no transactions', async () => {
    const chain = buildFakeChain({ enrolledPlots: ['p1'] });
    (chain.publicClient as unknown as { readContract: unknown }).readContract = mock(async (call: { functionName: string; args: readonly unknown[] }) => {
      if (call.functionName === 'plots') return [ZONE_ID, SPECIES_ID, true];
      if (call.functionName === 'attestations') return [ZONE_ID, SPECIES_ID, '2026', 0, 0n, 0n, 0n, 0n];
      if (call.functionName === 'signerThreshold') return 2n;
      if (call.functionName === 'isSigner') return true;
      if (call.functionName === 'plotSettlements') return [0, zeroHash];
      throw new Error(`unexpected: ${call.functionName}`);
    });

    const getSigningClient = mock(() => {
      throw new Error('must not be called in --dry-run');
    });

    const result = await runKeeper({ referenceEventId: REF_ID, dryRun: true }, baseDeps(chain, { getSigningClient }));

    expect(result.dryRun).toBe(true);
    expect(result.attestTxHash).toBeUndefined();
    expect(result.settleTxHashes).toEqual([]);
    expect(result.unsettledPlots).toEqual(['p1']);
    expect(getSigningClient).not.toHaveBeenCalled();
    expect(chain.simulateCalls).toEqual([]);
  });

  test('batches settle in chunks of the configured size', async () => {
    const plots = Array.from({ length: 7 }, (_, i) => `p${i}`);
    const settleOutcomes: Record<string, PlotOutcomeSpec> = {};
    for (const p of plots) settleOutcomes[p] = { type: 'Held', reason: 'NO_FARMER' };
    const chain = buildFakeChain({ alreadyAttested: true, enrolledPlots: plots, settleOutcomes });
    (chain.publicClient as unknown as { readContract: unknown }).readContract = mock(async (call: { functionName: string; args: readonly unknown[] }) => {
      if (call.functionName === 'plots') return [ZONE_ID, SPECIES_ID, true];
      if (call.functionName === 'attestations') return [ZONE_ID, SPECIES_ID, '2026', 8, 1n, 8n, 1700000000n, 1900000000n];
      if (call.functionName === 'plotSettlements') return [0, zeroHash];
      if (call.functionName === 'payoutTarget') return ['0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', 0n];
      throw new Error(`unexpected: ${call.functionName}`);
    });

    const result = await runKeeper({ referenceEventId: REF_ID }, baseDeps(chain));

    expect(result.settleTxHashes).toHaveLength(2); // 5 + 2
    const settleCalls = chain.simulateCalls.filter((c) => c.functionName === 'settle');
    expect((settleCalls[0]!.args[1] as string[]).length).toBe(5);
    expect((settleCalls[1]!.args[1] as string[]).length).toBe(2);
  });

  test('throws a clear error when the pool has no signer threshold set yet (issue #16 not done)', async () => {
    const chain = buildFakeChain({ threshold: 0n, enrolledPlots: [] });
    await expect(runKeeper({ referenceEventId: REF_ID }, baseDeps(chain))).rejects.toThrow(/no signer threshold set/);
  });

  describe('Jev attest gate (docs/JEV.md)', () => {
    function chainWithFallbackSigners() {
      // No enrolled plots: these tests only care about the attest step / gate wiring, not settlement.
      return buildFakeChain({
        registeredSigners: [privateKeyToAccount(PIPELINE_KEY).address, privateKeyToAccount(COOP_KEY).address],
        enrolledPlots: [],
      });
    }

    test('co_op_review: skips attest entirely and returns an escalated result', async () => {
      const chain = chainWithFallbackSigners();
      const decideAttest = mock(async (_state: AttestGateState) => ({
        decision: 'co_op_review' as const,
        confidence: 0.4,
        probabilities: { attest_now: 0.4, co_op_review: 0.6 },
        reason: 'low_confidence' as const,
      }));

      const result = await runKeeper({ referenceEventId: REF_ID }, baseDeps(chain, { decideAttest }));

      expect(decideAttest).toHaveBeenCalledTimes(1);
      const state = decideAttest.mock.calls[0]![0];
      expect(state.trigger).toMatchObject({ zone: 'karakuwa-east', species: 'scallop', peril: 'HEAT26', tier: 2 });
      expect(state.sourceHashes).toHaveLength(1);

      expect(result.status).toBe('escalated');
      expect(result.jevGate).toMatchObject({ decision: 'co_op_review', reason: 'low_confidence' });
      expect(result.attestTxHash).toBeUndefined();
      expect(result.settleTxHashes).toEqual([]);
      expect(chain.simulateCalls).toEqual([]); // never even simulates `attest`
    });

    test('attest_now: proceeds to attest and settle as normal, with status "ok"', async () => {
      const chain = chainWithFallbackSigners();
      const decideAttest = mock(async () => ({
        decision: 'attest_now' as const,
        confidence: 0.9,
        probabilities: { attest_now: 0.9, co_op_review: 0.1 },
        reason: 'jev_choice' as const,
      }));

      const result = await runKeeper({ referenceEventId: REF_ID }, baseDeps(chain, { decideAttest }));

      expect(decideAttest).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('ok');
      expect(result.jevGate?.decision).toBe('attest_now');
      expect(result.attestTxHash).toBeDefined();
      expect(chain.simulateCalls.map((c) => c.functionName)).toContain('attest');
    });

    test('force: true skips the gate entirely and attests even though Jev would hold it', async () => {
      const chain = chainWithFallbackSigners();
      const decideAttest = mock(async () => ({
        decision: 'co_op_review' as const,
        confidence: 0.2,
        probabilities: { attest_now: 0.2, co_op_review: 0.8 },
        reason: 'low_confidence' as const,
      }));

      const result = await runKeeper({ referenceEventId: REF_ID, force: true }, baseDeps(chain, { decideAttest }));

      expect(decideAttest).not.toHaveBeenCalled();
      expect(result.status).toBe('ok');
      expect(result.jevGate).toBeUndefined();
      expect(result.attestTxHash).toBeDefined();
      expect(chain.simulateCalls.map((c) => c.functionName)).toContain('attest');
    });

    test('already attested: never asks the gate (nothing to attest)', async () => {
      const chain = buildFakeChain({ alreadyAttested: true, enrolledPlots: [] });
      (chain.publicClient as unknown as { readContract: unknown }).readContract = mock(async (call: { functionName: string; args: readonly unknown[] }) => {
        if (call.functionName === 'plots') return [ZONE_ID, SPECIES_ID, true];
        if (call.functionName === 'attestations') return [ZONE_ID, SPECIES_ID, '2026', 8, 1n, 8n, 1700000000n, 1900000000n];
        if (call.functionName === 'plotSettlements') return [0, zeroHash];
        throw new Error(`unexpected: ${call.functionName}`);
      });
      const decideAttest = mock(async () => ({ decision: 'attest_now' as const, confidence: 1, probabilities: { attest_now: 1, co_op_review: 0 }, reason: 'jev_choice' as const }));

      const result = await runKeeper({ referenceEventId: REF_ID }, baseDeps(chain, { decideAttest }));

      expect(decideAttest).not.toHaveBeenCalled();
      expect(result.status).toBe('ok');
      expect(result.jevGate).toBeUndefined();
    });
  });
});
