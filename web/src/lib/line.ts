// LINE Messaging API push (issue #14): Paid / Held notifications, JA first then EN.
// https://developers.line.biz/en/docs/messaging-api/sending-messages/
// https://developers.line.biz/en/docs/messaging-api/using-flex-messages/
import { messagingApi } from '@line/bot-sdk';
import { formatUnits } from 'viem';
import { JPYC_DECIMALS } from '@repo/shared';
import { env } from './env';

const TOKEN_ENDPOINT = 'https://api.line.me/oauth2/v3/token';
// LINE's stateless client_credentials token is short-lived; refresh comfortably inside its window.
const TOKEN_MAX_TTL_MS = 15 * 60 * 1000;
const TOKEN_SAFETY_MARGIN_MS = 60 * 1000;

interface CachedToken {
  value: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

/** Test-only: drop the in-memory token cache so a test run starts clean. */
export function _resetChannelAccessTokenCacheForTests(): void {
  cachedToken = null;
}

async function mintChannelAccessToken(): Promise<CachedToken> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.lineMessagingChannelId(),
    client_secret: env.lineChannelSecret(),
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LINE channel access token mint failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number; token_type: string };
  const ttlMs = Math.max(Math.min(json.expires_in * 1000, TOKEN_MAX_TTL_MS) - TOKEN_SAFETY_MARGIN_MS, 0);
  return { value: json.access_token, expiresAt: Date.now() + ttlMs };
}

async function getChannelAccessToken(): Promise<string> {
  const override = env.lineChannelAccessTokenOverride();
  if (override) return override;

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  cachedToken = await mintChannelAccessToken();
  return cachedToken.value;
}

async function messagingClient(): Promise<messagingApi.MessagingApiClient> {
  const channelAccessToken = await getChannelAccessToken();
  return new messagingApi.MessagingApiClient({ channelAccessToken });
}

// --- Quota counter (free plan: 200 pushes/month) ---------------------------------------------
// In-memory only (no DB, per issue #13/#14 scope): resets on deploy/restart. Good enough to catch
// "we're about to blow the free quota" during a demo; swap for a persisted counter before relying
// on it in production.
const FREE_PLAN_MONTHLY_PUSH_QUOTA = 200;

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}

let quota = { month: monthKey(new Date()), count: 0 };

function trackPush(): number {
  const key = monthKey(new Date());
  if (quota.month !== key) quota = { month: key, count: 0 };
  quota.count += 1;
  if (quota.count > FREE_PLAN_MONTHLY_PUSH_QUOTA) {
    console.warn(
      `[line] push quota exceeded: ${quota.count}/${FREE_PLAN_MONTHLY_PUSH_QUOTA} pushes this month (in-memory counter; use reply messages for further testing)`,
    );
  }
  return quota.count;
}

export function getPushQuota(): { month: string; count: number; limit: number } {
  return { ...quota, limit: FREE_PLAN_MONTHLY_PUSH_QUOTA };
}

// --- Formatting --------------------------------------------------------------------------------

/** Formats an 18-decimal JPYC amount as a yen string with thousands separators, e.g. "¥20,000". */
export function formatJpyc(amountWei: bigint): string {
  const asDecimal = formatUnits(amountWei, JPYC_DECIMALS);
  const fractionPart = asDecimal.split('.')[1] ?? '';
  const hasFraction = fractionPart !== '' && !/^0+$/.test(fractionPart);
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(Number(asDecimal));
}

// --- Message templates ---------------------------------------------------------------------

export interface PaidPushParams {
  plotCode: string; // e.g. "p1213-017"
  zoneLabel: string; // display label, e.g. "唐桑東"
  amountWei: bigint;
  txHash?: `0x${string}`;
}

export interface HeldPushParams {
  plotCode: string;
  zoneLabel: string;
  reasonJa: string; // e.g. "本人確認をすると受け取れます"
  reasonEn: string; // e.g. "Verify your identity to receive the payout."
}

