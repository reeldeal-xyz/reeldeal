// Framework-agnostic core of POST /api/liff/claim (issue #15): pays a Held-until-verified farmer once
// they've since bound a World ID, by calling `claimHeld` with the keeper's own relayer key.
//
// This is safe to relay on the farmer's behalf: `claimHeld(eventId, plotLabel)` resolves the payout target
// on-chain via `slotResolver`/`payoutTarget` and pays *that* address -- never `msg.sender` -- so the
// farmer's zero-ETH in-app wallet never needs gas, and a relayer can't redirect the payout to itself. See
// ReliefPool.sol `claimHeld` -> `_checkEligibility` -> `_pay` (transfers to `farmer`, not `msg.sender`).
//
// Kept separate from route.ts (like lib/world/verify-handler.ts) so it can be unit tested with mocked viem
// clients and never touch a real network.
import { BaseError, ContractFunctionRevertedError, isHex, type Account, type Address, type Hex } from 'viem';
import { ReliefPoolAbi } from '@repo/shared';
import { env } from '@/lib/env';
import { getKeeperChainClients, type KeeperPublicClient, type KeeperWalletClient } from '@/lib/keeper/chain-clients';

export interface ClaimRequestBody {
  eventId: Hex;
  plotLabel: string;
}

function parseBody(raw: unknown): ClaimRequestBody | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const b = raw as Record<string, unknown>;
  const eventId = b.eventId;
  const plotLabel = b.plotLabel;
  if (typeof eventId !== 'string' || !isHex(eventId) || eventId.length !== 66) return null;
  if (typeof plotLabel !== 'string' || plotLabel.length === 0) return null;
  return { eventId: eventId as Hex, plotLabel };
}

/** User-facing message per contract revert (ReliefPool.sol's claimHeld/_checkEligibility errors). */
const CONTRACT_ERROR_MESSAGES: Record<string, string> = {
  NotHeld: 'This plot is not currently held for verification.',
  ClaimWindowElapsed: 'The claim window for this event has closed. Please contact the co-op.',
  UnknownEvent: 'Unknown relief event.',
  StillIneligible: 'Still not eligible to claim -- check your World ID verification level and try again.',
};

export interface HandleClaimDeps {
  getChainClients: () => {
    publicClient: Pick<KeeperPublicClient, 'simulateContract' | 'waitForTransactionReceipt'>;
    walletClient: KeeperWalletClient;
    account: Account;
  };
  poolAddress: Address | undefined;
}

export function defaultClaimDeps(): HandleClaimDeps {
  return {
    getChainClients: getKeeperChainClients,
    poolAddress: (env.reliefPoolAddress() as Address | undefined) ?? undefined,
  };
}

export interface ClaimResponse {
  status: number;
  body: Record<string, unknown>;
}

export async function handleClaim(raw: unknown, deps: HandleClaimDeps = defaultClaimDeps()): Promise<ClaimResponse> {
  const parsed = parseBody(raw);
  if (!parsed) {
    return { status: 400, body: { error: 'invalid_request' } };
  }

  if (!deps.poolAddress) {
    return { status: 503, body: { error: 'not_deployed', message: 'ReliefPool is not deployed yet.' } };
  }

  const { publicClient, walletClient, account } = deps.getChainClients();

  try {
    const { request } = await publicClient.simulateContract({
      address: deps.poolAddress,
      abi: ReliefPoolAbi,
      functionName: 'claimHeld',
      args: [parsed.eventId, parsed.plotLabel],
      account,
    });
    const txHash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return { status: 200, body: { ok: true, txHash } };
  } catch (err) {
    if (err instanceof BaseError) {
      const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (revert instanceof ContractFunctionRevertedError) {
        const name = revert.data?.errorName;
        const message = name ? CONTRACT_ERROR_MESSAGES[name] : undefined;
        return { status: 409, body: { error: name ?? 'claim_reverted', message: message ?? 'Could not claim this payout.' } };
      }
    }
    console.error('[liff/claim] claimHeld failed', err);
    return { status: 502, body: { error: 'claim_failed', message: 'Could not claim this payout. Please try again.' } };
  }
}
