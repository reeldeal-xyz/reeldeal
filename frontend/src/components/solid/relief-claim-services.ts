import { createPublicClient, http, type Address, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { DEPLOYED, ReliefPoolAbi } from '@repo/shared';
import { confirmTransaction, connectWallet } from '../../lib/chain/wallet.client';

export type ReliefClaimStep = 'connecting' | 'submitting' | 'confirming' | 'verifying';

export interface ReliefClaimInput {
  eventId: Hex;
  plotLabel: string;
  season: string;
  farmer: Address;
}

export interface ReliefClaimResult {
  address: Address;
  txHash: Hex;
  blockNumber: string;
  confirmations: number;
  settlementState: string | null;
}

export async function claimHeld(
  input: ReliefClaimInput,
  onStep?: (step: ReliefClaimStep) => void,
): Promise<ReliefClaimResult> {
  onStep?.('connecting');
  const { client, address } = await connectWallet();
  if (address.toLowerCase() !== input.farmer.toLowerCase()) {
    throw new Error('Connect the registered farmer wallet for this 2026 plot before claiming.');
  }

  onStep?.('submitting');
  const txHash = await client.writeContract({
    account: address,
    chain: sepolia,
    address: DEPLOYED.ReliefPool,
    abi: ReliefPoolAbi,
    functionName: 'claimHeld',
    args: [input.eventId, input.plotLabel],
  });

  const reader = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com') });
  onStep?.('confirming');
  const receipt = await confirmTransaction(reader, txHash, 'The claim transaction reverted on Sepolia.');

  onStep?.('verifying');
  const response = await fetch(`/api/relief/plot/${encodeURIComponent(input.plotLabel)}?season=${encodeURIComponent(input.season)}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Claim confirmed, but the updated ReliefPool state could not be read.');
  const story = await response.json() as { settlement?: { state?: string } | null };
  const settlementState = story.settlement?.state ?? null;
  if (settlementState !== 'claimed' && settlementState !== 'paid') {
    throw new Error(`Claim transaction confirmed, but ReliefPool still reports ${settlementState ?? 'no settlement'}.`);
  }

  return {
    address,
    txHash,
    blockNumber: receipt.blockNumber,
    confirmations: receipt.confirmations,
    settlementState,
  };
}
