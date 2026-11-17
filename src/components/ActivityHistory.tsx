'use client';

import { useMemo, useState } from 'react';
import { History, Search, Trash2 } from 'lucide-react';
import type { ChoreLogItem, FeatureFlags } from '@/lib/types';
import { formatIsoToVn } from '@/lib/time';
import { getInitials } from './ChoreIcon';

interface ActivityHistoryProps {
  logs: ChoreLogItem[];
  featureFlags: FeatureFlags;
  isAdmin: boolean;
  onInspectPhoto: (log: ChoreLogItem) => void;
  onModerate: (log: ChoreLogItem) => Promise<void>;
}

export function ActivityHistory({
  logs,
  featureFlags,
  isAdmin,
  onInspectPhoto,
  onModerate,
}: ActivityHistoryProps) {
  const [query, setQuery] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        l.chore_title.toLowerCase().includes(q) ||
        l.member_name.toLowerCase().includes(q),
    );
  }, [logs, query]);

  async function handleConfirmModerate(log: ChoreLogItem) {
    setBusyId(log.id);
    try {
      await onModerate(log);
      setConfirmId(null);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3.5">
      {/* Search bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-[#6B7280] dark:text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm theo việc hoặc tên thành viên..."
          className="w-full h-12 pl-10 pr-4 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-sm text-[#111827] dark:text-[#F8FAFC] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#059669]"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-8 text-center">
          <History className="w-7 h-7 text-[#6B7280] mx-auto mb-2" />
          <p className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC]">
            Chưa có lịch sử hoạt động
          </p>
          <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] mt-1">
            Khi có người hoàn thành việc và chụp ảnh xác thực, nhật ký sẽ hiện ở đây.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((log) => (
            <div
              key={log.id}
              className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-3.5 space-y-2.5"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#F3F4F6] dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#334155] text-xs font-bold text-[#111827] dark:text-[#F8FAFC] flex items-center justify-center shrink-0">
                  {getInitials(log.member_name)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                      {log.member_name}
                    </span>
                    <span className="text-xs text-[#6B7280] dark:text-[#94A3B8]">đã làm</span>
                    <span className="text-sm font-semibold text-[#059669] dark:text-[#34D399] truncate">
                      {log.chore_title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
                    <span>{formatIsoToVn(log.server_timestamp)}</span>
                    {featureFlags.gamification && log.points_awarded > 0 && (
                      <span className="font-semibold text-[#059669] dark:text-[#34D399]">
                        • +{log.points_awarded} đ
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onInspectPhoto(log)}
                  aria-label="Phóng to ảnh xác thực"
                  className="w-14 h-14 rounded-xl overflow-hidden border border-[#E5E7EB] dark:border-[#334155] shrink-0 active:scale-95 transition"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={log.proof_url}
                    alt={`Ảnh ${log.chore_title}`}
                    className="w-full h-full object-cover"
                  />
                </button>
              </div>

              {isAdmin && (
                <div className="pt-1 border-t border-[#F3F4F6] dark:border-[#334155]">
                  {confirmId === log.id ? (
                    <div className="flex items-center justify-between gap-2 bg-[#FEF2F2] dark:bg-[#450A0A] rounded-xl px-3 py-2">
                      <span className="text-xs text-[#B91C1C] dark:text-[#FCA5A5] font-medium">
                        Xóa ảnh, trừ điểm & hoàn tác?
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="h-9 px-3 rounded-lg bg-white dark:bg-[#1E293B] text-xs font-medium text-[#111827] dark:text-[#F8FAFC] border border-[#E5E7EB] dark:border-[#334155]"
                        >
                          Huỷ
                        </button>
                        <button
                          type="button"
                          disabled={busyId === log.id}
                          onClick={() => handleConfirmModerate(log)}
                          className="h-9 px-3 rounded-lg bg-[#DC2626] text-white text-xs font-semibold"
                        >
                          {busyId === log.id ? 'Đang xử lý...' : 'Xác nhận'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmId(log.id)}
                      className="h-10 px-3 rounded-xl text-xs font-semibold text-[#DC2626] dark:text-[#F87171] hover:bg-[#FEF2F2] dark:hover:bg-[#450A0A] inline-flex items-center gap-1.5 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Từ chối / Hủy lượt
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
