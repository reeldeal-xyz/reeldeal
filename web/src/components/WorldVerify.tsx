'use client';

// Reusable World ID verify/upgrade flow. #15 (LIFF bind flow) embeds this for both level 1
// (bind-payout-wallet, Selfie Check) and level 2 (upgrade-level-2, World ID Orb /
// Proof of Human). Props are intentionally minimal: give it a wallet and a level, get
// back one onComplete call.
import { useCallback, useRef, useState } from 'react';
import { IDKit, CredentialRequest, any, selfieCheck, isInWorldApp } from '@worldcoin/idkit-core';
import type { WorldLevel } from '@/lib/world/schema';
import type { WorldRequestContext } from '@/lib/world/signing';

export type { WorldLevel };

export type WorldVerifyStatus = 'idle' | 'requesting' | 'connecting' | 'verifying' | 'done';

export type WorldVerifyOutcome =
  | { status: 'success'; call: 'bind' | 'upgrade'; level: 1 | 2; txHash: `0x${string}` }
  | { status: 'error'; code: string; message: string };

export interface WorldVerifyProps {
  /** Used as the IDKit signal and forwarded to /api/world/verify. */
  wallet: `0x${string}`;
  /** level1 = Selfie Check (initial bind). level2 = World ID Orb / Proof of Human (upgrade). */
  level: WorldLevel;
  /** Called exactly once per run, with the final success or error. */
  onComplete: (outcome: WorldVerifyOutcome) => void;
  /** Optional live status for callers building their own progress UI. */
  onStatusChange?: (status: WorldVerifyStatus) => void;
  label?: string;
  disabled?: boolean;
}

const FAILURE_MESSAGES: Record<string, string> = {
  user_rejected: 'Verification was cancelled in World App.',
  verification_rejected: 'Verification was cancelled in World App.',
  cancelled: 'Verification was cancelled.',
  timeout: 'Verification timed out. Please try again.',
};

async function reportClientError(level: WorldLevel, wallet: string, code: string) {
  try {
    await fetch('/api/world/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level, wallet, clientError: code }),
    });
  } catch {
    // best-effort logging only; the user-facing outcome doesn't depend on this succeeding.
  }
}

export function WorldVerify({ wallet, level, onComplete, onStatusChange, label, disabled }: WorldVerifyProps) {
  const [status, setStatus] = useState<WorldVerifyStatus>('idle');
  const [connectorURI, setConnectorURI] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const setStatusAndNotify = useCallback(
    (next: WorldVerifyStatus) => {
      setStatus(next);
      onStatusChange?.(next);
    },
    [onStatusChange],
  );

  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setError(null);
    setConnectorURI(null);
    setStatusAndNotify('requesting');

    try {
      const contextRes = await fetch('/api/world/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level }),
      });
      if (!contextRes.ok) throw new Error('request_context_failed');
      const context = (await contextRes.json()) as WorldRequestContext;

      setStatusAndNotify('connecting');
      const request =
        // The World ID Simulator (staging) has no Selfie Check credential, so level 1 asks for its Human (Orb) one.
        level === 'level1' && context.environment === 'production'
          ? await IDKit.request({ ...context, allow_legacy_proofs: false }).preset(selfieCheck({ signal: wallet }))
          : level === 'level1'
          ? await IDKit.request({ ...context, allow_legacy_proofs: false }).constraints(any(CredentialRequest('proof_of_human', { signal: wallet })))
          : await IDKit.request({ ...context, allow_legacy_proofs: false }).constraints(
              any(CredentialRequest('proof_of_human', { signal: wallet })),
            );

      // Inside World App the SDK uses native postMessage and needs no link. Outside it (a normal
      // browser, or the system browser #15 opens via liff.openWindow), show the connect link so a
      // caller can render it or turn it into a QR code for cross-device scanning.
      if (!isInWorldApp()) {
        setConnectorURI(request.connectorURI);
      }

      setStatusAndNotify('verifying');
      const completion = await request.pollUntilCompletion({ timeout: 300_000 });

      if (!completion.success) {
        await reportClientError(level, wallet, completion.error);
        const message = FAILURE_MESSAGES[completion.error] ?? 'World ID verification failed. Please try again.';
        setStatusAndNotify('done');
        setError(message);
        onComplete({ status: 'error', code: completion.error, message });
        return;
      }

      const verifyRes = await fetch('/api/world/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level, wallet, result: completion.result }),
      });
      const payload = (await verifyRes.json().catch(() => ({}))) as Record<string, unknown>;
      setStatusAndNotify('done');

      if (!verifyRes.ok) {
        const message = typeof payload.message === 'string' ? payload.message : 'World ID verification failed.';
        setError(message);
        onComplete({ status: 'error', code: typeof payload.error === 'string' ? payload.error : 'verify_failed', message });
        return;
      }

      onComplete({
        status: 'success',
        call: payload.call as 'bind' | 'upgrade',
        level: payload.level as 1 | 2,
        txHash: payload.txHash as `0x${string}`,
      });
    } catch {
      setStatusAndNotify('done');
      const message = 'Could not complete World ID verification. Please try again.';
      setError(message);
      onComplete({ status: 'error', code: 'internal_error', message });
    } finally {
      running.current = false;
    }
  }, [level, wallet, onComplete, setStatusAndNotify]);

  const busy = status === 'requesting' || status === 'connecting' || status === 'verifying';

  return (
    <div>
      <button type="button" onClick={start} disabled={disabled || busy}>
        {label ?? (level === 'level1' ? 'Verify with World ID' : 'Upgrade to level 2')}
      </button>
      {connectorURI && status === 'verifying' && (
        <p>
          Open in World App:{' '}
          <a href={connectorURI} target="_blank" rel="noreferrer">
            {connectorURI}
          </a>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
