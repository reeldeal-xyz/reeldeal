// Client-side EIP-3009 signing for the LIFF "Send JPYC" flow (gasless): the farmer's on-device key signs a
// `transferWithAuthorization` payload here, and POST /api/liff/wallet/relay-transfer (lib/liff/wallet-relay.ts)
// relays it on-chain with the keeper's own relayer key -- the farmer's zero-ETH wallet never needs gas. Kept
// framework/DOM-free (aside from Web Crypto) so it's usable from both the LIFF component and its tests.
import type { Address, Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { CHAIN_ID, JPYC, JPYC_EIP712_DOMAIN } from '@repo/shared';

/** Must match lib/liff/wallet-relay.ts's copy exactly -- both sides hash the same typed data. */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/** How long a client-signed authorization stays valid for (server enforces the same ceiling -- see
 *  MAX_VALID_WINDOW_SECONDS in wallet-relay.ts). Long enough for the relay round trip on a slow LINE in-app
 *  browser connection; short enough that a leaked signed payload can't be replayed indefinitely. */
export const TRANSFER_AUTHORIZATION_WINDOW_SECONDS = 10 * 60;

export interface SignedTransferAuthorization {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
  signature: Hex;
}

/** Exported so a wallet-session sender (components/liff/wallet-panel.tsx, signing via wagmi instead of a
 *  local PrivateKeyAccount) can build the same message shape without duplicating this. */
export function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = '0x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out as Hex;
}

/** Signs a gasless JPYC send from `account` to `to` for `value` (18-decimal wei). Never touches the network --
 *  this is a pure local signature; the caller POSTs the result to the relay route. */
export async function signTransferAuthorization(
  account: PrivateKeyAccount,
  to: Address,
  value: bigint,
): Promise<SignedTransferAuthorization> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const validAfter = 0n;
  const validBefore = BigInt(nowSeconds + TRANSFER_AUTHORIZATION_WINDOW_SECONDS);
  const nonce = randomNonce();

  const signature = await account.signTypedData({
    domain: { ...JPYC_EIP712_DOMAIN, chainId: CHAIN_ID, verifyingContract: JPYC },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: { from: account.address, to, value, validAfter, validBefore, nonce },
  });

  return { from: account.address, to, value, validAfter, validBefore, nonce, signature };
}
