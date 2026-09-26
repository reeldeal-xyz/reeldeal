// Fish market (issue #65 / SP-11): JPYC seafood checkout through SaleRouter, 5% of each sale to ReliefPool.
import { MarketScreen } from '@/components/market/market-screen';
import { asAddress } from '@/lib/contracts';
import { publicEnv } from '@/lib/env';

export const metadata = { title: 'Fish market · Reel Deal' };

export default function MarketPage() {
  const deployBlockRaw = publicEnv.reliefPoolDeployBlock();
  const deployBlock = deployBlockRaw ? BigInt(deployBlockRaw) : 0n;

  return <MarketScreen reliefPool={asAddress(publicEnv.reliefPool())} reliefPoolDeployBlock={deployBlock} />;
}
