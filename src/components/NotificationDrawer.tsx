'use client';

import { Bell, BellRing, CheckCheck, X } from 'lucide-react';
import type { NotificationItem } from '@/lib/types';
import { formatIsoToVn } from '@/lib/time';

interface NotificationDrawerProps {
  open: boolean;
  notifications: NotificationItem[];
  notifPermission: NotificationPermission | 'unsupported';
  onRequestPermission: () => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onClose: () => void;
}

export function NotificationDrawer({
  open,
  notifications,
  notifPermission,
  onRequestPermission,
  onMarkAllRead,
  onClose,
}: NotificationDrawerProps) {
  if (!open) return null;

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4 bg-black/50 backdrop-blur-[2px]">
      <div className="w-full max-w-lg bg-white dark:bg-[#1E293B] border-t md:border border-[#E5E7EB] dark:border-[#334155] rounded-t-3xl md:rounded-2xl p-5 pb-7 md:pb-5 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
        <div className="w-10 h-1 rounded-full bg-[#D1D5DB] dark:bg-[#475569] mx-auto -mt-1 shrink-0 md:hidden" />

        <div className="flex items-center justify-between gap-2 shrink-0">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#059669]">
              <Bell className="w-3.5 h-3.5" />
              Trung tâm thông báo
            </div>
            <h2 className="text-lg font-bold text-[#111827] dark:text-[#F8FAFC]">
              Thông báo ({unreadCount} chưa đọc)
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="h-10 px-3 rounded-xl bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399] text-xs font-semibold inline-flex items-center gap-1"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Đọc hết
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng"
              className="w-10 h-10 rounded-xl bg-[#F3F4F6] dark:bg-[#0F172A] flex items-center justify-center text-[#6B7280]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {notifPermission === 'default' && (
          <button
            type="button"
            onClick={onRequestPermission}
            className="w-full h-11 rounded-xl bg-[#FFFBEB] dark:bg-[#451A03] border border-[#FDE68A] dark:border-[#92400E] text-[#B45309] dark:text-[#FCD34D] text-xs font-semibold flex items-center justify-center gap-2 shrink-0"
          >
            <BellRing className="w-4 h-4" />
            Bật thông báo nhắc hạn trước 30 phút & 5 phút
          </button>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-[#F3F4F6] dark:divide-[#334155]">
          {notifications.length === 0 ? (
            <p className="py-10 text-center text-xs text-[#6B7280] dark:text-[#94A3B8]">
              Chưa có thông báo nào.
            </p>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`py-3 space-y-0.5 ${!n.is_read ? 'bg-[#ECFDF5]/40 dark:bg-[#064E3B]/20 -mx-2 px-2 rounded-xl' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={`text-sm font-bold ${
                      n.kind === 'bonus_reward'
                        ? 'text-[#B45309] dark:text-[#FCD34D]'
                        : 'text-[#111827] dark:text-[#F8FAFC]'
                    }`}
                  >
                    {n.kind === 'bonus_reward' ? '🎁 ' : ''}
                    {n.title}
                  </p>
                  {!n.is_read && <span className="w-2 h-2 rounded-full bg-[#059669] shrink-0" />}
                </div>
                <p className="text-xs text-[#374151] dark:text-[#CBD5E1] leading-relaxed">
                  {n.body}
                </p>
                <p className="text-[10px] text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
                  {formatIsoToVn(n.created_at)}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
