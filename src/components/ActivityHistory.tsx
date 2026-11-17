'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Columns2,
  Gift,
  History,
  Lock,
  Search,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import type { AuditLogItem, Chore, ChoreLogItem, FeatureFlags, ProfilePublic } from '@/lib/types';
import { formatIsoToVn } from '@/lib/time';
import { haptic } from '@/lib/offlineQueue';
import { getInitials } from './ChoreIcon';
import { AuditLogView } from './AuditLogView';
import { ProtectedImage } from './ProtectedImage';
import type { BonusTarget } from './AwardBonusModal';

interface ActivityHistoryProps {
  logs: ChoreLogItem[];
  logsNextCursor: string | null;
  auditLogs: AuditLogItem[];
  auditNextCursor: string | null;
  chores?: Chore[];
  members?: ProfilePublic[];
  subView: 'feed' | 'audit';
  onChangeSubView: (v: 'feed' | 'audit') => void;
  featureFlags: FeatureFlags;
  isAdmin: boolean;
  canAwardBonus?: boolean;
  currentUserId?: string;
  onInspectPhoto: (log: ChoreLogItem) => void;
  onModerate: (log: ChoreLogItem, action?: 'reject' | 'rework_half_penalty') => Promise<void>;
  onReact: (log: ChoreLogItem, reaction: 'ok' | 'sloppy') => Promise<void>;
  onAwardBonus?: (target: BonusTarget) => void;
}

