// Donor screen (issue #21): approve + donate JPYC, ledger from ReliefPool events.
import { DonateScreen } from '@/components/donate/donate-screen';
import { asAddress } from '@/lib/contracts';
import { publicEnv } from '@/lib/env';

export const metadata = { title: 'Donate · Reel Deal' };

export default function DonatePage() {
  const deployBlockRaw = publicEnv.reliefPoolDeployBlock();
  const deployBlock = deployBlockRaw ? BigInt(deployBlockRaw) : 0n;

  return <DonateScreen reliefPool={asAddress(publicEnv.reliefPool())} reliefPoolDeployBlock={deployBlock} />;
}
