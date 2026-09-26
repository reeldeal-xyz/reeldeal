#!/usr/bin/env bun
// Reads the `export NAME= 0x...` lines contracts/script/DeployReelDeal.s.sol's run()/dryRun()/
// dryRunAgainstLive() print (issue #16), and writes them into packages/shared/src/addresses.ts's DEPLOYED
// block. Keeps the file's existing structure/comments -- only the DEPLOYED object is rewritten, and any
// existing DEPLOYED field this run's stdin doesn't mention is left as-is.
//
// Usage:
//   forge script script/DeployReelDeal.s.sol:DeployReelDeal --sig "run()" \
//     --rpc-url $SEPOLIA_RPC_URL --broadcast | bun scripts/write-addresses.ts
// or from a saved copy of the deploy output:
//   bun scripts/write-addresses.ts < deploy-output.txt

import { readFileSync, writeFileSync } from 'node:fs';

const ADDRESSES_PATH = 'packages/shared/src/addresses.ts';

// forge export-line name -> DEPLOYED key.
const KEY_MAP: Record<string, string> = {
  HUMAN_REGISTRY_ADDRESS: 'HumanRegistry',
  RELIEF_POOL_ADDRESS: 'ReliefPool',
  RELIEF_POOL_DEPLOY_BLOCK: 'ReliefPoolDeployBlock',
  ENS_PLOT_RESOLVER_ADAPTER: 'EnsPlotResolver',
  ENS_SLOT_RESOLVER_ADAPTER: 'EnsSlotResolver',
};

// DEPLOYED fields that are plain numbers rather than quoted address strings.
const NUMERIC_KEYS = new Set(['ReliefPoolDeployBlock']);

function parseExportLines(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Matches both "export NAME=value" and console2.log's "export NAME= value" (space after '=').
  const re = /export\s+([A-Z0-9_]+)\s*=\s*(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    out[m[1]] = m[2];
  }
  return out;
}

function parseDeployedFields(deployedBlock: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+):\s*(?:'([^']*)'|(-?\d+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(deployedBlock))) {
    out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return out;
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const input = await readStdin();
const parsed = parseExportLines(input);

const updates = Object.entries(KEY_MAP).filter(([envName]) => parsed[envName] !== undefined);
if (updates.length === 0) {
  console.error(`No recognized export lines found on stdin. Expected one of: ${Object.keys(KEY_MAP).join(', ')}`);
  process.exit(1);
}

const src = readFileSync(ADDRESSES_PATH, 'utf8');
const deployedBlockRe = /export const DEPLOYED = \{[\s\S]*?\} as const;/;
const match = src.match(deployedBlockRe);
if (!match) {
  console.error(`Could not find "export const DEPLOYED = {...} as const;" in ${ADDRESSES_PATH}`);
  process.exit(1);
}

const fields = parseDeployedFields(match[0]);
for (const [envName, deployedKey] of updates) {
  fields[deployedKey] = parsed[envName];
}

const lines = Object.entries(fields).map(([key, value]) =>
  NUMERIC_KEYS.has(key) ? `  ${key}: ${Number(value)},` : `  ${key}: '${value}',`,
);
const newBlock = `export const DEPLOYED = {\n${lines.join('\n')}\n} as const;`;

writeFileSync(ADDRESSES_PATH, src.replace(deployedBlockRe, newBlock));

console.log(`Updated ${ADDRESSES_PATH}:`);
for (const [envName, deployedKey] of updates) {
  console.log(`  ${deployedKey} = ${parsed[envName]}`);
}
