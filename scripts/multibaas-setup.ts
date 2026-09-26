// Curvegrid MultiBaas setup for Reel Deal (issue #23): links ReliefPool, HumanRegistry and JPYC as
// contracts/addresses, uploads ABIs, enables event indexing, and registers the webhook.
//
// Docs used (cite: no single page covers all of this, so this script is built from several):
//   - https://docs.curvegrid.com/multibaas/webhooks/            (webhook subscriptions, POST /webhooks)
//   - https://docs.curvegrid.com/multibaas/event-indexing/      (what "sync events" means)
//   - https://docs.curvegrid.com/multibaas/manage-contracts/    (linking an address to a contract)
//   - https://github.com/curvegrid/multibaas-sdk-typescript     (openapi-generator-derived REST reference —
//     docs/{AddressesApi,ContractsApi,WebhooksApi}.md and docs/{AddressAlias,BaseContract,
//     LinkAddressContractRequest,BaseWebhookEndpoint,WebhookEndpoint}.md gave the exact paths/bodies below)
//   - Confirmed read-only against the live (pre-#16) deployment on 2026-09-26: GET /api/v0/contracts already
//     lists a built-in `erc20interface` (ERC20Interface) contract on every MultiBaas deployment — this
//     script reuses that label for JPYC instead of uploading a redundant ERC20 ABI.
//
// This script is idempotent (checks before every write, skips what's already there) and dry-run by
// default — it only performs read-only GETs unless you pass --apply. It has never been run with --apply
// against a real deployment; do that only once ReliefPool/HumanRegistry are deployed (issue #16).
//
// Usage:
//   bun scripts/multibaas-setup.ts            # dry run: prints the plan, GETs only, no writes
//   bun scripts/multibaas-setup.ts --apply     # actually create/link/register against MULTIBAAS_URL
//
// Required env: MULTIBAAS_URL, MULTIBAAS_API_KEY (Administrators-group key; see docs/MULTIBAAS.md).
// Address env (all optional — fall back to packages/shared/src/addresses.ts, which JPYC always has and
// ReliefPool/HumanRegistry only have after #16 deploys and regenerates that file):
//   RELIEF_POOL_ADDRESS, HUMAN_REGISTRY_ADDRESS, JPYC_ADDRESS
// Optional tuning:
//   MULTIBAAS_STARTING_BLOCK  block to start event indexing from: 'latest', an absolute block number, or
//                             a relative one like '-100' (default: 'latest' — see LinkAddressContractRequest
//                             in the SDK docs above for the exact semantics)
//   MULTIBAAS_WEBHOOK_URL     overrides the webhook endpoint URL (default: the Railway URL below)

// Relative import (not '@repo/shared') because this script runs standalone from the repo root, which
// isn't itself a workspace consumer of packages/shared (only web/ and pipeline/ are).
import { DEPLOYED, HumanRegistryAbi, JPYC as JPYC_ADDRESS, ReliefPoolAbi } from '../packages/shared/src/index';

const WEBHOOK_URL_DEFAULT = 'https://web-production-746aa.up.railway.app/api/multibaas/webhook';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const CHAIN = 'ethereum'; // MultiBaas's fixed EVM-chain path segment; the actual network is per-deployment.

const APPLY = process.argv.includes('--apply');

function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env ${key}`);
  return v;
}

interface MbEnvelope<T> {
  status: number;
  message: string;
  result: T;
}

function mbBaseUrl(): string {
  return new URL('/api/v0', need('MULTIBAAS_URL')).toString().replace(/\/$/, '');
}

async function mbFetch<T>(path: string, init: RequestInit = {}): Promise<MbEnvelope<T>> {
  const res = await fetch(`${mbBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${need('MULTIBAAS_API_KEY')}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = (text ? JSON.parse(text) : {}) as MbEnvelope<T>;
  if (!res.ok) {
    throw new Error(`MultiBaas ${init.method ?? 'GET'} ${path} -> HTTP ${res.status}: ${body.message ?? text}`);
  }
  return body;
}

interface AddressAlias {
  alias: string;
  address: string;
}

