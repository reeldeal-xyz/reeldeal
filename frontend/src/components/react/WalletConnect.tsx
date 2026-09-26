import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAppKit } from '@reown/appkit/react';
import { useState, useId } from 'react';
import { WagmiProvider, useAccount, useConnect, useDisconnect } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { getOrCreateWalletConfig } from '../../lib/chain/appkit.client';
import { shortAddress } from '../../lib/chain/wallet.client';

interface Props { projectId?: string; preview?: boolean }

function WalletButton({ connect, preview = false }: { connect: () => Promise<unknown>; preview?: boolean }) {
  const { address, chainId, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const panelId = useId();

  async function handleClick() {
    if (isConnected) { setExpanded((open) => !open); return; }
    if (preview) { setError('Open the app to connect a wallet.'); return; }
    setError(''); setBusy(true);
    try { await connect(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Wallet connection failed.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="wallet-connect">
      <button type="button" className="wallet-connect__button" disabled={busy} onClick={handleClick}
        aria-expanded={isConnected ? expanded : undefined} aria-controls={isConnected ? panelId : undefined}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M6 6V4h12v2m-1 7h4m-5 0h.1"/></svg>
        <span>{busy ? 'Connecting…' : isConnected && address ? shortAddress(address) : 'Connect wallet'}</span>
      </button>
      {isConnected && expanded && address && <div className="wallet-connect__panel" id={panelId}>
        <strong>Wallet connected</strong>
        <span className="wallet-connect__address">{address}</span>
        <span>{chainId === sepolia.id ? 'Connected to Sepolia' : 'Connected on another network'}</span>
        <button type="button" onClick={() => { disconnect(); setExpanded(false); }}>Disconnect</button>
      </div>}
      {error && <p className="wallet-connect__error" role="alert">{error}</p>}
    </div>
  );
}

function ReownWalletButton(props: { preview?: boolean }) {
  const { open } = useAppKit();
  return <WalletButton preview={props.preview} connect={() => open({ view: 'Connect' })} />;
}

function InjectedWalletButton(props: { preview?: boolean }) {
  const { connectAsync, connectors } = useConnect();
  return <WalletButton preview={props.preview} connect={async () => {
    const connector = connectors.find((item) => item.type === 'injected') ?? connectors[0];
    if (!connector || typeof window.ethereum === 'undefined') {
      throw new Error('No browser wallet found. Install MetaMask or use a wallet-enabled browser.');
    }
    await connectAsync({ connector, chainId: sepolia.id });
  }} />;
}

export default function WalletConnect({ projectId, preview }: Props) {
  const [config] = useState(() => getOrCreateWalletConfig(projectId, window.location.origin));
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } }));
  return <WagmiProvider config={config} reconnectOnMount>
    <QueryClientProvider client={queryClient}>
      {projectId ? <ReownWalletButton preview={preview} /> : <InjectedWalletButton preview={preview} />}
    </QueryClientProvider>
  </WagmiProvider>;
}
