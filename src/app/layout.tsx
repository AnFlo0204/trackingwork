import type { Metadata, Viewport } from 'next';
import { SecurityShield } from '@/components/SecurityShield';
import './globals.css';

export const metadata: Metadata = {
  title: 'Việc Nhà — trackingwork',
  description: 'Ứng dụng theo dõi việc nhà dành cho gia đình & nhóm ở ghép, xác thực camera thời gian thực.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'trackingwork',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#059669',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="font-sans antialiased bg-[#E5E7EB] dark:bg-[#090D16] text-[#111827] dark:text-[#F8FAFC] min-h-screen">
        <SecurityShield>{children}</SecurityShield>
      </body>
    </html>
  );
}
