'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Renders a plot's LIFF deep link as a QR code (issue #20: "print plot QR codes"). Generated client-side via
 *  the browser canvas API, so this only ever runs in the browser (component is 'use client'). */
export function PlotQrCode({ url, size = 88 }: { url: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: size, margin: 1, color: { dark: '#15110f', light: '#ffffff' } })
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  if (!src) return <div style={{ width: size, height: size, background: 'var(--ops-surface-raised)', borderRadius: 6 }} aria-hidden />;

  // eslint-disable-next-line @next/next/no-img-element -- generated data: URL, not an optimizable asset
  return <img src={src} width={size} height={size} alt={`QR code linking to the LIFF app for ${url}`} style={{ borderRadius: 6 }} />;
}
