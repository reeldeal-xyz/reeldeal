// Server-only: builds the RP-signed request context IDKit needs to open a verification request.
// Never import this from a client component -- it touches WORLD_RP_SIGNING_KEY.
import { signRequest } from '@worldcoin/idkit-core/signing';
import { env } from '@/lib/env';
import { actionForLevel, type WorldLevel } from './schema';

/** How long a signed RP context stays valid before the client must request a fresh one. */
const RP_CONTEXT_TTL_SECONDS = 300;

export interface WorldRequestContext {
  app_id: `app_${string}`;
  action: string;
  environment: 'production' | 'staging' | 'sandbox';
  rp_context: {
    rp_id: string;
    nonce: string;
    created_at: number;
    expires_at: number;
    signature: string;
  };
}

export function buildWorldRequestContext(level: WorldLevel): WorldRequestContext {
  const appId = env.worldAppId();
  if (!appId.startsWith('app_')) {
    throw new Error('WORLD_APP_ID must start with app_');
  }
  const action = actionForLevel(level);
  const sig = signRequest({
    signingKeyHex: env.worldRpSigningKey(),
    action,
    ttl: RP_CONTEXT_TTL_SECONDS,
  });
  return {
    app_id: appId as `app_${string}`,
    action,
    environment: env.worldEnvironment(),
    rp_context: {
      rp_id: env.worldRpId(),
      nonce: sig.nonce,
      created_at: sig.createdAt,
      expires_at: sig.expiresAt,
      signature: sig.sig,
    },
  };
}
