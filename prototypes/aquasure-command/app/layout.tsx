import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://aquasure-risk-command.c2qrk2n8nk.chatgpt.site'),
  title: 'AquaSure Command — Aquaculture Risk Intelligence',
  description: 'Bilingual early-warning and parametric insurance dashboard for aquaculture operators.',
  openGraph: {
    title: 'AquaSure Command',
    description: 'Aquaculture risk intelligence / 養殖リスクインテリジェンス',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AquaSure Command',
    description: 'Aquaculture risk intelligence / 養殖リスクインテリジェンス',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