interface ContractInstance {
  alias: string;
  address: string;
}

interface ContractOverview {
  label: string;
  contractName: string;
  version: string;
  deployable: boolean;
  instances: ContractInstance[];
}

interface WebhookEndpoint {
  id: number;
  url: string;
  label: string;
  subscriptions: string[];
  secret: string;
}

interface ContractPlan {
  /** Address alias in MultiBaas, e.g. 'reliefpool'. */
  alias: string;
  address: string;
  /** Contract label in MultiBaas. */
  contractLabel: string;
  contractName: string;
  version: string;
  /** Omit to reuse an existing MultiBaas-provided contract label (JPYC -> the built-in erc20interface). */
  abi?: readonly unknown[];
}

function loadPlans(): ContractPlan[] {
  const reliefPoolAddress = process.env.RELIEF_POOL_ADDRESS ?? DEPLOYED.ReliefPool;
  const humanRegistryAddress = process.env.HUMAN_REGISTRY_ADDRESS ?? DEPLOYED.HumanRegistry;
  const jpycAddress = process.env.JPYC_ADDRESS ?? JPYC_ADDRESS;

  const plans: ContractPlan[] = [
    {
      alias: 'reliefpool',
      address: reliefPoolAddress,
      contractLabel: 'reliefpool',
      contractName: 'ReliefPool',
      version: '1.0',
      abi: ReliefPoolAbi,
    },
    {
      alias: 'humanregistry',
      address: humanRegistryAddress,
      contractLabel: 'humanregistry',
      contractName: 'HumanRegistry',
      version: '1.0',
      abi: HumanRegistryAbi,
    },
    {
      alias: 'jpyc',
      address: jpycAddress,
      contractLabel: 'erc20interface', // built-in on every MultiBaas deployment; no ABI upload needed.
      contractName: 'ERC20Interface',
      version: '1.0',
    },
  ];

  return plans.filter((p) => {
    if (!p.address || p.address === ZERO_ADDRESS) {
      console.log(`skip ${p.contractLabel}: no deployed address yet (issue #16) — set an override env var`);
      return false;
    }
    return true;
  });
}

async function ensureAddress(plan: ContractPlan, existing: AddressAlias[]): Promise<void> {
  const found = existing.find((a) => a.alias === plan.alias);
  if (found) {
    if (found.address.toLowerCase() !== plan.address.toLowerCase()) {
      console.warn(`! address alias '${plan.alias}' exists but points at ${found.address}, not ${plan.address}`);
    } else {
      console.log(`= address alias '${plan.alias}' already set to ${plan.address}`);
    }
    return;
  }

  console.log(`+ ${APPLY ? 'creating' : 'would create'} address alias '${plan.alias}' -> ${plan.address}`);
  if (!APPLY) return;
  await mbFetch<AddressAlias>(`/chains/${CHAIN}/addresses`, {
    method: 'POST',
    body: JSON.stringify({ alias: plan.alias, address: plan.address }),
  });
}

async function ensureContract(plan: ContractPlan, existing: ContractOverview[]): Promise<ContractOverview | undefined> {
  const found = existing.find((c) => c.label === plan.contractLabel);
  if (found) {
    console.log(`= contract '${plan.contractLabel}' already exists`);
    return found;
  }

  if (!plan.abi) {
    console.warn(
      `! contract '${plan.contractLabel}' not found and no ABI given to upload (expected it to be built-in) —` +
        ' link/webhook steps for this contract will be skipped',
    );
    return undefined;
  }

  console.log(`+ ${APPLY ? 'creating' : 'would create'} contract '${plan.contractLabel}' (${plan.contractName})`);
  if (!APPLY) {
    // Synthetic stand-in so ensureLinked can still print the rest of the plan in dry-run mode.
    return { label: plan.contractLabel, contractName: plan.contractName, version: plan.version, deployable: false, instances: [] };
  }
  const created = await mbFetch<ContractOverview>(`/contracts/${plan.contractLabel}`, {
    method: 'POST',
    body: JSON.stringify({
      label: plan.contractLabel,
      contractName: plan.contractName,
      version: plan.version,
      rawAbi: JSON.stringify(plan.abi),
      // MultiBaas rejects contracts without bytecode; read it from the Foundry build output.
      bin: bytecodeFor(plan.contractName),
    }),
  });
  return created.result;
}

