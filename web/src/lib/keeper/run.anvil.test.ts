// Integration test against a local anvil chain (issue #17). Deploys ReliefPool + its test doubles with
// `forge create`, enrolls plots, attests a fallback-signed Trigger for the 2023 scallop tier-2 reference
// event, settles, and asserts the Paid/Held split + LINE pushes -- end to end, through the real contract,
// not mocks. Skipped gracefully (not failed) when `anvil`/`forge` aren't on PATH.
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { idOf } from '@repo/shared';
import { runKeeper, type KeeperRunDeps } from './run';
import type { KeeperPublicClient, KeeperWalletClient } from './chain-clients';

const HAS_ANVIL = Bun.which('anvil') !== null && Bun.which('forge') !== null;
const CONTRACTS_DIR = new URL('../../../../contracts/', import.meta.url).pathname;
const PORT = 8598;
const RPC_URL = `http://127.0.0.1:${PORT}`;

// anvil's well-known default account #0 -- deployer, admin, donor and keeper all in one for simplicity.
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const deployerAccount = privateKeyToAccount(DEPLOYER_KEY);

const PIPELINE_KEY = `0x${'11'.repeat(32)}` as Hex;
const COOP_KEY = `0x${'22'.repeat(32)}` as Hex;
const pipelineAccount = privateKeyToAccount(PIPELINE_KEY);
const coopAccount = privateKeyToAccount(COOP_KEY);

const FARMER_VERIFIED = privateKeyToAccount(`0x${'33'.repeat(32)}` as Hex).address;
const FARMER_UNVERIFIED = privateKeyToAccount(`0x${'44'.repeat(32)}` as Hex).address;

let anvil: ReturnType<typeof Bun.spawn> | null = null;

function forgeCreate(contractPath: string, constructorArgs: string[] = []): Address {
  const args = [
    'create',
    '--broadcast',
    '--rpc-url',
    RPC_URL,
    '--private-key',
    DEPLOYER_KEY,
    '--json',
    contractPath,
    ...(constructorArgs.length ? ['--constructor-args', ...constructorArgs] : []),
  ];
  const result = Bun.spawnSync(['forge', ...args], { cwd: CONTRACTS_DIR, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`forge create ${contractPath} failed: ${result.stderr.toString()}`);
  }
  const parsed = JSON.parse(result.stdout.toString()) as { deployedTo: Address };
  return parsed.deployedTo;
}

function castSend(address: Address, signature: string, args: string[]): void {
  const result = Bun.spawnSync(
    ['cast', 'send', '--rpc-url', RPC_URL, '--private-key', DEPLOYER_KEY, address, signature, ...args],
    { cwd: CONTRACTS_DIR, stdout: 'pipe', stderr: 'pipe' },
  );
  if (result.exitCode !== 0) {
    throw new Error(`cast send ${signature} failed: ${result.stderr.toString()}`);
  }
}

async function waitForAnvil(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('anvil did not become ready in time');
}

let poolAddress: Address;
let jpycAddress: Address;
let humansAddress: Address;

