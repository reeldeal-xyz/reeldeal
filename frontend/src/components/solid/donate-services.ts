// Client-side donate flow: connect wallet -> switch to Sepolia -> JPYC.approve(ReliefPool, amount) ->
// ReliefPool.donate(amount, memo). Broadcasts real Sepolia transactions from the connected wallet; never
// called from server code.
import { erc20Abi } from 'viem';
import { sepolia } from 'viem/chains';
import { DEPLOYED, JPYC, ReliefPoolAbi } from '@repo/shared';
import { connectWallet } from '../../lib/chain/wallet.client';

export interface DonateResult {
  address: string;
  approveTxHash: string;
  donateTxHash: string;
}

export type DonateStep = 'connecting' | 'approving' | 'donating';

/** `amountBaseUnits` is JPYC base units (18 decimals) -- see packages/shared/src/addresses.ts JPYC_DECIMALS. */
export async function donate(
  amountBaseUnits: bigint,
  memo: string,
  onStep?: (step: DonateStep) => void,
): Promise<DonateResult> {
  onStep?.('connecting');
  const { client, address } = await connectWallet();

  onStep?.('approving');
  const approveTxHash = await client.writeContract({
    account: address,
    chain: sepolia,
    address: JPYC,
    abi: erc20Abi,
    functionName: 'approve',
    args: [DEPLOYED.ReliefPool, amountBaseUnits],
  });

  onStep?.('donating');
  const donateTxHash = await client.writeContract({
    account: address,
    chain: sepolia,
    address: DEPLOYED.ReliefPool,
    abi: ReliefPoolAbi,
    functionName: 'donate',
    args: [amountBaseUnits, memo],
  });

  return { address, approveTxHash, donateTxHash };
}
