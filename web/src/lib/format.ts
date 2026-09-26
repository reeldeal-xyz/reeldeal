// Shared display formatting for the holder/co-op/donate screens.
import { formatUnits, parseUnits } from 'viem';
import { JPYC_DECIMALS } from '@repo/shared';

const yen = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** JPYC has 18 decimals — ¥20,000 = 20000e18. Never assume 6 (see CLAUDE.md). */
export const formatJpyc = (amount: bigint): string => `¥${yen.format(Number(formatUnits(amount, JPYC_DECIMALS)))}`;

/** Parses a plain yen amount typed by a donor (e.g. "20000") into JPYC base units. Throws on invalid input. */
export const parseJpyc = (yenAmount: string): bigint => parseUnits(yenAmount.trim(), JPYC_DECIMALS);

export const shortAddress = (address: string, chars = 4): string =>
  address.length <= 2 + chars * 2 ? address : `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;

export const shortHex = shortAddress;

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export const formatTimestamp = (unixSeconds: bigint | number): string =>
  dateTimeFormatter.format(new Date(Number(unixSeconds) * 1000));

/** Decodes a bytes32 ASCII hold reason (e.g. REASON_NO_FARMER) back to its short string. */
export const decodeReason = (reasonHex: `0x${string}`): string => {
  const bytes = reasonHex.slice(2);
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    const byte = parseInt(bytes.slice(i, i + 2), 16);
    if (byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out || reasonHex;
};
