// Holder screen (issue #19): list slot requests from the LIFF app, issue/revoke this season's slot on ENSv2.
import { HolderScreen } from '@/components/holder/holder-screen';
import { asAddress } from '@/lib/contracts';
import { publicEnv } from '@/lib/env';

export const metadata = { title: 'Holder · Real Deal' };

export default function HolderPage() {
  return (
    <HolderScreen
      ensAddresses={{
        parentRegistry: asAddress(publicEnv.ensParentRegistry()),
        plotResolver: asAddress(publicEnv.ensPlotResolver()),
        slotRegistry: asAddress(publicEnv.ensSlotRegistry()),
      }}
    />
  );
}
