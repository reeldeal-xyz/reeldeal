// Client-side donate flow: connect wallet -> switch to Sepolia -> JPYC.approve(ReliefPool, amount) ->
// ReliefPool.donate(amount, memo). Broadcasts real Sepolia transactions from the connected wallet; never
// called from server code.
import { createPublicClient, erc20Abi, http } from 'viem';
import { sepolia } from 'viem/chains';
import { DEPLOYED, JPYC, ReliefPoolAbi } from '@repo/shared';
import { confirmTransaction, connectWallet } from '../../lib/chain/wallet.client';

export interface DonateResult {
  address: string;
  approveTxHash: string;
  approveBlockNumber: string;
  donateTxHash: string;
  donateBlockNumber: string;
  confirmations: number;
}

export type DonateStep = 'connecting' | 'approving' | 'waiting-approval' | 'donating' | 'waiting-donation';

/** `amountBaseUnits` is JPYC base units (18 decimals) -- see packages/shared/src/addresses.ts JPYC_DECIMALS. */
export async function donate(
  amountBaseUnits: bigint,
  memo: string,
  onStep?: (step: DonateStep) => void,
): Promise<DonateResult> {
  onStep?.('connecting');
  const { client, address } = await connectWallet();

  const reader = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com') });

  onStep?.('approving');
  const approveTxHash = await client.writeContract({
    account: address,
    chain: sepolia,
    address: JPYC,
    abi: erc20Abi,
    functionName: 'approve',
    args: [DEPLOYED.ReliefPool, amountBaseUnits],
  });
  onStep?.('waiting-approval');
  const approval = await confirmTransaction(reader, approveTxHash, 'JPYC approval reverted on Sepolia. Donation was not submitted.');

  onStep?.('donating');
  const donateTxHash = await client.writeContract({
    account: address,
    chain: sepolia,
    address: DEPLOYED.ReliefPool,
    abi: ReliefPoolAbi,
    functionName: 'donate',
    args: [amountBaseUnits, memo],
  });
  onStep?.('waiting-donation');
  const donation = await confirmTransaction(reader, donateTxHash, 'Donation reverted on Sepolia. No donation was confirmed.');

  return {
    address,
    approveTxHash,
    approveBlockNumber: approval.blockNumber,
    donateTxHash,
    donateBlockNumber: donation.blockNumber,
    confirmations: donation.confirmations,
  };
}
