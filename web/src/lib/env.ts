// Server-only env access. Keep secrets out of NEXT_PUBLIC_*.
const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
export const env = {
  sepoliaRpc: () => need('SEPOLIA_RPC_URL'),
  worldAppId: () => need('WORLD_APP_ID'),
  worldRpId: () => need('WORLD_RP_ID'),
  worldRpSigningKey: () => need('WORLD_RP_SIGNING_KEY'),
  worldAction: () => need('WORLD_ACTION'),
  worldActionL2: () => need('WORLD_ACTION_L2'),
  worldEnvironment: (): 'production' | 'staging' | 'sandbox' => {
    const v = need('WORLD_ENVIRONMENT');
    if (v !== 'production' && v !== 'staging' && v !== 'sandbox') {
      throw new Error(`invalid WORLD_ENVIRONMENT ${v} (want production|staging|sandbox)`);
    }
    return v;
  },
  humanRegistryAddress: () => need('HUMAN_REGISTRY_ADDRESS'),
  binderKey: () => need('BINDER_PRIVATE_KEY'),
  // Messaging API channel: LINE_CHANNEL_SECRET both verifies webhook signatures and, as
  // client_secret, mints stateless channel access tokens (see lib/line.ts).
  lineChannelSecret: () => need('LINE_CHANNEL_SECRET'),
  lineMessagingChannelId: () => need('LINE_MESSAGING_CHANNEL_ID'),
  // Intentionally optional: LINE_CHANNEL_ACCESS_TOKEN is a manual override/fallback.
  // Normally left empty so lib/line.ts mints a short-lived token via client_credentials instead.
  lineChannelAccessTokenOverride: () => process.env.LINE_CHANNEL_ACCESS_TOKEN || undefined,
  // LINE Login channel: used as client_id when verifying LIFF ID tokens (issue #13).
  lineLoginChannelId: () => need('LINE_LOGIN_CHANNEL_ID'),
  // Reserved: not required to verify ID tokens, but configured for future LINE Login server calls (issue #15).
  lineLoginChannelSecret: () => need('LINE_LOGIN_CHANNEL_SECRET'),
  // Signs the LIFF session cookie (issue #13). Any random string; rotate to invalidate all sessions.
  sessionSecret: () => need('SESSION_SECRET'),
  multibaasWebhookSecret: () => need('MULTIBAAS_WEBHOOK_SECRET'),
  pipelineFeedUrl: () => process.env.PIPELINE_FEED_URL ?? 'http://localhost:8787',
  // Optional (unlike the rest of this file): the donor-ledger dashboard (GET /api/multibaas/events) must
  // degrade gracefully before the MultiBaas account is linked to contracts (issue #23, depends on #16),
  // so these read plain process.env instead of throwing via need().
  multibaasUrl: () => process.env.MULTIBAAS_URL,
  multibaasApiKey: () => process.env.MULTIBAAS_API_KEY,
  /** Deployed ReliefPool address (issue #16). Not required: unset means "not deployed yet".
   *  One address, three historical names: RELIEF_POOL_ADDRESS (keeper), RELIEF_POOL (verify page), NEXT_PUBLIC_*. */
  reliefPoolAddress: () =>
    process.env.RELIEF_POOL_ADDRESS || process.env.RELIEF_POOL || process.env.NEXT_PUBLIC_RELIEF_POOL_ADDRESS || undefined,

  // --- Keeper (issue #17) ------------------------------------------------------------------
  // Deployed by issue #16; the keeper always reads the live env var (never packages/shared/src/addresses.ts
  // DEPLOYED, which stays the placeholder zero address until that issue lands and regenerates it).
  // Block ReliefPool was deployed at, so the keeper's Enrolled-event scan doesn't have to start from genesis
  // on a public RPC. Optional: unset/0 scans from genesis, which is fine for anvil/local.
  reliefPoolDeployBlock: (): bigint => {
    const v = process.env.RELIEF_POOL_DEPLOY_BLOCK;
    return v ? BigInt(v) : 0n;
  },
  // Bearer token protecting POST /api/keeper/replay.
  keeperApiToken: () => need('KEEPER_API_TOKEN'),
  // Sends attest/settle transactions. Only read when a keeper run actually broadcasts (never in --dry-run).
  keeperPrivateKey: () => need('KEEPER_PRIVATE_KEY'),
  // Fallback EIP-712 signers: the keeper builds and signs the Trigger itself with these when the pipeline
  // feed (issue #9) is down or its signature doesn't recover to a registered signer. Optional -- only
  // required if the fallback path actually runs, so these read plain process.env instead of need().
  pipelineSignerPrivateKey: () => process.env.PIPELINE_SIGNER_PRIVATE_KEY || undefined,
  coopSignerPrivateKey: () => process.env.COOP_SIGNER_PRIVATE_KEY || undefined,
  scienceKeyPrivateKey: () => process.env.SCIENCE_KEY_PRIVATE_KEY || undefined,
  // JSON-file-backed payout directory (web/src/lib/payout-directory.ts). Not durable on a read-only /
  // ephemeral serverless filesystem -- fine for local dev and the keeper's own long-lived process.
  payoutDirectoryFile: () => process.env.PAYOUT_DIRECTORY_FILE || '.data/payout-directory.json',
};

// Public, client-safe config (issues #19/#20/#21). Unlike `env` above these never throw: an unset address means
// "not deployed yet" (see #16), and screens render a clean empty state instead of crashing. Read these from
// Server Components/route handlers and pass the resolved values down as props — NEXT_PUBLIC_* vars are only
// statically inlined for literal `process.env.NEXT_PUBLIC_X` access in client bundles, so a shared dynamic
// getter like this must be called server-side.
const optional = (k: string) => {
  const v = process.env[k];
  return v && v.length > 0 ? v : undefined;
};
export const publicEnv = {
  sepoliaRpcUrl: () => optional('NEXT_PUBLIC_SEPOLIA_RPC_URL'),
  reliefPool: () => optional('NEXT_PUBLIC_RELIEF_POOL_ADDRESS'),
  reliefPoolDeployBlock: () => optional('NEXT_PUBLIC_RELIEF_POOL_DEPLOY_BLOCK'),
  humanRegistry: () => optional('NEXT_PUBLIC_HUMAN_REGISTRY_ADDRESS'),
  ensParentRegistry: () => optional('NEXT_PUBLIC_ENS_PARENT_REGISTRY_ADDRESS'),
  ensPlotResolver: () => optional('NEXT_PUBLIC_ENS_PLOT_RESOLVER_ADDRESS'),
  ensSlotRegistry: () => optional('NEXT_PUBLIC_ENS_SLOT_REGISTRY_ADDRESS'),

};