async function ensureLinked(plan: ContractPlan, contract: ContractOverview | undefined): Promise<void> {
  if (!contract) return; // couldn't create/find the contract above; nothing to link.
  const alreadyLinked = contract.instances?.some((i) => i.alias === plan.alias);
  if (alreadyLinked) {
    console.log(`= '${plan.contractLabel}' already linked to '${plan.alias}' (event indexing enabled)`);
    return;
  }

  const startingBlock = process.env.MULTIBAAS_STARTING_BLOCK ?? 'latest';
  console.log(
    `+ ${APPLY ? 'linking' : 'would link'} '${plan.alias}' -> contract '${plan.contractLabel}'` +
      ` (event indexing from ${startingBlock})`,
  );
  if (!APPLY) return;
  await mbFetch(`/chains/${CHAIN}/addresses/${plan.alias}/contracts`, {
    method: 'POST',
    body: JSON.stringify({ label: plan.contractLabel, version: plan.version, startingBlock }),
  });
}

async function ensureWebhook(existing: WebhookEndpoint[]): Promise<void> {
  const url = process.env.MULTIBAAS_WEBHOOK_URL ?? WEBHOOK_URL_DEFAULT;
  const found = existing.find((w) => w.url === url);
  if (found) {
    console.log(`= webhook already registered for ${url} (id ${found.id})`);
    return;
  }

  console.log(`+ ${APPLY ? 'registering' : 'would register'} webhook -> ${url} (subscriptions: event.emitted)`);
  if (!APPLY) return;
  const created = await mbFetch<WebhookEndpoint>('/webhooks', {
    method: 'POST',
    body: JSON.stringify({ url, label: 'umi-webhook', subscriptions: ['event.emitted'] }),
  });
  console.log('');
  console.log('  MultiBaas generated a webhook secret. Set it now — it is shown only once here:');
  console.log(`    MULTIBAAS_WEBHOOK_SECRET=${created.result.secret}`);
  console.log('');
}

async function main() {
  console.log(`MultiBaas setup for Reel Deal — ${APPLY ? 'APPLY mode (will write)' : 'dry run (read-only)'}`);
  console.log(`  MULTIBAAS_URL: ${process.env.MULTIBAAS_URL ?? '(unset)'}`);

  const plans = loadPlans();
  if (plans.length === 0) {
    console.log('Nothing to do: no contract has a non-zero deployed address yet.');
    return;
  }

  const [addressesResp, contractsResp, webhooksResp] = await Promise.all([
    mbFetch<AddressAlias[]>(`/chains/${CHAIN}/addresses`),
    mbFetch<ContractOverview[]>('/contracts'),
    mbFetch<WebhookEndpoint[]>('/webhooks'),
  ]);

  for (const plan of plans) {
    await ensureAddress(plan, addressesResp.result);
  }

  // Re-fetch contracts once per plan as we go, since ensureContract may have just created one.
  let contracts = contractsResp.result;
  for (const plan of plans) {
    const contract = await ensureContract(plan, contracts);
    if (APPLY && contract) {
      contracts = [...contracts.filter((c) => c.label !== contract.label), contract];
    }
    await ensureLinked(plan, contract ?? contracts.find((c) => c.label === plan.contractLabel));
  }

  await ensureWebhook(webhooksResp.result);

  if (!APPLY) {
    console.log('');
    console.log('Dry run only — re-run with --apply to make these changes.');
  }
}

await main();

function bytecodeFor(contractName: string): string {
  const path = new URL(`../contracts/out/${contractName}.sol/${contractName}.json`, import.meta.url);
  try {
    const artifact = JSON.parse(require('node:fs').readFileSync(path, 'utf8')) as { bytecode?: { object?: string } };
    return artifact.bytecode?.object ?? '0x';
  } catch {
    return '0x';
  }
}
