// Co-op screen (issue #20): holder vs. current slot owner for all 15 plots, science-key record edits, QR
// print, CSV export.
import { CoopScreen } from '@/components/coop/coop-screen';
import { asAddress } from '@/lib/contracts';
import { publicEnv } from '@/lib/env';

export const metadata = { title: 'Co-op · UMI' };

export default function CoopPage() {
  const deployBlockRaw = publicEnv.reliefPoolDeployBlock();
  const deployBlock = deployBlockRaw ? BigInt(deployBlockRaw) : 0n;

  return (
    <CoopScreen
      ensAddresses={{
        parentRegistry: asAddress(publicEnv.ensParentRegistry()),
        plotResolver: asAddress(publicEnv.ensPlotResolver()),
        slotRegistry: asAddress(publicEnv.ensSlotRegistry()),
      }}
      reliefPool={asAddress(publicEnv.reliefPool())}
      humanRegistry={asAddress(publicEnv.humanRegistry())}
      reliefPoolDeployBlock={deployBlock}
    />
  );
}
