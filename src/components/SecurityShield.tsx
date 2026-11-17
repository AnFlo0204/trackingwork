'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import {
  isAuthorizedRuntimeOrigin,
  SECURITY_POLICY,
  triggerDomSelfDestruct,
} from '@/lib/securityClient';
import { useAntiTamper } from '@/lib/useAntiTamper';

interface SecurityGuardValue {
  tamperDetected: boolean;
  clonedBlocked: boolean;
}

const SecurityGuardContext = createContext<SecurityGuardValue>({
  tamperDetected: false,
  clonedBlocked: false,
});

export function useSecurityGuard(): SecurityGuardValue {
  return useContext(SecurityGuardContext);
}

export function SecurityShield({ children }: { children: ReactNode }) {
  const [clonedBlocked, setClonedBlocked] = useState(false);
  const { tamperDetected, triggerTamperSignal, recheckNow } = useAntiTamper();

  useEffect(() => {
    if (!isAuthorizedRuntimeOrigin()) {
      setClonedBlocked(true);
      triggerDomSelfDestruct();
      return;
    }

    function isEditableTarget(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    function handleContextMenu(e: MouseEvent) {
      if (!isEditableTarget(e.target)) {
        e.preventDefault();
      }
    }

    function handleDragStart(e: DragEvent) {
      e.preventDefault();
    }

    function handleCopyOrCut(e: ClipboardEvent) {
      if (!isEditableTarget(e.target)) {
        e.preventDefault();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      const key = (e.key || '').toLowerCase();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      // Block Save Page (Ctrl+S / Cmd+S) & View Source (Ctrl+U / Cmd+U / Cmd+Option+U)
      if (ctrlOrMeta && (key === 's' || key === 'u')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Block Print (Ctrl+P / Cmd+P)
      if (ctrlOrMeta && key === 'p') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Block PrintScreen
      if (e.key === 'PrintScreen' || key === 'printscreen') {
        e.preventDefault();
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText('').catch(() => undefined);
        }
        return;
      }

      // Block DevTools shortcuts
      const isF12 = e.key === 'F12';
      const isWinDevTools = e.ctrlKey && e.shiftKey && ['i', 'j', 'c', 'k'].includes(key);
      const isMacDevTools = e.metaKey && e.altKey && ['i', 'j', 'c', 'u'].includes(key);
      if (isF12 || isWinDevTools || isMacDevTools) {
        e.preventDefault();
        e.stopPropagation();
        if (!SECURITY_POLICY.isDev) {
          triggerTamperSignal(`shortcut:${key}`);
        }
      }
    }

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('copy', handleCopyOrCut);
    document.addEventListener('cut', handleCopyOrCut);
    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('dragstart', handleDragStart);
      document.removeEventListener('copy', handleCopyOrCut);
      document.removeEventListener('cut', handleCopyOrCut);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [triggerTamperSignal]);

  if (clonedBlocked) {
    return null;
  }

  return (
    <SecurityGuardContext.Provider value={{ tamperDetected, clonedBlocked }}>
      <div className={tamperDetected ? 'blur-md pointer-events-none select-none overflow-hidden' : ''}>
        {children}
      </div>

      {tamperDetected && (
        <div
          role="alertdialog"
          aria-modal="true"
          className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-5"
        >
          <div className="max-w-md w-full rounded-2xl bg-white dark:bg-[#1E293B] border border-[#EF4444]/40 p-6 text-center shadow-2xl space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-[#FEF2F2] dark:bg-[#450A0A] text-[#DC2626] mx-auto flex items-center justify-center">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <h2 className="text-base font-bold text-[#111827] dark:text-[#F8FAFC]">
              Cảnh báo bảo mật hệ thống
            </h2>
            <p className="text-sm text-[#4B5563] dark:text-[#CBD5E1] leading-relaxed">
              Phát hiện công cụ can thiệp hệ thống. Vui lòng đóng DevTools để tiếp tục.
            </p>
            <p className="text-xs text-[#6B7280] dark:text-[#94A3B8]">
              Hệ thống đã tạm khóa thao tác chụp ảnh &amp; gửi dữ liệu, đồng thời ghi nhận sự kiện vào nhật ký minh bạch.
            </p>
            <button
              type="button"
              onClick={recheckNow}
              className="w-full h-11 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition"
            >
              <RefreshCw className="w-4 h-4" />
              Kiểm tra lại sau khi đóng DevTools
            </button>
          </div>
        </div>
      )}
    </SecurityGuardContext.Provider>
  );
}
