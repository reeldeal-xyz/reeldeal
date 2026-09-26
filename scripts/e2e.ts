#!/usr/bin/env bun
// End-to-end test harness for Reel Deal (ETHGlobal Tokyo demo).
//
// --fork (default): spins up a local `anvil` fork of real Sepolia, deploys a throwaway ReliefPool v2
//   against it with the *real* `forge script contracts/script/DeployReliefPoolV2.s.sol --sig "run()"`
//   (reusing the live HumanRegistry + ENSv2 plot/slot adapters, exactly like a real redeploy would), then
//   calls the shared `runKeeper()` module (web/src/lib/keeper/run.ts) against the fork for a reference
//   event and asserts the whole attest -> settle -> Paid/Held pipeline, idempotency, and EIP-712 domain
//   separation (v1 vs v2). Nothing here ever touches real Sepolia state -- the fork is a local, throwaway
//   copy. Never broadcasts LINE pushes unless --push is passed (this machine's DNS blocks api.line.me
//   anyway, see CLAUDE.md).
//
// --live: deploys a FRESH ReliefPool v2 for real on Sepolia, repoints the deployed web app at it (Railway
//   env vars + redeploy), relinks MultiBaas, replays the keeper against the live app's API, and verifies
//   the same assertions on real chain state. This spends real testnet JPYC/ETH and repoints the live app,
//   so it requires an explicit --yes and prints a preflight first. NEVER run this from an automated
//   pipeline without a human reading the preflight.
//
// Usage:
//   bun run e2e                              # --fork, default event
//   bun run e2e -- --fork --event <id>        # a different reference event (web/src/lib/keeper/reference-events.ts)
//   bun run e2e -- --fork --push              # also exercise real LINE pushes (will fail: DNS-blocked here)
//   bun run e2e -- --live --yes               # REAL Sepolia deploy + Railway redeploy + MultiBaas relink
//   bun run e2e -- --live --yes --donation 50000000000000000000000
//
// Skips gracefully (exit 0) when anvil/forge aren't on PATH.
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  formatEther,
  formatUnits,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { ReliefPoolAbi, idOf, type Trigger } from '../packages/shared/src/index';
import { TRIGGER_EIP712_TYPES } from '../packages/shared/src/trigger';
import { runKeeper, type KeeperRunDeps, type KeeperRunResult } from '../web/src/lib/keeper/run';
import type { KeeperPublicClient, KeeperWalletClient } from '../web/src/lib/keeper/chain-clients';

// ---------------------------------------------------------------------------
// Shared constants (mirrors contracts/script/DeployReliefPoolV2.s.sol)
// ---------------------------------------------------------------------------
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHAIN_ID = 11155111;
const DEFAULT_EVENT = '2026-scallop-banweeks-karakuwa';
const DEMO_PLOT = 'p1213-001';
const EXPECTED_FARMER = '0x1aEDC8476f15BdF1Ac742544c58Be3a187eEAB51' as Address;
const JPYC = '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29' as Address;
const LIVE_WEB_URL = 'https://web-production-746aa.up.railway.app';
const MULTIBAAS_WEBHOOK_DEFAULT = `${LIVE_WEB_URL}/api/multibaas/webhook`;
const DEFAULT_LIVE_DONATION = 20_000n * 10n ** 18n; // task-specified live default; contract's own default is 200000e18.

const ERC20_BALANCE_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

// ---------------------------------------------------------------------------
// Small process helpers
// ---------------------------------------------------------------------------
interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

function check(name: string, pass: boolean, detail?: string): Check {
  return { name, pass, detail };
}

function printTable(checks: Check[]): boolean {
  const nameWidth = Math.max(20, ...checks.map((c) => c.name.length));
  const line = (l: string, r: string, d: string) => `| ${l.padEnd(nameWidth)} | ${r.padEnd(4)} | ${d}`;
  console.log('');
  console.log(line('Check', 'Res.', 'Detail'));
  console.log(`|${'-'.repeat(nameWidth + 2)}|${'-'.repeat(6)}|${'-'.repeat(20)}`);
  for (const c of checks) console.log(line(c.name, c.pass ? 'PASS' : 'FAIL', c.detail ?? ''));
  console.log('');
  const passed = checks.filter((c) => c.pass).length;
  const overall = checks.length > 0 && passed === checks.length;
  console.log(`${passed}/${checks.length} checks passed -- ${overall ? 'PASS' : 'FAIL'}`);
  console.log('');
  return overall;
}

