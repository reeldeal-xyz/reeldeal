// Reads the on-chain Trigger for one eventId, for /verify/[eventId] (#24). ReliefPool only stores the
// pro-rata Attestation (attestations(eventId)), not the Trigger struct itself — dataHash/firedAt live in
// the `Attested` event log — so this scans logs rather than calling a getter. Server-only: needs
// RELIEF_POOL (env.reliefPoolAddress()) and SEPOLIA_RPC_URL.
import { ReliefPoolAbi } from '@repo/shared';
import { createPublicClient, http, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { env } from './env';
import { sepoliaTransport } from '@/lib/rpc';

export interface OnChainTrigger {
  dataHash: Hex;
  firedAt: bigint;
  index: number;
  threshold: number;
  txHash: Hex;
  blockNumber: bigint;
}

export type OnChainResult =
  | { deployed: false }
  | { deployed: true; found: false; error?: string }
  | { deployed: true; found: true; data: OnChainTrigger };

export async function readOnChainTrigger(eventId: Hex): Promise<OnChainResult> {
  const address = env.reliefPoolAddress();
  if (!address) return { deployed: false };

  try {
    const client = createPublicClient({ chain: sepolia, transport: sepoliaTransport() });
    const logs = await client.getContractEvents({
      address: address as Hex,
      abi: ReliefPoolAbi,
      eventName: 'Attested',
      args: { eventId },
      fromBlock: 'earliest',
      toBlock: 'latest',
    });
    const log = logs[0];
    if (!log || !('args' in log) || !log.args.t) return { deployed: true, found: false };

    const t = log.args.t;
    return {
      deployed: true,
      found: true,
      data: {
        dataHash: t.dataHash,
        firedAt: t.firedAt,
        index: t.index,
        threshold: t.threshold,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      },
    };
  } catch (err) {
    return { deployed: true, found: false, error: err instanceof Error ? err.message : 'RPC error' };
  }
}
