'use client';

import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import styles from './ui.module.css';
import { shortAddress } from '@/lib/format';

export function WalletConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  if (!isConnected) {
    const injected = connectors[0];
    return (
      <button
        type="button"
        className={`${styles.buttonPrimary} ${styles.buttonSmall}`}
        disabled={!injected || isPending}
        onClick={() => injected && connect({ connector: injected })}
      >
        {isPending ? 'Connecting…' : 'Connect wallet'}
      </button>
    );
  }

  if (chainId !== sepolia.id) {
    return (
      <button
        type="button"
        className={`${styles.buttonDanger} ${styles.buttonSmall}`}
        disabled={isSwitching}
        onClick={() => switchChain({ chainId: sepolia.id })}
      >
        {isSwitching ? 'Switching…' : 'Wrong network — switch to Sepolia'}
      </button>
    );
  }

  return (
    <div className={styles.walletPill}>
      <span className={styles.walletDot} aria-hidden />
      <span>{shortAddress(address ?? '')}</span>
      <button type="button" className={`${styles.buttonGhost} ${styles.buttonSmall}`} onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  );
}