function requireEnv(names: string[]): void {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    throw new Error(`missing required env var(s) (repo-root .env): ${missing.join(', ')}`);
  }
}

function parseExportLines(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /export\s+([A-Z0-9_]+)\s*=\s*(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) out[m[1]!] = m[2]!;
  return out;
}

async function readAll(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return '';
  return new Response(stream).text();
}

// ---------------------------------------------------------------------------
// anvil fork lifecycle
// ---------------------------------------------------------------------------
interface AnvilHandle {
  proc: ReturnType<typeof Bun.spawn>;
  rpcUrl: string;
  port: number;
  logPath: string;
}

async function waitForRpc(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
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
  throw new Error(`RPC at ${url} did not become ready in time`);
}

async function pollForPort(logPath: string, timeoutMs = 20_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = readFileSync(logPath, 'utf8');
      const m = text.match(/Listening on 127\.0\.0\.1:(\d+)/);
      if (m) return Number(m[1]);
    } catch {
      // file not written yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`anvil did not report a listening port within ${timeoutMs}ms (see ${logPath})`);
}

/** Spawns `anvil --fork-url <forkUrl> --chain-id 11155111 --port 0` and waits for it to report the port it
 *  actually bound (so repeated runs never collide on a fixed port). stdout/stderr are redirected to a log
 *  file (not a pipe) -- anvil logs every RPC call, and a piped stream we stop reading from would eventually
 *  fill the OS pipe buffer and deadlock the child. */
async function spawnAnvilFork(forkUrl: string): Promise<AnvilHandle> {
  const logPath = join(tmpdir(), `reeldeal-e2e-anvil-${process.pid}-${Date.now()}.log`);
  const fd = openSync(logPath, 'w');
  const proc = Bun.spawn(['anvil', '--fork-url', forkUrl, '--chain-id', String(CHAIN_ID), '--port', '0'], {
    cwd: REPO_ROOT,
    stdout: fd,
    stderr: fd,
  });
  closeSync(fd);
  const port = await pollForPort(logPath);
  const rpcUrl = `http://127.0.0.1:${port}`;
  await waitForRpc(rpcUrl);
  return { proc, rpcUrl, port, logPath };
}

function killAnvil(handle: AnvilHandle | undefined | null): void {
  if (!handle) return;
  try {
    handle.proc.kill();
  } catch {
    // already dead
  }
}

// ---------------------------------------------------------------------------
// forge script deploy (contracts/script/DeployReliefPoolV2.s.sol)
// ---------------------------------------------------------------------------
interface DeployResult {
  poolAddress: Address;
  deployBlock: bigint;
  raw: string;
}

async function runForgeDeploy(rpcUrl: string, extraEnv: Record<string, string> = {}): Promise<DeployResult> {
  const proc = Bun.spawn(
    ['forge', 'script', 'contracts/script/DeployReliefPoolV2.s.sol', '--sig', 'run()', '--root', 'contracts', '--rpc-url', rpcUrl, '--broadcast'],
    { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...extraEnv } },
  );
  const [stdout, stderr, exitCode] = await Promise.all([readAll(proc.stdout), readAll(proc.stderr), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`forge script DeployReliefPoolV2.s.sol run() failed (exit ${exitCode}):\n${stderr || stdout}`);
  }
  const exports = parseExportLines(stdout);
  const poolAddress = exports.RELIEF_POOL_ADDRESS;
  const deployBlock = exports.RELIEF_POOL_DEPLOY_BLOCK;
  if (!poolAddress || !deployBlock) {
    throw new Error(`could not find RELIEF_POOL_ADDRESS/RELIEF_POOL_DEPLOY_BLOCK in forge output:\n${stdout}`);
  }
  return { poolAddress: poolAddress as Address, deployBlock: BigInt(deployBlock), raw: stdout };
}

