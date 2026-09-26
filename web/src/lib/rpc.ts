// Sepolia transport for every server-side viem client. SEPOLIA_RPC_URL may list several endpoints,
// comma-separated; viem's fallback transport moves on to the next one when a free public RPC
// rate-limits or rejects a call (Tenderly throttles eth_sendRawTransaction, publicnode throttles
// eth_getLogs), so a single provider hiccup can't fail an attest or settle mid-demo.
import { fallback, http, type Transport } from 'viem';
import { env } from '@/lib/env';

export function rpcUrls(raw: string = env.sepoliaRpc()): string[] {
  return raw
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

export function sepoliaTransport(raw?: string): Transport {
  const urls = rpcUrls(raw);
  if (urls.length === 1) return http(urls[0], { retryCount: 3 });
  return fallback(
    urls.map((u) => http(u, { retryCount: 1 })),
    { retryCount: 2 },
  );
}
