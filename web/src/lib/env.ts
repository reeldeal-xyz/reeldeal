// Server-only env access. Keep secrets out of NEXT_PUBLIC_*.
const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
export const env = {
  sepoliaRpc: () => need('SEPOLIA_RPC_URL'),
  worldAppId: () => need('WORLD_APP_ID'),
  worldRpId: () => need('WORLD_RP_ID'),
  worldRpSigningKey: () => need('WORLD_RP_SIGNING_KEY'),
  binderKey: () => need('BINDER_PRIVATE_KEY'),
  lineChannelSecret: () => need('LINE_CHANNEL_SECRET'),
  lineAccessToken: () => need('LINE_CHANNEL_ACCESS_TOKEN'),
  lineLoginChannelId: () => need('LINE_LOGIN_CHANNEL_ID'),
  multibaasWebhookSecret: () => need('MULTIBAAS_WEBHOOK_SECRET'),
  pipelineFeedUrl: () => process.env.PIPELINE_FEED_URL ?? 'http://localhost:8787',
};
