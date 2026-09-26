import { useState } from 'react';

/** Local interaction to verify the React island boundary without a live provider. */
export default function WalletPreview() {
  const [connected, setConnected] = useState(false);
  return <section className="stack" aria-label="Mock wallet">
    <div><h2>Wallet preview</h2><p>This fixture never opens your wallet.</p></div>
    <p role="status">{connected ? 'Demo wallet connected · 0x0000…0001' : 'No demo wallet connected'}</p>
    <button className="rd-ui-button rd-ui-button--secondary" type="button" onClick={() => setConnected(!connected)}>{connected ? 'Disconnect demo wallet' : 'Connect demo wallet'}</button>
  </section>;
}
