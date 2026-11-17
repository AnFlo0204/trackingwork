import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Việc Nhà — Quản Lý & Xác Thực Ảnh',
  description: 'Ứng dụng theo dõi việc nhà dành cho gia đình & nhóm ở ghép, xác thực camera thời gian thực.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Việc Nhà',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="font-sans antialiased bg-[#E5E7EB] dark:bg-[#090D16] text-[#111827] dark:text-[#F8FAFC] min-h-screen">
        {children}
      </body>
    </html>
  );
}