// forge keys its broadcast receipts by chain id, not by RPC URL -- and the fork must claim chain id 11155111
// (Sepolia) for our off-chain EIP-712 digests to match the on-chain domain separator (see run.anvil.test.ts's
// identical comment). That means a --fork run's `forge script --broadcast` against the local anvil fork
// writes into the exact same `contracts/broadcast/DeployReliefPoolV2.s.sol/11155111/run-latest.json` that
// records the *real* Sepolia v2 deployment (chore(contracts): record the ReliefPool v2 broadcast receipt).
// Restore it after every fork-mode deploy so repeated --fork runs never leave that real history dirty.
const REAL_BROADCAST_RECEIPT = `contracts/broadcast/DeployReliefPoolV2.s.sol/${CHAIN_ID}/run-latest.json`;

function restoreRealBroadcastReceipt(): void {
  try {
    execFileSync('git', ['checkout', '--', REAL_BROADCAST_RECEIPT], { cwd: REPO_ROOT, stdio: 'pipe' });
  } catch (err) {
    console.warn(`[e2e] could not restore ${REAL_BROADCAST_RECEIPT} after the fork deploy (non-fatal):`, (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// viem clients + keeper deps
// ---------------------------------------------------------------------------
function buildClients(rpcUrl: string, deployerKey: Hex) {
  const chain = { ...sepolia, rpcUrls: { default: { http: [rpcUrl] } } };
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const account = privateKeyToAccount(deployerKey);
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  return { publicClient, walletClient, account };
}

interface FallbackKeys {
  pipeline?: Hex;
  coop?: Hex;
  science?: Hex;
}

async function buildKeeperDeps(params: {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  account: ReturnType<typeof privateKeyToAccount>;
  poolAddress: Address;
  deployBlock: bigint;
  fallbackKeys: FallbackKeys;
  push: boolean;
}): Promise<KeeperRunDeps> {
  let pushPaid: KeeperRunDeps['pushPaid'] = async (userId, p) => {
    console.log(`[e2e] LINE push disabled (pass --push to enable) -- would pushPaid to ${userId}`, p);
  };
  let pushHeld: KeeperRunDeps['pushHeld'] = async (userId, p) => {
    console.log(`[e2e] LINE push disabled (pass --push to enable) -- would pushHeld to ${userId}`, p);
  };
  let lineUserIdForWallet: KeeperRunDeps['lineUserIdForWallet'] = async () => null;
  let lineUserIdForPlot: KeeperRunDeps['lineUserIdForPlot'] = async () => null;
  let recordPlotWallet: KeeperRunDeps['recordPlotWallet'] = () => {};

  if (params.push) {
    // Lazy-imported: keeps the no-push path fully decoupled from LINE/DB code (this machine's DNS blocks
    // api.line.me anyway -- see CLAUDE.md). These are the *real* production dependencies.
    const line = await import('../web/src/lib/line');
    const payoutDirectory = await import('../web/src/lib/payout-directory');
    pushPaid = line.pushPaid;
    pushHeld = line.pushHeld;
    lineUserIdForWallet = payoutDirectory.payoutDirectory.lineUserIdForWallet;
    lineUserIdForPlot = payoutDirectory.payoutDirectory.lineUserIdForPlot;
    recordPlotWallet = payoutDirectory.recordPlotWallet;
  }

  return {
    publicClient: params.publicClient as unknown as KeeperPublicClient,
    getSigningClient: () => ({ walletClient: params.walletClient as unknown as KeeperWalletClient, account: params.account }),
    poolAddress: params.poolAddress,
    feedUrl: 'http://127.0.0.1:1', // nothing listens here -- forces the fallback signing path (no pipeline running).
    fallbackKeys: params.fallbackKeys,
    fetchFn: (async () => {
      throw new Error('e2e: pipeline feed intentionally unreachable -- forces the fallback signing path');
    }) as unknown as typeof fetch,
    fromBlock: params.deployBlock,
    batchSize: 5,
    now: () => Date.now(),
    pushPaid,
    pushHeld,
    lineUserIdForWallet,
    lineUserIdForPlot,
    recordPlotWallet,
    // force:true always skips the Jev gate (see web/src/lib/keeper/run.ts) -- this must never be called.
    decideAttest: async () => {
      throw new Error('e2e: decideAttest should never be invoked when runKeeper is called with force:true');
    },
  };
}

// ---------------------------------------------------------------------------
// Assertions shared by --fork and --live
// ---------------------------------------------------------------------------
async function readJpyc(publicClient: PublicClient, address: Address): Promise<bigint> {
  return publicClient.readContract({ address: JPYC, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [address] });
}

async function readAttestationPerUnit(publicClient: PublicClient, poolAddress: Address, eventId: Hex): Promise<bigint> {
  const attestation = await publicClient.readContract({
    address: poolAddress,
    abi: ReliefPoolAbi,
    functionName: 'attestations',
    args: [eventId],
  });
  return attestation[4]; // [zoneId, speciesId, seasonLabel, eligibleUnits, perUnit, reservedAmount, attestedAt, claimDeadline]
}

/** Asserts the first (fresh-attest) keeper run: attested, DEMO_PLOT Paid to EXPECTED_FARMER for the
 *  attestation's own perUnit, and every other eligible plot Held(UNVERIFIED). */
function checkFirstRun(result: KeeperRunResult, perUnit: bigint, farmerDelta: bigint): Check[] {
  const checks: Check[] = [];
  checks.push(check('attested (fresh)', result.alreadyAttested === false && Boolean(result.attestTxHash), `attestTxHash=${result.attestTxHash ?? 'none'}`));

  const paid = result.plotOutcomes.find((p) => p.plotLabel === DEMO_PLOT);
  checks.push(
    check(
      `${DEMO_PLOT} Paid to expected farmer`,
      paid?.status === 'Paid' && (paid.farmer ?? '').toLowerCase() === EXPECTED_FARMER.toLowerCase(),
      `farmer=${paid?.farmer ?? 'none'}`,
    ),
  );
  checks.push(check(`${DEMO_PLOT} JPYC delta == attested perUnit`, farmerDelta === perUnit, `delta=${farmerDelta} perUnit=${perUnit}`));

  const others = result.plotOutcomes.filter((p) => p.plotLabel !== DEMO_PLOT);
  checks.push(
    check(
      'other enrolled scallop plots Held(UNVERIFIED)',
      others.length > 0 && others.every((p) => p.status === 'Held' && p.reason === 'UNVERIFIED'),
      `n=${others.length}`,
    ),
  );
  return checks;
}

function checkIdempotentRun(result: KeeperRunResult): Check {
  const ok =
    result.alreadyAttested === true &&
    !result.attestTxHash &&
    result.unsettledPlots.length === 0 &&
    result.settleTxHashes.length === 0 &&
    result.plotOutcomes.every((p) => p.status === 'skipped');
  return check('idempotent second run does nothing', ok, `unsettled=${result.unsettledPlots.length} settleTx=${result.settleTxHashes.length}`);
}

/** Builds a never-before-attested Trigger for the real scallop tier-1 HEAT rule (packages/shared/src/rules.ts:
 *  tempC 25, threshold 14; contracts/script/DeployReliefPoolV2.s.sol sets its tierAmount at deploy), signs it
 *  under both the v1 and v2 EIP-712 domains, and asserts the pool's fixed `EIP712("ReliefPool","2")` domain
 *  rejects the v1 signature while accepting the v2 one (both via read-only `simulateContract` -- neither
 *  broadcasts, so this never mutates chain state). */
async function checkDomainSeparation(
  publicClient: PublicClient,
  poolAddress: Address,
  account: ReturnType<typeof privateKeyToAccount>,
  pipelineKey: Hex,
  coopKey: Hex,
): Promise<Check> {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const trigger: Trigger = {
    zoneId: idOf('karakuwa-east'),
    speciesId: idOf('scallop'),
    perilId: idOf('HEAT'),
    tier: 1,
    seasonLabel: '2026',
    windowStart: now - 100n * 86_400n,
    windowEnd: now - 1n * 86_400n,
    firedAt: now - 2n * 86_400n,
    index: 14,
    threshold: 14,
    tempC: 25,
    dataHash: keccak256(toBytes(`e2e-domain-canary-${process.pid}-${now}`)),
    deadline: now + 365n * 86_400n,
  };

  const pipelineAccount = privateKeyToAccount(pipelineKey);
  const coopAccount = privateKeyToAccount(coopKey);

  async function sign(version: '1' | '2'): Promise<[Hex, Hex]> {
    const domain = { name: 'ReliefPool', version, chainId: CHAIN_ID, verifyingContract: poolAddress } as const;
    const a = await pipelineAccount.signTypedData({ domain, types: TRIGGER_EIP712_TYPES, primaryType: 'Trigger', message: trigger });
    const b = await coopAccount.signTypedData({ domain, types: TRIGGER_EIP712_TYPES, primaryType: 'Trigger', message: trigger });
    return [a, b];
  }

  let v1Rejected = false;
  try {
    await publicClient.simulateContract({ address: poolAddress, abi: ReliefPoolAbi, functionName: 'attest', args: [trigger, await sign('1')], account });
  } catch {
    v1Rejected = true;
  }

  let v2Accepted = false;
  try {
    await publicClient.simulateContract({ address: poolAddress, abi: ReliefPoolAbi, functionName: 'attest', args: [trigger, await sign('2')], account });
    v2Accepted = true;
  } catch {
    v2Accepted = false;
  }

  return check('v1-domain signature rejected (v2 accepted)', v1Rejected && v2Accepted, `v1Rejected=${v1Rejected} v2Accepted=${v2Accepted}`);
}

// ---------------------------------------------------------------------------
// --fork mode
// ---------------------------------------------------------------------------
interface Args {
  mode: 'fork' | 'live';
  event: string;
  push: boolean;
  yes: boolean;
  donation?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: 'fork', event: DEFAULT_EVENT, push: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--fork') args.mode = 'fork';
    else if (a === '--live') args.mode = 'live';
    else if (a === '--push') args.push = true;
    else if (a === '--yes') args.yes = true;
    else if (a === '--event') args.event = argv[++i] ?? args.event;
    else if (a.startsWith('--event=')) args.event = a.slice('--event='.length);
    else if (a === '--donation') args.donation = argv[++i];
    else if (a.startsWith('--donation=')) args.donation = a.slice('--donation='.length);
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 20).join('\n'));
      process.exit(0);
    }
  }
  return args;
}

