// Forwards an IDKit result to the World v4 verify endpoint, unmodified, per the world-id skill:
// "forward the exact IDKit result unchanged" -- no field remapping, no re-encoding.
export type WorldFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class WorldVerifyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown,
  ) {
    super(message);
    this.name = 'WorldVerifyError';
  }
}

/**
 * POSTs `result` byte-for-byte (via JSON.stringify of the exact object IDKit returned) to
 * `https://developer.world.org/api/v4/verify/{rp_id}`. Throws WorldVerifyError on any rejection.
 */
export async function callWorldVerify(rpId: string, result: unknown, fetchImpl: WorldFetch = fetch): Promise<unknown> {
  const endpoint = `https://developer.world.org/api/v4/verify/${rpId}`;
  let response: Response;
  try {
    // Staging/sandbox (World ID Simulator) proofs must carry the portal's staging verification token.
    const env = (result as { environment?: string } | null)?.environment;
    const stagingToken = process.env.WORLD_STAGING_VERIFICATION_TOKEN;
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(stagingToken && env && env !== 'production' ? { 'x-staging-verification-token': stagingToken } : {}),
      },
      body: JSON.stringify(result),
    });
  } catch (err) {
    throw new WorldVerifyError('world_verify_unreachable', 0, err);
  }

  const text = await response.text();
  let payload: unknown;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new WorldVerifyError('world_verify_failed', response.status, payload);
  }

  // The v4 contract is: HTTP 2xx is a verified proof. Still reject an explicit failure body,
  // in case an upstream error path incorrectly returns 2xx.
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const p = payload as Record<string, unknown>;
    if (p.success === false || p.verified === false || p.error || p.code) {
      throw new WorldVerifyError('world_verify_rejected', response.status, payload);
    }
  }

  return payload;
}
