// Framework-agnostic core of POST /api/world/verify. Kept separate from route.ts so it can be
// unit tested without a Next.js request/response and without hitting the network or Sepolia.
import { isAddress, type Address } from 'viem';
import type { IDKitResult } from '@worldcoin/idkit-core';
import { env } from '@/lib/env';
import { actionForLevel, type WorldLevel } from './schema';
import { callWorldVerify as defaultCallWorldVerify, WorldVerifyError } from './verify-client';
import { pickCredential } from './credential';
import {
  bindOrUpgradeOnChain as defaultBindOrUpgradeOnChain,
  computeReceiptHash,
  toNullifierBytes32,
  WorldBindError,
} from './binder';
import { logWorldOutcome, type WorldOutcome } from './log';

interface ProofBody {
  level: WorldLevel;
  wallet: Address;
  result: IDKitResult;
}

interface ClientErrorBody {
  level: WorldLevel;
  wallet: Address;
  clientError: string;
}

type ParsedBody = ProofBody | ClientErrorBody;

function parseBody(body: unknown): ParsedBody | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;

  const level = b.level;
  if (level !== 'level1' && level !== 'level2') return null;

  const wallet = b.wallet;
  if (typeof wallet !== 'string' || !isAddress(wallet)) return null;

  if (typeof b.clientError === 'string' && b.clientError.length > 0) {
    return { level, wallet, clientError: b.clientError };
  }
  if (b.result && typeof b.result === 'object') {
    return { level, wallet, result: b.result as IDKitResult };
  }
  return null;
}

const CANCELLED_CLIENT_CODES = new Set(['user_rejected', 'verification_rejected', 'cancelled', 'timeout']);
const DUPLICATE_CLIENT_CODES = new Set(['nullifier_replayed', 'duplicate_nonce']);

function outcomeForClientError(code: string): WorldOutcome {
  if (CANCELLED_CLIENT_CODES.has(code)) return 'cancelled';
  if (DUPLICATE_CLIENT_CODES.has(code)) return 'duplicate';
  return 'rejected';
}

const CLIENT_ERROR_MESSAGES: Record<string, string> = {
  user_rejected: 'Verification was cancelled in World App.',
  verification_rejected: 'Verification was cancelled in World App.',
  cancelled: 'Verification was cancelled.',
  timeout: 'Verification timed out. Please try again.',
  nullifier_replayed: 'This World ID has already completed this verification.',
  duplicate_nonce: 'That verification request expired. Please try again.',
  invalid_rp_signature: 'Verification setup expired. Please try again.',
  rp_signature_expired: 'Verification setup expired. Please try again.',
  invalid_network: 'Verification environment mismatch. Please try again.',
  credential_unavailable: 'The requested World ID credential is not available for this account.',
};

function messageForClientError(code: string): string {
  return CLIENT_ERROR_MESSAGES[code] ?? 'World ID verification failed. Please try again.';
}

export interface HandleWorldVerifyDeps {
  callWorldVerify: typeof defaultCallWorldVerify;
  bindOrUpgradeOnChain: typeof defaultBindOrUpgradeOnChain;
}

const defaultDeps: HandleWorldVerifyDeps = {
  callWorldVerify: defaultCallWorldVerify,
  bindOrUpgradeOnChain: defaultBindOrUpgradeOnChain,
};

export interface WorldVerifyResponse {
  status: number;
  body: Record<string, unknown>;
}

export async function handleWorldVerify(raw: unknown, deps: HandleWorldVerifyDeps = defaultDeps): Promise<WorldVerifyResponse> {
  const parsed = parseBody(raw);
  if (!parsed) {
    return { status: 400, body: { error: 'invalid_request' } };
  }

  const { level, wallet } = parsed;

  if ('clientError' in parsed) {
    const outcome = outcomeForClientError(parsed.clientError);
    logWorldOutcome({ outcome, level, wallet, reason: parsed.clientError });
    return { status: 400, body: { error: parsed.clientError, message: messageForClientError(parsed.clientError) } };
  }

  const { result } = parsed;

  try {
    await deps.callWorldVerify(env.worldRpId(), result);
  } catch (err) {
    const reason = err instanceof WorldVerifyError ? err.message : 'unexpected';
    logWorldOutcome({ outcome: 'rejected', level, wallet, reason });
    return { status: 400, body: { error: 'proof_rejected', message: 'World ID could not verify this proof.' } };
  }

  if (result.protocol_version !== '4.0' || 'session_id' in result) {
    logWorldOutcome({ outcome: 'rejected', level, wallet, reason: 'unsupported_protocol' });
    return { status: 400, body: { error: 'unsupported_protocol', message: 'Unsupported World ID proof type.' } };
  }

  const expectedAction = actionForLevel(level);
  if (result.action !== expectedAction || result.environment !== env.worldEnvironment()) {
    logWorldOutcome({ outcome: 'rejected', level, wallet, reason: 'scope_mismatch' });
    return { status: 400, body: { error: 'scope_mismatch', message: 'Verification context did not match this request.' } };
  }

  const credential = pickCredential(result, level, wallet);
  if (!credential) {
    logWorldOutcome({ outcome: 'rejected', level, wallet, reason: 'no_matching_credential' });
    return {
      status: 400,
      body: { error: 'no_matching_credential', message: 'This proof does not match the requested wallet or level.' },
    };
  }

  const verifiedAt = Math.floor(Date.now() / 1000);
  const nullifier = toNullifierBytes32(credential.nullifier);
  const receiptHash = computeReceiptHash({
    wallet,
    nullifier,
    schemaId: credential.issuerSchemaId,
    action: expectedAction,
    verifiedAt,
  });

  try {
    const { txHash, call } = await deps.bindOrUpgradeOnChain({
      wallet,
      nullifier,
      schemaId: credential.issuerSchemaId,
      sybilScoreBps: credential.sybilScoreBps,
      verifiedAt,
      receiptHash,
    });
    logWorldOutcome({
      outcome: 'success',
      level,
      wallet,
      schemaId: credential.issuerSchemaId,
      nullifier: credential.nullifier,
      txHash,
    });
    // schemaId is included so the LIFF wallet tab (issue #15) can show which credential verified the farmer
    // (11 Selfie Check, 1 Orb/Proof of Human -- see lib/world/schema.ts)
    // without a second on-chain read right after this call returns.
    return { status: 200, body: { ok: true, call, level: credential.level, schemaId: credential.issuerSchemaId, txHash } };
  } catch (err) {
    if (err instanceof WorldBindError) {
      const outcome: WorldOutcome =
        err.code === 'nullifier_already_bound' || err.code === 'wallet_already_bound' ? 'duplicate' : 'rejected';
      logWorldOutcome({
        outcome,
        level,
        wallet,
        schemaId: credential.issuerSchemaId,
        nullifier: credential.nullifier,
        reason: err.code,
      });
      return { status: outcome === 'duplicate' ? 409 : 400, body: { error: err.code, message: err.userMessage } };
    }
    logWorldOutcome({
      outcome: 'error',
      level,
      wallet,
      schemaId: credential.issuerSchemaId,
      nullifier: credential.nullifier,
      reason: String(err),
    });
    return {
      status: 502,
      body: { error: 'bind_failed', message: 'Could not record verification on-chain. Please try again.' },
    };
  }
}
