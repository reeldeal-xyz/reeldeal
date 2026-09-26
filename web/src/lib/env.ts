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
};
