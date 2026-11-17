'use client';

import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const alreadyDismissed = localStorage.getItem('hct_pwa_dismissed') === '1';
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    if (alreadyDismissed || isStandalone) {
      setDismissed(true);
      return;
    }

    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
    if (isIos) {
      setShowIosGuide(true);
      setDismissed(false);
    }

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setDismissed(false);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  if (dismissed || (!deferredPrompt && !showIosGuide)) return null;

  function handleDismiss() {
    localStorage.setItem('hct_pwa_dismissed', '1');
    setDismissed(true);
  }

  async function handleInstallClick() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setDismissed(true);
    }
    setDeferredPrompt(null);
  }

  return (
    <div className="mx-4 mt-3 rounded-2xl bg-[#ECFDF5] dark:bg-[#064E3B] border border-[#A7F3D0] dark:border-[#047857] p-3 flex items-center justify-between gap-2.5">
      <div className="min-w-0">
        <p className="text-xs font-bold text-[#065F46] dark:text-[#A7F3D0]">
          Cài trackingwork thành ứng dụng
        </p>
        {deferredPrompt ? (
          <p className="text-[11px] text-[#047857] dark:text-[#6EE7B7] mt-0.5">
            Mở toàn màn hình không thanh trình duyệt & nhận nhắc việc.
          </p>
        ) : (
          <p className="text-[11px] text-[#047857] dark:text-[#6EE7B7] mt-0.5 flex items-center gap-1 flex-wrap">
            Nhấn <Share className="w-3.5 h-3.5 inline" /> <strong>Chia sẻ</strong> →{' '}
            <strong>Thêm vào MH chính</strong>.
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {deferredPrompt && (
          <button
            type="button"
            onClick={handleInstallClick}
            className="h-9 px-3 rounded-xl bg-[#059669] text-white text-xs font-semibold inline-flex items-center gap-1"
          >
            <Download className="w-3.5 h-3.5" />
            Cài đặt
          </button>
        )}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Đóng hướng dẫn cài đặt"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#047857] dark:text-[#A7F3D0]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