async function runForkMode(args: Args): Promise<boolean> {
  if (!Bun.which('anvil') || !Bun.which('forge')) {
    console.log('[e2e] anvil/forge not found on PATH -- skipping --fork run (install Foundry: https://getfoundry.sh).');
    return true;
  }

  requireEnv([
    'SEPOLIA_RPC_URL',
    'DEPLOYER_PRIVATE_KEY',
    'PIPELINE_SIGNER_PRIVATE_KEY',
    'COOP_SIGNER_PRIVATE_KEY',
    'HUMAN_REGISTRY_ADDRESS',
    'ENS_PLOT_RESOLVER_ADAPTER',
    'ENS_SLOT_RESOLVER_ADAPTER',
  ]);

  console.log(`[e2e] --fork: forking real Sepolia into a local anvil, event=${args.event}`);
  let anvil: AnvilHandle | undefined;
  const checks: Check[] = [];
  try {
    anvil = await spawnAnvilFork(process.env.SEPOLIA_RPC_URL!);
    console.log(`[e2e] anvil forked Sepolia on 127.0.0.1:${anvil.port} (log: ${anvil.logPath})`);

    const deploy = await runForgeDeploy(anvil.rpcUrl);
    restoreRealBroadcastReceipt();
    console.log(`[e2e] deployed throwaway ReliefPool v2 at ${deploy.poolAddress} (deploy block ${deploy.deployBlock})`);
    checks.push(check('deploy ReliefPool v2 against the fork', true, deploy.poolAddress));

    const { publicClient, walletClient, account } = buildClients(anvil.rpcUrl, process.env.DEPLOYER_PRIVATE_KEY as Hex);
    const fallbackKeys: FallbackKeys = {
      pipeline: process.env.PIPELINE_SIGNER_PRIVATE_KEY as Hex,
      coop: process.env.COOP_SIGNER_PRIVATE_KEY as Hex,
      science: process.env.SCIENCE_KEY_PRIVATE_KEY as Hex | undefined,
    };
    const deps = await buildKeeperDeps({
      publicClient,
      walletClient,
      account,
      poolAddress: deploy.poolAddress,
      deployBlock: deploy.deployBlock,
      fallbackKeys,
      push: args.push,
    });

    const farmerBefore = await readJpyc(publicClient as unknown as PublicClient, EXPECTED_FARMER);
    const result1 = await runKeeper({ referenceEventId: args.event, force: true }, deps);
    const farmerAfterFirst = await readJpyc(publicClient as unknown as PublicClient, EXPECTED_FARMER);
    const perUnit = await readAttestationPerUnit(publicClient as unknown as PublicClient, deploy.poolAddress, result1.eventId);
    checks.push(...checkFirstRun(result1, perUnit, farmerAfterFirst - farmerBefore));

    const result2 = await runKeeper({ referenceEventId: args.event, force: true }, deps);
    const farmerAfterSecond = await readJpyc(publicClient as unknown as PublicClient, EXPECTED_FARMER);
    checks.push(checkIdempotentRun(result2));
    checks.push(check('idempotent run moves no JPYC', farmerAfterSecond === farmerAfterFirst, `delta=${farmerAfterSecond - farmerAfterFirst}`));

    checks.push(
      await checkDomainSeparation(publicClient as unknown as PublicClient, deploy.poolAddress, account, fallbackKeys.pipeline!, fallbackKeys.coop!),
    );
  } finally {
    killAnvil(anvil);
    restoreRealBroadcastReceipt(); // belt-and-suspenders: also covers a throw between deploy and here.
  }

  return printTable(checks);
}