const BRAND = 'Real Deal';
const COLOR_PAID = '#0f9d58';
const COLOR_HELD = '#e8a33d';
const COLOR_MUTED = '#6b7280';

function headerBox(label: string, color: string): messagingApi.FlexBox {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: color,
    paddingAll: '12px',
    contents: [
      { type: 'text', text: BRAND, color: '#ffffff', weight: 'bold', size: 'sm' },
      { type: 'text', text: label, color: '#ffffff', weight: 'bold', size: 'lg', margin: 'sm' },
    ],
  };
}

function paidFlexContents(params: PaidPushParams): messagingApi.FlexBubble {
  const amount = formatJpyc(params.amountWei);
  const contents: messagingApi.FlexBox['contents'] = [
    { type: 'text', text: amount, weight: 'bold', size: 'xxl', color: COLOR_PAID },
    { type: 'text', text: `${params.zoneLabel} ${params.plotCode}`, size: 'sm', color: COLOR_MUTED, margin: 'sm' },
    { type: 'text', text: 'のお見舞金が届きました', wrap: true, margin: 'md' },
    { type: 'separator', margin: 'lg' },
    {
      type: 'text',
      text: `A relief payment of ${amount} has arrived for plot ${params.plotCode} (${params.zoneLabel}).`,
      wrap: true,
      size: 'xs',
      color: COLOR_MUTED,
      margin: 'lg',
    },
  ];
  if (params.txHash) {
    contents.push({
      type: 'text',
      text: `Tx: ${params.txHash}`,
      wrap: true,
      size: 'xs',
      color: COLOR_MUTED,
      margin: 'sm',
      action: {
        type: 'uri',
        label: 'View on Etherscan',
        uri: `https://sepolia.etherscan.io/tx/${params.txHash}`,
      },
    });
  }

  return {
    type: 'bubble',
    header: headerBox('お見舞金が届きました / Payout received', COLOR_PAID),
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents },
  };
}

function heldFlexContents(params: HeldPushParams): messagingApi.FlexBubble {
  return {
    type: 'bubble',
    header: headerBox('保留中 / Held', COLOR_HELD),
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: `${params.zoneLabel} ${params.plotCode}`, size: 'sm', color: COLOR_MUTED },
        { type: 'text', text: params.reasonJa, wrap: true, weight: 'bold', margin: 'md' },
        { type: 'separator', margin: 'lg' },
        { type: 'text', text: params.reasonEn, wrap: true, size: 'xs', color: COLOR_MUTED, margin: 'lg' },
      ],
    },
  };
}

// --- Sends ---------------------------------------------------------------------------------

async function sendFlex(userId: string, altText: string, contents: messagingApi.FlexBubble): Promise<void> {
  const client = await messagingClient();
  const message: messagingApi.FlexMessage = { type: 'flex', altText, contents };
  await client.pushMessage({ to: userId, messages: [message] });
  trackPush();
}

/** Pushes the "Paid" notification: a relief payment landed for this plot. */
export async function pushPaid(userId: string, params: PaidPushParams): Promise<void> {
  const altText = `${params.zoneLabel} ${params.plotCode}: ${formatJpyc(params.amountWei)} のお見舞金が届きました`;
  await sendFlex(userId, altText, paidFlexContents(params));
}

/** Pushes the "Held" notification: payout is pending until the farmer verifies with World ID. */
export async function pushHeld(userId: string, params: HeldPushParams): Promise<void> {
  const altText = `保留中: ${params.reasonJa}`;
  await sendFlex(userId, altText, heldFlexContents(params));
}

/**
 * Replies to a LINE webhook event using its replyToken (Jev intent routing). Unlike pushPaid/pushHeld,
 * replies don't count against the free-plan push quota, but the replyToken is single-use and only valid
 * for a short window after the webhook fires -- always reply from inside the same request that received it.
 */
export async function replyMessage(replyToken: string, messages: messagingApi.Message[]): Promise<void> {
  const client = await messagingClient();
  await client.replyMessage({ replyToken, messages });
}