export function ActivityHistory({
  logs,
  logsNextCursor,
  auditLogs,
  auditNextCursor,
  chores = [],
  members = [],
  subView,
  onChangeSubView,
  featureFlags,
  isAdmin,
  canAwardBonus = false,
  currentUserId = '',
  onInspectPhoto,
  onModerate,
  onReact,
  onAwardBonus,
}: ActivityHistoryProps) {
  const [query, setQuery] = useState('');
  const [selectedChoreId, setSelectedChoreId] = useState<string>('ALL');
  const [selectedMemberId, setSelectedMemberId] = useState<string>('ALL');
  const [extraLogs, setExtraLogs] = useState<ChoreLogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(logsNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);

  const [confirmState, setConfirmState] = useState<{
    id: string;
    action: 'reject' | 'rework_half_penalty';
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setExtraLogs([]);
    setNextCursor(logsNextCursor);
  }, [logs, logsNextCursor]);

  const allLogs = useMemo(() => {
    const seen = new Set<string>();
    const merged: ChoreLogItem[] = [];
    for (const l of [...logs, ...extraLogs]) {
      if (!seen.has(l.id)) {
        seen.add(l.id);
        merged.push(l);
      }
    }
    return merged;
  }, [logs, extraLogs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allLogs.filter((l) => {
      if (selectedChoreId !== 'ALL' && l.chore_id !== selectedChoreId) return false;
      if (selectedMemberId !== 'ALL' && l.profile_id !== selectedMemberId) return false;
      if (!q) return true;
      return (
        l.chore_title.toLowerCase().includes(q) ||
        l.member_name.toLowerCase().includes(q)
      );
    });
  }, [allLogs, query, selectedChoreId, selectedMemberId]);

  async function loadMoreLogs() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/logs?cursor=${encodeURIComponent(nextCursor)}&limit=20`,
        { cache: 'no-store' },
      );
      if (res.ok) {
        const json = await res.json();
        setExtraLogs((prev) => [...prev, ...(json.items || [])]);
        setNextCursor(json.nextCursor ?? null);
      }
    } finally {
      setLoadingMore(false);
    }
  }

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
    <div className="space-y-4">
      {/* Sub-view switcher on mobile (hidden on md+ since Sidebar has separate links, or kept handy) */}
      <div className="md:hidden grid grid-cols-2 gap-1.5 bg-[#F3F4F6] dark:bg-[#1E293B] p-1 rounded-2xl border border-[#E5E7EB] dark:border-[#334155]">
        <button
          type="button"
          onClick={() => onChangeSubView('feed')}
          className={`h-10 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
            subView === 'feed'
              ? 'bg-white dark:bg-[#0F172A] text-[#059669] shadow-sm'
              : 'text-[#6B7280] dark:text-[#94A3B8]'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          Nhật ký việc nhà
        </button>

        <button
          type="button"
          onClick={() => onChangeSubView('audit')}
          className={`h-10 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
            subView === 'audit'
              ? 'bg-white dark:bg-[#0F172A] text-[#059669] shadow-sm'
              : 'text-[#6B7280] dark:text-[#94A3B8]'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          Minh bạch (Audit)
        </button>
      </div>

      {subView === 'audit' ? (
        <AuditLogView initialItems={auditLogs} initialNextCursor={auditNextCursor} />
      ) : (
        <>
          {/* Filter Bar (Search + Member & Chore Dropdowns/Pills) */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
            <div className="relative md:col-span-6">
              <Search className="w-4 h-4 text-[#6B7280] dark:text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm theo việc hoặc tên thành viên..."
                className="w-full h-11 pl-10 pr-4 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-sm text-[#111827] dark:text-[#F8FAFC] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#059669]"
              />
            </div>

            {chores.length > 0 && (
              <select
                value={selectedChoreId}
                onChange={(e) => setSelectedChoreId(e.target.value)}
                className="md:col-span-3 h-11 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-xs font-medium"
              >
                <option value="ALL">Tất cả đầu việc</option>
                {chores.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            )}

            {members.length > 0 && (
              <select
                value={selectedMemberId}
                onChange={(e) => setSelectedMemberId(e.target.value)}
                className="md:col-span-3 h-11 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-xs font-medium"
              >
                <option value="ALL">Tất cả thành viên</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            )}
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
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {filtered.map((log) => {
                  const isFlagged = log.quality_status === 'flagged';
                  const thumbSrc = log.thumb_url || log.proof_url;
                  return (
                    <div
                      key={log.id}
                      className={`bg-white dark:bg-[#1E293B] rounded-2xl p-3.5 space-y-2.5 border flex flex-col justify-between ${
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
                          {log.bonus_awarded > 0 && (
                            <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-[#ECFDF5] to-[#FEF3C7] dark:from-[#064E3B] dark:to-[#451A03] border border-[#FCD34D]/60 text-[11px] font-bold text-[#047857] dark:text-[#FCD34D] tabular-nums">
                              <Gift className="w-3 h-3 shrink-0" />
                              Đã thưởng +{log.bonus_awarded.toLocaleString('vi-VN')}đ
                              {log.bonus_by ? ` bởi ${log.bonus_by}` : ''}
                            </div>
                          )}
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
                                <ProtectedImage
                                  src={log.before_proof_url}
                                  alt="Trước"
                                  className="w-full h-full"
                                />
                                <span className="absolute bottom-0 inset-x-0 z-20 bg-black/75 text-[8px] font-bold text-amber-300 text-center">
                                  Trước
                                </span>
                              </div>
                              <div className="relative w-12 h-14 rounded-lg overflow-hidden border border-[#059669]">
                                <ProtectedImage
                                  src={thumbSrc}
                                  alt="Sau"
                                  className="w-full h-full"
                                />
                                <span className="absolute bottom-0 inset-x-0 z-20 bg-black/75 text-[8px] font-bold text-emerald-300 text-center">
                                  Sau
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="w-14 h-14 rounded-xl overflow-hidden border border-[#E5E7EB] dark:border-[#334155]">
                              <ProtectedImage
                                src={thumbSrc}
                                alt={`Ảnh ${log.chore_title}`}
                                className="w-full h-full"
                              />
                            </div>
                          )}
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#F3F4F6] dark:border-[#334155] flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
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

                          {canAwardBonus && onAwardBonus && log.profile_id !== currentUserId && (
                            <button
                              type="button"
                              onClick={() => {
                                haptic(10);
                                onAwardBonus({
                                  logId: log.id,
                                  recipientId: log.profile_id,
                                  recipientName: log.member_name,
                                  defaultNote: log.chore_title,
                                });
                              }}
                              className="h-8 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 bg-[#FFFBEB] dark:bg-[#451A03]/60 text-[#B45309] dark:text-[#FCD34D] border border-[#FDE68A] dark:border-[#92400E] hover:opacity-90 transition"
                            >
                              <Gift className="w-3.5 h-3.5" />
                              Tặng thưởng
                            </button>
                          )}
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

              {nextCursor && (
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={loadMoreLogs}
                  className="w-full md:w-auto md:px-6 h-11 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-xs font-semibold text-[#111827] dark:text-[#F8FAFC]"
                >
                  {loadingMore ? 'Đang tải thêm...' : 'Tải thêm nhật ký (20 mục)'}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