// ---------------------------------------------------------------------------
// --live mode
// ---------------------------------------------------------------------------
async function preflightLive(donation: bigint): Promise<ReturnType<typeof privateKeyToAccount>> {
  const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL!) });
  const [ethBal, jpycBal] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    readJpyc(publicClient as unknown as PublicClient, account.address),
  ]);
  console.log('');
  console.log('=== LIVE MODE PREFLIGHT (real Sepolia -- spends real testnet ETH/JPYC) ===');
  console.log(`  deployer:       ${account.address}`);
  console.log(`  ETH balance:    ${formatEther(ethBal)}`);
  console.log(`  JPYC balance:   ${formatUnits(jpycBal, 18)}`);
  console.log(`  planned donation: ${formatUnits(donation, 18)} JPYC`);
  console.log('===========================================================================');
  console.log('');
  if (jpycBal < donation) {
    throw new Error(`deployer JPYC balance (${formatUnits(jpycBal, 18)}) is below the planned donation (${formatUnits(donation, 18)}) -- top up at faucet.jpyc.co.jp first`);
  }
  return account;
}

function runChild(cmd: string[], env: Record<string, string | undefined> = process.env): void {
  const result = Bun.spawnSync(cmd, { cwd: REPO_ROOT, stdout: 'inherit', stderr: 'inherit', env });
  if (result.exitCode !== 0) throw new Error(`command failed (exit ${result.exitCode}): ${cmd.join(' ')}`);
}

