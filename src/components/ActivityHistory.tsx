'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Columns2,
  Gift,
  Lock,
  Search,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import type { AuditLogItem, Chore, ChoreLogItem, FeatureFlags, ProfilePublic } from '@/lib/types';
import { formatIsoToVn } from '@/lib/time';
import { haptic } from '@/lib/offlineQueue';
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

type FeedFilter = 'ALL' | 'MINE' | 'BONUS' | 'SLOPPY';

function compactTime(iso: string): string {
  // formatIsoToVn returns e.g. "DD/MM/YYYY HH:mm:ss" -> extract "HH:mm DD/MM"
  const full = formatIsoToVn(iso);
  const parts = full.split(' ');
  if (parts.length >= 2) {
    return `${parts[1].slice(0, 5)} ${parts[0].slice(0, 5)}`;
  }
  return full;
}

function formatK(v: number): string {
  if (v >= 1000 && v % 1000 === 0) return `${v / 1000}k`;
  return `${v.toLocaleString('vi-VN')}đ`;
}

export function ActivityHistory({
  logs,
  logsNextCursor,
  auditLogs,
  auditNextCursor,
  subView,
  isAdmin,
  canAwardBonus = false,
  currentUserId = '',
  onInspectPhoto,
  onModerate,
  onReact,
  onAwardBonus,
}: ActivityHistoryProps) {
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<FeedFilter>('ALL');
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
      if (chip === 'MINE' && l.profile_id !== currentUserId) return false;
      if (chip === 'BONUS' && !(l.bonus_awarded > 0)) return false;
      if (chip === 'SLOPPY' && l.quality_status !== 'flagged' && l.sloppy_count === 0) return false;
      if (!q) return true;
      return (
        l.chore_title.toLowerCase().includes(q) ||
        l.member_name.toLowerCase().includes(q)
      );
    });
  }, [allLogs, query, chip, currentUserId]);

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

  if (subView === 'audit') {
    return <AuditLogView initialItems={auditLogs} initialNextCursor={auditNextCursor} />;
  }

  return (
    <div className="space-y-3">
      {/* Minimal Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm..."
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#059669]"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {(
            [
              { key: 'ALL', label: 'Tất cả' },
              { key: 'MINE', label: 'Của tôi' },
              { key: 'BONUS', label: 'Có thưởng' },
              { key: 'SLOPPY', label: 'Làm ẩu' },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setChip(item.key)}
              className={`h-9 px-3 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                chip === item.key
                  ? 'bg-[#111827] dark:bg-[#F8FAFC] text-white dark:text-[#0F172A]'
                  : 'bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] text-[#6B7280] dark:text-[#94A3B8]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-6 text-center text-xs text-[#6B7280] dark:text-[#94A3B8]">
          Trống
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((log) => {
              const isFlagged = log.quality_status === 'flagged';
              const thumbSrc = log.thumb_url || log.proof_url;
              return (
                <div
                  key={log.id}
                  className={`bg-white dark:bg-[#1E293B] rounded-2xl p-3 space-y-2 border flex flex-col justify-between ${
                    isFlagged
                      ? 'border-[#F59E0B] dark:border-[#D97706]'
                      : 'border-[#E5E7EB] dark:border-[#334155]'
                  }`}
                >
                  {/* Compact Feed Row: 48x48 Thumbnail + Chore + Member • Time + Pills */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onInspectPhoto(log)}
                      aria-label={`Xem ${log.chore_title}`}
                      className="relative w-12 h-12 rounded-xl overflow-hidden border border-[#E5E7EB] dark:border-[#334155] shrink-0 active:scale-95 transition"
                    >
                      <ProtectedImage
                        src={thumbSrc}
                        alt={log.chore_title}
                        className="w-full h-full"
                      />
                      {log.before_proof_url && (
                        <span className="absolute bottom-0 inset-x-0 z-20 bg-black/75 text-[8px] font-bold text-white text-center">
                          2 ẢNH
                        </span>
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                          {log.chore_title}
                        </p>
                        <div className="flex items-center gap-1 shrink-0 tabular-nums">
                          {log.bonus_awarded > 0 && (
                            <span className="px-1.5 py-0.5 rounded-md bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399] text-[10px] font-bold">
                              +{formatK(log.bonus_awarded)}
                            </span>
                          )}
                          {isFlagged ? (
                            <span className="px-1.5 py-0.5 rounded-md bg-[#FEF3C7] dark:bg-[#451A03] text-[#B45309] dark:text-[#FCD34D] text-[10px] font-bold">
                              Làm ẩu
                            </span>
                          ) : log.ok_count > 0 ? (
                            <span className="px-1.5 py-0.5 rounded-md bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399] text-[10px] font-bold">
                              Đạt
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] truncate tabular-nums mt-0.5">
                        {log.member_name} • {compactTime(log.server_timestamp)}
                      </p>
                    </div>
                  </div>

                  {/* Compact Action Row */}
                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#F3F4F6] dark:border-[#334155]">
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
                        Đạt{log.ok_count > 0 ? ` ${log.ok_count}` : ''}
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
                        Làm ẩu{log.sloppy_count > 0 ? ` ${log.sloppy_count}` : ''}
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
                          className="h-8 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 bg-[#FFFBEB] dark:bg-[#451A03]/60 text-[#B45309] dark:text-[#FCD34D] border border-[#FDE68A] dark:border-[#92400E]"
                        >
                          <Gift className="w-3.5 h-3.5" />
                          Thưởng
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {log.before_proof_url && (
                        <button
                          type="button"
                          onClick={() => onInspectPhoto(log)}
                          aria-label="So sánh"
                          className="h-8 px-2 rounded-lg text-xs font-semibold text-[#059669] inline-flex items-center gap-1"
                        >
                          <Columns2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {isAdmin && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmState({ id: log.id, action: 'rework_half_penalty' })
                            }
                            aria-label="Phạt 50%"
                            className="w-8 h-8 rounded-lg text-[#D97706] hover:bg-[#FFFBEB] dark:hover:bg-[#451A03]/40 flex items-center justify-center"
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmState({ id: log.id, action: 'reject' })}
                            aria-label="Hủy lượt"
                            className="w-8 h-8 rounded-lg text-[#DC2626] hover:bg-[#FEF2F2] dark:hover:bg-[#450A0A] flex items-center justify-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isAdmin && confirmState?.id === log.id && (
                    <div className="flex items-center justify-between gap-2 bg-[#FEF2F2] dark:bg-[#450A0A] rounded-xl px-3 py-2">
                      <span className="text-xs text-[#B91C1C] dark:text-[#FCA5A5] font-medium">
                        {confirmState.action === 'rework_half_penalty'
                          ? 'Phạt 50% & làm lại?'
                          : 'Xóa ảnh & hoàn tác?'}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setConfirmState(null)}
                          className="h-8 px-2.5 rounded-lg bg-white dark:bg-[#1E293B] text-xs font-medium border border-[#E5E7EB] dark:border-[#334155]"
                        >
                          Huỷ
                        </button>
                        <button
                          type="button"
                          disabled={busyId === log.id}
                          onClick={() => handleConfirmModerate(log, confirmState.action)}
                          className="h-8 px-2.5 rounded-lg bg-[#DC2626] text-white text-xs font-semibold"
                        >
                          {busyId === log.id ? '...' : 'Xác nhận'}
                        </button>
                      </div>
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
              className="w-full md:w-auto md:px-5 h-10 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-xs font-semibold"
            >
              {loadingMore ? 'Đang tải...' : 'Tải thêm'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
