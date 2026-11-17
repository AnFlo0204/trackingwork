'use client';

import { useEffect, useMemo, useState } from 'react';
import { Lock, Search, ShieldAlert } from 'lucide-react';
import type { AuditLogItem } from '@/lib/types';
import { formatIsoToVn } from '@/lib/time';

interface AuditLogViewProps {
  initialItems: AuditLogItem[];
  initialNextCursor: string | null;
}

const ACTION_FILTERS = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'PHOTO', label: 'Ảnh & Hủy lượt' },
  { key: 'FUND', label: 'Quỹ tuần' },
  { key: 'CHORE', label: 'Việc nhà' },
  { key: 'SYSTEM', label: 'Quyền & Cài đặt' },
] as const;

type FilterGroup = (typeof ACTION_FILTERS)[number]['key'];

function formatActionBadge(actionType: string): { label: string; tone: string } {
  switch (actionType) {
    case 'REJECT_PROOF':
    case 'DELETE_PHOTO':
      return {
        label: 'Xóa / Hủy ảnh',
        tone: 'bg-[#FEF2F2] dark:bg-[#450A0A] text-[#DC2626] dark:text-[#FCA5A5]',
      };
    case 'REWORK_HALF_PENALTY':
      return {
        label: 'Phạt 50% làm lại',
        tone: 'bg-[#FFFBEB] dark:bg-[#451A03] text-[#D97706] dark:text-[#FCD34D]',
      };
    case 'ADJUST_FUND':
    case 'CLOSE_WEEK':
    case 'RESET_PARTY_FUND':
      return {
        label: 'Quỹ & Quyết toán',
        tone: 'bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399]',
      };
    case 'DELETE_CHORE':
    case 'EDIT_CHORE':
      return {
        label: 'Đầu việc',
        tone: 'bg-[#EFF6FF] dark:bg-[#1E3A8A]/40 text-[#2563EB] dark:text-[#93C5FD]',
      };
    case 'CHANGE_ROLE':
      return {
        label: 'Nhân sự & Quyền',
        tone: 'bg-[#F5F3FF] dark:bg-[#4C1D95]/40 text-[#7C3AED] dark:text-[#C4B5FD]',
      };
    case 'MANUAL_CLEANUP':
      return {
        label: 'Dọn dẹp dữ liệu',
        tone: 'bg-[#F3F4F6] dark:bg-[#0F172A] text-[#374151] dark:text-[#CBD5E1]',
      };
    case 'CHANGE_SETTINGS':
    default:
      return {
        label: 'Cấu hình',
        tone: 'bg-[#F3F4F6] dark:bg-[#0F172A] text-[#374151] dark:text-[#CBD5E1]',
      };
  }
}

export function AuditLogView({ initialItems, initialNextCursor }: AuditLogViewProps) {
  const [extraItems, setExtraItems] = useState<AuditLogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<FilterGroup>('ALL');

  useEffect(() => {
    setExtraItems([]);
    setNextCursor(initialNextCursor);
  }, [initialItems, initialNextCursor]);

  const allItems = useMemo(() => {
    const seen = new Set<string>();
    const merged: AuditLogItem[] = [];
    for (const item of [...initialItems, ...extraItems]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
    return merged;
  }, [initialItems, extraItems]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allItems.filter((item) => {
      if (group === 'PHOTO' && !['REJECT_PROOF', 'DELETE_PHOTO', 'REWORK_HALF_PENALTY'].includes(item.action_type)) {
        return false;
      }
      if (group === 'FUND' && !['ADJUST_FUND', 'CLOSE_WEEK', 'RESET_PARTY_FUND'].includes(item.action_type)) {
        return false;
      }
      if (group === 'CHORE' && !['DELETE_CHORE', 'EDIT_CHORE'].includes(item.action_type)) {
        return false;
      }
      if (group === 'SYSTEM' && !['CHANGE_ROLE', 'CHANGE_SETTINGS', 'MANUAL_CLEANUP'].includes(item.action_type)) {
        return false;
      }
      if (!q) return true;
      return (
        item.actor_name.toLowerCase().includes(q) ||
        item.target_summary.toLowerCase().includes(q) ||
        item.action_type.toLowerCase().includes(q)
      );
    });
  }, [allItems, group, query]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/audit-logs?cursor=${encodeURIComponent(nextCursor)}&limit=20`,
        { cache: 'no-store' },
      );
      if (res.ok) {
        const json = await res.json();
        setExtraItems((prev) => [...prev, ...(json.items || [])]);
        setNextCursor(json.nextCursor ?? null);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Hard Immutability Notice Badge */}
      <div className="rounded-2xl bg-[#ECFDF5] dark:bg-[#064E3B]/50 border border-[#A7F3D0] dark:border-[#047857] p-3.5 flex items-start gap-2.5">
        <Lock className="w-4 h-4 text-[#059669] dark:text-[#34D399] shrink-0 mt-0.5" />
        <p className="text-xs font-semibold text-[#065F46] dark:text-[#A7F3D0] leading-relaxed">
          Dữ liệu khóa cứng bởi hệ thống — Admin không thể chỉnh sửa hoặc xóa
        </p>
      </div>

      {/* Search & Filter */}
      <div className="relative">
        <Search className="w-4 h-4 text-[#6B7280] dark:text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm theo người thao tác hoặc nội dung..."
          className="w-full h-11 pl-10 pr-4 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-sm"
        />
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {ACTION_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setGroup(f.key)}
            className={`h-8 px-3 rounded-lg text-xs font-medium whitespace-nowrap transition ${
              group === f.key
                ? 'bg-[#111827] dark:bg-[#F8FAFC] text-white dark:text-[#0F172A]'
                : 'bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] text-[#6B7280] dark:text-[#94A3B8]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-8 text-center">
          <ShieldAlert className="w-7 h-7 text-[#6B7280] mx-auto mb-2" />
          <p className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC]">
            Chưa có bản ghi kiểm toán nào
          </p>
          <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] mt-1">
            Mọi thao tác xóa ảnh, sửa đầu việc, đổi quyền hoặc điều chỉnh quỹ sẽ tự động ghi vĩnh viễn tại đây.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => {
            const badge = formatActionBadge(item.action_type);
            return (
              <div
                key={item.id}
                className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-3.5 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${badge.tone}`}>
                    {badge.label}
                  </span>
                  <span className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
                    {formatIsoToVn(item.created_at)}
                  </span>
                </div>
                <p className="text-xs font-bold text-[#111827] dark:text-[#F8FAFC]">
                  Người thực hiện: <span className="text-[#059669]">{item.actor_name}</span>
                </p>
                <p className="text-xs text-[#374151] dark:text-[#CBD5E1] leading-relaxed">
                  {item.target_summary}
                </p>
              </div>
            );
          })}

          {nextCursor && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={loadMore}
              className="w-full h-11 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-xs font-semibold text-[#111827] dark:text-[#F8FAFC]"
            >
              {loadingMore ? 'Đang tải thêm...' : 'Tải thêm nhật ký minh bạch (20 mục)'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
