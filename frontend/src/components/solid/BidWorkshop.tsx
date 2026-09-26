/** @jsxImportSource solid-js */
import BidPanel from './BidPanel';
import type { BidServices } from './bid-services';
export type Scenario = 'ready' | 'cancelled' | 'timeout' | 'closed' | 'unavailable' | 'pending';

/** No fetch, injected provider, RPC, or messaging client is reachable here. */
export function mockBidServices(scenario: Scenario): BidServices {
  let signAttempts = 0;
  let submitAttempts = 0;
  return {
    async load() {
      if (scenario === 'unavailable') throw new Error('The market is unavailable. Try again shortly.');
      return { id: 'fixture-listing', status: scenario === 'closed' ? 'closed' : 'open', priceJpy: 2400 };
    },
    async connect() { return '0x0000000000000000000000000000000000000001'; },
    async sign(offer) {
      if (scenario === 'cancelled' && signAttempts++ === 0) throw new Error('Cancelled in your wallet. Your offer is still here.');
      return { ...offer, signature: 'fixture-signature' };
    },
    async submit(offer) {
      if (scenario === 'pending') return new Promise(() => {});
      if (scenario === 'timeout' && submitAttempts++ === 0) throw new Error('Could not confirm this offer. Retry sending the same signature.');
      return { id: 'fixture-receipt', amountJpy: offer.amountJpy, bidder: offer.bidder };
    },
  };
}

export default function BidWorkshop(props: { scenario?: Scenario }) {
  // JSX expressions become prop getters in Solid. Keep one adapter per mounted
  // story so retry counters survive reads of props.services in BidPanel.
  const services = mockBidServices(props.scenario ?? 'ready');
  return <BidPanel lotId="fixture-lot" services={services} initiallyOpen />;
}