async function mbFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = new URL('/api/v0', process.env.MULTIBAAS_URL!).toString().replace(/\/$/, '');
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.MULTIBAAS_API_KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`MultiBaas ${init.method ?? 'GET'} ${path} -> HTTP ${res.status}: ${body.message ?? text}`);
  return body.result ?? body;
}

/** Deletes the `reliefpool` address alias and its contract version, so `bun run multibaas:setup --
 *  --apply` recreates both fresh against the new pool address instead of warning about a stale link.
 *  Best-effort: MultiBaas returns 404 for an alias/contract that's already gone, which is fine here. */
async function relinkMultibaasCleanup(): Promise<void> {
  const chain = 'ethereum';
  try {
    await mbFetch(`/chains/${chain}/addresses/reliefpool`, { method: 'DELETE' });
    console.log('[e2e] deleted MultiBaas address alias "reliefpool"');
  } catch (err) {
    console.warn('[e2e] delete address alias "reliefpool" failed (continuing -- may already be absent):', (err as Error).message);
  }
  try {
    await mbFetch('/contracts/reliefpool/1.0', { method: 'DELETE' });
    console.log('[e2e] deleted MultiBaas contract "reliefpool" version 1.0');
  } catch (err) {
    console.warn('[e2e] delete contract "reliefpool"/1.0 failed (continuing -- may already be absent):', (err as Error).message);
  }
}

