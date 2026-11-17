'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Columns2, History, Search, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import type { ChoreLogItem, FeatureFlags } from '@/lib/types';
import { formatIsoToVn } from '@/lib/time';
import { haptic } from '@/lib/offlineQueue';
import { getInitials } from './ChoreIcon';

interface ActivityHistoryProps {
  logs: ChoreLogItem[];
  featureFlags: FeatureFlags;
  isAdmin: boolean;
  onInspectPhoto: (log: ChoreLogItem) => void;
  onModerate: (log: ChoreLogItem, action?: 'reject' | 'rework_half_penalty') => Promise<void>;
  onReact: (log: ChoreLogItem, reaction: 'ok' | 'sloppy') => Promise<void>;
}

export function ActivityHistory({
  logs,
  featureFlags,
  isAdmin,
  onInspectPhoto,
  onModerate,
  onReact,
}: ActivityHistoryProps) {
  const [query, setQuery] = useState('');
  const [confirmState, setConfirmState] = useState<{
    id: string;
    action: 'reject' | 'rework_half_penalty';
  } | null>(null);
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

  async function handleConfirmModerate(
    log: ChoreLogItem,
    action: 'reject' | 'rework_half_penalty',
  ) {
    setBusyId(log.id);
    haptic(15);
    try {
      await onModerate(log, action);
      setConfirmState(null);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3.5">
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
          {filtered.map((log) => {
            const isFlagged = log.quality_status === 'flagged';
            return (
              <div
                key={log.id}
                className={`bg-white dark:bg-[#1E293B] rounded-2xl p-3.5 space-y-2.5 border ${
                  isFlagged
                    ? 'border-[#F59E0B] dark:border-[#D97706]'
                    : 'border-[#E5E7EB] dark:border-[#334155]'
                }`}
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
                      {isFlagged && (
                        <span className="px-1.5 py-0.5 rounded bg-[#FEF3C7] dark:bg-[#451A03] text-[#B45309] dark:text-[#FCD34D] text-[10px] font-bold">
                          Bị báo làm ẩu
                        </span>
                      )}
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
                    className="shrink-0 active:scale-95 transition"
                  >
                    {log.before_proof_url ? (
                      <div className="flex gap-1">
                        <div className="relative w-12 h-14 rounded-lg overflow-hidden border border-[#F59E0B]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={log.before_proof_url}
                            alt="Trước"
                            className="w-full h-full object-cover"
                          />
                          <span className="absolute bottom-0 inset-x-0 bg-black/75 text-[8px] font-bold text-amber-300 text-center">
                            Trước
                          </span>
                        </div>
                        <div className="relative w-12 h-14 rounded-lg overflow-hidden border border-[#059669]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={log.proof_url}
                            alt="Sau"
                            className="w-full h-full object-cover"
                          />
                          <span className="absolute bottom-0 inset-x-0 bg-black/75 text-[8px] font-bold text-emerald-300 text-center">
                            Sau
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="w-14 h-14 rounded-xl overflow-hidden border border-[#E5E7EB] dark:border-[#334155]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={log.proof_url}
                          alt={`Ảnh ${log.chore_title}`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                  </button>
                </div>

                {/* Quality Reactions Bar */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#F3F4F6] dark:border-[#334155]">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        haptic(10);
                        void onReact(log, 'ok');
                      }}
                      className={`h-8 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition ${
                        log.my_reaction === 'ok'
                          ? 'bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399]'
                          : 'bg-[#F8F9FA] dark:bg-[#0F172A] text-[#6B7280] dark:text-[#94A3B8]'
                      }`}
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                      Đạt chuẩn{log.ok_count > 0 ? ` (${log.ok_count})` : ''}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        haptic(15);
                        void onReact(log, 'sloppy');
                      }}
                      className={`h-8 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition ${
                        log.my_reaction === 'sloppy'
                          ? 'bg-[#FEF3C7] dark:bg-[#451A03] text-[#B45309] dark:text-[#FCD34D]'
                          : 'bg-[#F8F9FA] dark:bg-[#0F172A] text-[#6B7280] dark:text-[#94A3B8]'
                      }`}
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                      Làm ẩu{log.sloppy_count > 0 ? ` (${log.sloppy_count})` : ''}
                    </button>
                  </div>

                  {log.before_proof_url && (
                    <button
                      type="button"
                      onClick={() => onInspectPhoto(log)}
                      className="h-8 px-2 rounded-lg text-[11px] font-semibold text-[#059669] inline-flex items-center gap-1"
                    >
                      <Columns2 className="w-3.5 h-3.5" />
                      So sánh
                    </button>
                  )}
                </div>

                {/* Admin Moderation Actions */}
                {isAdmin && (
                  <div className="pt-1">
                    {confirmState?.id === log.id ? (
                      <div className="flex items-center justify-between gap-2 bg-[#FEF2F2] dark:bg-[#450A0A] rounded-xl px-3 py-2">
                        <span className="text-xs text-[#B91C1C] dark:text-[#FCA5A5] font-medium">
                          {confirmState.action === 'rework_half_penalty'
                            ? 'Phạt 50% quỹ & yêu cầu làm lại?'
                            : 'Xóa ảnh, trừ điểm & hoàn tác?'}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setConfirmState(null)}
                            className="h-9 px-3 rounded-lg bg-white dark:bg-[#1E293B] text-xs font-medium text-[#111827] dark:text-[#F8FAFC] border border-[#E5E7EB] dark:border-[#334155]"
                          >
                            Huỷ
                          </button>
                          <button
                            type="button"
                            disabled={busyId === log.id}
                            onClick={() => handleConfirmModerate(log, confirmState.action)}
                            className="h-9 px-3 rounded-lg bg-[#DC2626] text-white text-xs font-semibold"
                          >
                            {busyId === log.id ? 'Đang xử lý...' : 'Xác nhận'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmState({ id: log.id, action: 'rework_half_penalty' })
                          }
                          className="h-9 px-2.5 rounded-lg text-xs font-semibold text-[#D97706] bg-[#FFFBEB] dark:bg-[#451A03]/50 inline-flex items-center gap-1"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Làm lại / Phạt 50%
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmState({ id: log.id, action: 'reject' })}
                          className="h-9 px-2.5 rounded-lg text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] dark:hover:bg-[#450A0A] inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Từ chối / Hủy lượt
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