describe.skipIf(!HAS_ANVIL)('keeper against a local anvil chain', () => {
  beforeAll(async () => {
    if (!HAS_ANVIL) return;
    // --chain-id 11155111: packages/shared/src/trigger.ts's eip712Domain hardcodes the Sepolia chain id, and
    // OpenZeppelin's EIP712 domain separator is computed from the *real* block.chainid -- so the local chain
    // has to claim to be Sepolia for our off-chain-computed digest to match the on-chain one.
    anvil = Bun.spawn(['anvil', '--port', String(PORT), '--chain-id', '11155111', '--silent'], {
      cwd: CONTRACTS_DIR,
      stdout: 'ignore',
      stderr: 'ignore',
    });
    await waitForAnvil();

    jpycAddress = forgeCreate('lib/openzeppelin-contracts/contracts/mocks/token/ERC20Mock.sol:ERC20Mock');
    humansAddress = forgeCreate('test/mocks/MockHumanRegistry.sol:MockHumanRegistry');
    const plotResolverAddress = forgeCreate('test/mocks/MockPlotResolver.sol:MockPlotResolver');
    const slotResolverAddress = forgeCreate('test/mocks/MockSlotResolver.sol:MockSlotResolver');
    poolAddress = forgeCreate('src/ReliefPool.sol:ReliefPool', [
      jpycAddress,
      humansAddress,
      plotResolverAddress,
      slotResolverAddress,
      deployerAccount.address,
    ]);

    // setSigners([pipeline, coop], 2)
    castSend(poolAddress, 'setSigners(address[],uint256)', [
      `[${pipelineAccount.address},${coopAccount.address}]`,
      '2',
    ]);
    // setTierAmount(HEAT26, scallop, tier 2, 20000e18 per unit)
    castSend(poolAddress, 'setTierAmount(bytes32,bytes32,uint8,uint256)', [
      idOf('HEAT26'),
      idOf('scallop'),
      '2',
      '20000000000000000000000',
    ]);

    // Mint + donate plenty of JPYC so `attest`'s pro-rata math is never balance-constrained.
    castSend(jpycAddress, 'mint(address,uint256)', [deployerAccount.address, '100000000000000000000000000']);
    castSend(jpycAddress, 'approve(address,uint256)', [poolAddress, '100000000000000000000000000']);
    castSend(poolAddress, 'donate(uint256,string)', ['100000000000000000000000000', 'anvil-test']);

    // Two scallop/karakuwa-east plots: one with a verified farmer (-> Paid), one unverified (-> Held).
    castSend(plotResolverAddress, 'setPlot(string,bytes32,bytes32)', ['p-paid', idOf('karakuwa-east'), idOf('scallop')]);
    castSend(plotResolverAddress, 'setPlot(string,bytes32,bytes32)', ['p-held', idOf('karakuwa-east'), idOf('scallop')]);
    castSend(poolAddress, 'enroll(string)', ['p-paid']);
    castSend(poolAddress, 'enroll(string)', ['p-held']);

    const farExpiry = String(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);
    castSend(slotResolverAddress, 'setSlot(string,string,address,address,uint64)', [
      'p-paid',
      '2026',
      FARMER_VERIFIED,
      '0x0000000000000000000000000000000000000000',
      farExpiry,
    ]);
    castSend(slotResolverAddress, 'setSlot(string,string,address,address,uint64)', [
      'p-held',
      '2026',
      FARMER_UNVERIFIED,
      '0x0000000000000000000000000000000000000000',
      farExpiry,
    ]);

    // Bind the verified farmer at level 1 (schema 11, "Selfie Check"); leave the other unbound -> UNVERIFIED.
    castSend(humansAddress, 'setHuman(address,uint8,bytes32,uint16,uint16)', [
      FARMER_VERIFIED,
      '1',
      `0x${'aa'.repeat(32)}`,
      '11',
      '500',
    ]);
  }, 60_000);

  afterAll(() => {
    anvil?.kill();
  });

  function buildDeps(overrides: Partial<KeeperRunDeps> = {}): KeeperRunDeps {
    const chain = { ...sepolia, rpcUrls: { default: { http: [RPC_URL] } } };
    const publicClient = createPublicClient({ chain, transport: http(RPC_URL) }) as unknown as KeeperPublicClient;
    const walletClient = createWalletClient({ account: deployerAccount, chain, transport: http(RPC_URL) }) as unknown as KeeperWalletClient;

    return {
      publicClient,
      getSigningClient: () => ({ walletClient, account: deployerAccount }),
      poolAddress,
      feedUrl: 'http://127.0.0.1:1', // nothing listens here -- forces the fallback signing path
      fallbackKeys: { pipeline: PIPELINE_KEY, coop: COOP_KEY },
      fetchFn: (async () => {
        throw new Error('feed intentionally unreachable in the anvil test');
      }) as unknown as typeof fetch,
      fromBlock: 0n,
      batchSize: 5,
      now: () => Date.now(),
      pushPaid: mock(async () => {}),
      pushHeld: mock(async () => {}),
      lineUserIdForWallet: mock(async (w: string) => (w.toLowerCase() === FARMER_VERIFIED.toLowerCase() ? 'U-VERIFIED' : null)),
      lineUserIdForPlot: mock(async (p: string) => (p === 'p-held' ? 'U-HELD' : null)),
      recordPlotWallet: mock(() => {}),
      decideAttest: mock(async () => ({
        decision: 'attest_now' as const,
        confidence: 1,
        probabilities: { attest_now: 1, co_op_review: 0 },
        reason: 'jev_choice' as const,
      })),
      ...overrides,
    };
  }

  test(
    'attests a fallback-signed trigger, settles, and pushes Paid/Held over LINE',
    async () => {
      const deps = buildDeps();
      const result = await runKeeper({ referenceEventId: '2023-scallop-tier2' }, deps);

      expect(result.triggerSource).toBe('fallback');
      expect(result.alreadyAttested).toBe(false);
      expect(result.attestTxHash).toBeDefined();
      expect(result.eligiblePlots.sort()).toEqual(['p-held', 'p-paid']);
      expect(result.settleTxHashes).toHaveLength(1);

      const paid = result.plotOutcomes.find((p) => p.plotLabel === 'p-paid');
      expect(paid?.status).toBe('Paid');
      expect((paid?.farmer ?? '').toLowerCase()).toBe(FARMER_VERIFIED.toLowerCase());
      expect(paid?.amount).toBe(20000000000000000000000n);

      const held = result.plotOutcomes.find((p) => p.plotLabel === 'p-held');
      expect(held?.status).toBe('Held');
      expect(held?.reason).toBe('UNVERIFIED');

      expect(deps.pushPaid).toHaveBeenCalledTimes(1);
      expect(deps.pushPaid).toHaveBeenCalledWith('U-VERIFIED', expect.objectContaining({ plotCode: 'p-paid' }));
      expect(deps.pushHeld).toHaveBeenCalledTimes(1);
      expect(deps.pushHeld).toHaveBeenCalledWith(
        'U-HELD',
        expect.objectContaining({ plotCode: 'p-held', reasonEn: 'Verify your identity to receive the payout.' }),
      );

      // The actual on-chain JPYC balance moved.
      const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
      const balance = await publicClient.readContract({
        address: jpycAddress,
        abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
        functionName: 'balanceOf',
        args: [FARMER_VERIFIED],
      });
      expect(balance).toBe(20000000000000000000000n);
    },
    60_000,
  );

  test(
    'idempotent: re-running the same reference event neither re-attests nor re-settles',
    async () => {
      const deps = buildDeps();
      const result = await runKeeper({ referenceEventId: '2023-scallop-tier2' }, deps);

      expect(result.alreadyAttested).toBe(true);
      expect(result.attestTxHash).toBeUndefined();
      expect(result.unsettledPlots).toEqual([]);
      expect(result.settleTxHashes).toEqual([]);
      expect(result.plotOutcomes.every((p) => p.status === 'skipped')).toBe(true);
      expect(deps.pushPaid).not.toHaveBeenCalled();
      expect(deps.pushHeld).not.toHaveBeenCalled();
    },
    60_000,
  );
});