/** Polls `railway service status` until the most recent deployment for --service web reports SUCCESS (or a
 *  terminal failure). The exact Railway CLI JSON shape isn't pinned to a version here -- this greps
 *  plain-text output for the outcome keywords, which is coarse but avoids depending on undocumented
 *  --json fields that may change between CLI versions. */
async function waitForRailwaySuccess(timeoutMs = 10 * 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = Bun.spawnSync(['railway', 'service', 'status', '--service', 'web'], { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' });
    const out = result.stdout.toString() + result.stderr.toString();
    if (/\bSUCCESS\b/i.test(out)) {
      console.log('[e2e] Railway deploy reported SUCCESS');
      return;
    }
    if (/\b(FAILED|CRASHED|ERROR)\b/i.test(out)) {
      throw new Error(`Railway deploy reported a terminal failure:\n${out}`);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`Railway deploy did not report SUCCESS within ${timeoutMs}ms -- check the Railway dashboard`);
}

async function runLiveMode(args: Args): Promise<boolean> {
  if (!args.yes) {
    console.error('[e2e] --live spends real testnet JPYC/ETH and repoints the live app at a fresh pool.');
    console.error('[e2e] Re-run with --yes to confirm you have read the preflight and want to proceed.');
    return false;
  }

  requireEnv([
    'SEPOLIA_RPC_URL',
    'DEPLOYER_PRIVATE_KEY',
    'PIPELINE_SIGNER_PRIVATE_KEY',
    'COOP_SIGNER_PRIVATE_KEY',
    'HUMAN_REGISTRY_ADDRESS',
    'ENS_PLOT_RESOLVER_ADAPTER',
    'ENS_SLOT_RESOLVER_ADAPTER',
    'KEEPER_API_TOKEN',
    'MULTIBAAS_URL',
    'MULTIBAAS_API_KEY',
  ]);

  const donation = args.donation ? BigInt(args.donation) : DEFAULT_LIVE_DONATION;
  await preflightLive(donation);

  console.log('[e2e] deploying a FRESH ReliefPool v2 to real Sepolia...');
  const deploy = await runForgeDeploy(process.env.SEPOLIA_RPC_URL!, { DONATION_JPYC: donation.toString() });
  console.log(`[e2e] deployed ${deploy.poolAddress} at block ${deploy.deployBlock}`);
  console.log(`  https://sepolia.etherscan.io/address/${deploy.poolAddress}`);

  console.log('[e2e] writing packages/shared/src/addresses.ts (NOT committing)...');
  const writeAddresses = Bun.spawnSync(['bun', 'scripts/write-addresses.ts'], { cwd: REPO_ROOT, stdin: Buffer.from(deploy.raw), stdout: 'inherit', stderr: 'inherit' });
  if (writeAddresses.exitCode !== 0) throw new Error(`scripts/write-addresses.ts failed (exit ${writeAddresses.exitCode})`);
  const diff = execFileSync('git', ['diff', '--', 'packages/shared/src/addresses.ts'], { cwd: REPO_ROOT, encoding: 'utf8' });
  console.log('--- packages/shared/src/addresses.ts diff (uncommitted -- review and commit yourself if you want to keep it) ---');
  console.log(diff);

  console.log('[e2e] setting Railway web env vars...');
  runChild([
    'railway', 'variables', '--service', 'web', '--skip-deploys',
    '--set', `RELIEF_POOL_ADDRESS=${deploy.poolAddress}`,
    '--set', `NEXT_PUBLIC_RELIEF_POOL_ADDRESS=${deploy.poolAddress}`,
    '--set', `RELIEF_POOL_DEPLOY_BLOCK=${deploy.deployBlock}`,
    '--set', `NEXT_PUBLIC_RELIEF_POOL_DEPLOY_BLOCK=${deploy.deployBlock}`,
  ]);

  console.log('[e2e] redeploying web on Railway...');
  runChild(['railway', 'up', '--service', 'web', '--detach']);
  await waitForRailwaySuccess();

  console.log('[e2e] relinking MultiBaas (delete stale reliefpool alias/contract, then re-apply)...');
  await relinkMultibaasCleanup();
  runChild(['bun', 'run', 'multibaas:setup', '--', '--apply'], { ...process.env, MULTIBAAS_STARTING_BLOCK: String(deploy.deployBlock) });
  console.log(`[e2e] (webhook target defaults to ${MULTIBAAS_WEBHOOK_DEFAULT} unless MULTIBAAS_WEBHOOK_URL is set)`);

  console.log(`[e2e] POST ${LIVE_WEB_URL}/api/keeper/replay (event=${args.event}, force=true)...`);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL!) });
  const farmerBefore = await readJpyc(publicClient as unknown as PublicClient, EXPECTED_FARMER);

  async function postReplay(): Promise<{ ok: boolean; body: Record<string, unknown> }> {
    const res = await fetch(`${LIVE_WEB_URL}/api/keeper/replay`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.KEEPER_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ event: args.event, force: true }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    return { ok: res.ok, body };
  }

  const first = await postReplay();
  const farmerAfterFirst = await readJpyc(publicClient as unknown as PublicClient, EXPECTED_FARMER);

  const checks: Check[] = [];
  checks.push(check('deploy ReliefPool v2 (real Sepolia)', true, deploy.poolAddress));
  checks.push(check('POST /api/keeper/replay ok', first.ok === true, JSON.stringify(first.body).slice(0, 120)));

  const eventId = first.body.eventId as Hex | undefined;
  if (eventId) {
    const perUnit = await readAttestationPerUnit(publicClient as unknown as PublicClient, deploy.poolAddress, eventId);
    const plotOutcomes = (first.body.plotOutcomes as Array<{ plotLabel: string; status: string; reason?: string; farmer?: Address; amount?: string; txHash?: Hex }>) ?? [];
    const paid = plotOutcomes.find((p) => p.plotLabel === DEMO_PLOT);
    checks.push(
      check(
        `${DEMO_PLOT} Paid to expected farmer`,
        paid?.status === 'Paid' && (paid.farmer ?? '').toLowerCase() === EXPECTED_FARMER.toLowerCase(),
        `farmer=${paid?.farmer ?? 'none'} tx=${paid?.txHash ?? 'none'}`,
      ),
    );
    checks.push(check(`${DEMO_PLOT} JPYC delta == attested perUnit`, farmerAfterFirst - farmerBefore === perUnit, `delta=${farmerAfterFirst - farmerBefore} perUnit=${perUnit}`));
    const others = plotOutcomes.filter((p) => p.plotLabel !== DEMO_PLOT);
    checks.push(check('other enrolled scallop plots Held(UNVERIFIED)', others.length > 0 && others.every((p) => p.status === 'Held' && p.reason === 'UNVERIFIED'), `n=${others.length}`));

    console.log('[e2e] tx hashes:');
    if (first.body.attestTxHash) console.log(`  attest: https://sepolia.etherscan.io/tx/${first.body.attestTxHash}`);
    for (const tx of (first.body.settleTxHashes as Hex[] | undefined) ?? []) console.log(`  settle: https://sepolia.etherscan.io/tx/${tx}`);
  }

  const second = await postReplay();
  checks.push(check('idempotent second replay does nothing', second.body.alreadyAttested === true && !second.body.attestTxHash, JSON.stringify(second.body).slice(0, 120)));

  const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
  checks.push(
    await checkDomainSeparation(
      publicClient as unknown as PublicClient,
      deploy.poolAddress,
      account,
      process.env.PIPELINE_SIGNER_PRIVATE_KEY as Hex,
      process.env.COOP_SIGNER_PRIVATE_KEY as Hex,
    ),
  );

  return printTable(checks);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let handledSignal = false;
  const onSignal = () => {
    if (handledSignal) return;
    handledSignal = true;
    console.log('\n[e2e] received signal, exiting...');
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const ok = args.mode === 'live' ? await runLiveMode(args) : await runForkMode(args);
  process.exit(ok ? 0 : 1);
}

await main();
