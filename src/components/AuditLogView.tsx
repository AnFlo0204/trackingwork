'use client';

import { useEffect, useMemo, useState } from 'react';
import { Lock, Search } from 'lucide-react';
import type { AuditLogItem } from '@/lib/types';
import { formatIsoToVn } from '@/lib/time';

interface AuditLogViewProps {
  initialItems: AuditLogItem[];
  initialNextCursor: string | null;
}

const ACTION_FILTERS = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'PHOTO', label: 'Ảnh' },
  { key: 'FUND', label: 'Quỹ' },
  { key: 'CHORE', label: 'Việc' },
  { key: 'SECURITY', label: 'Bảo mật' },
] as const;

type FilterGroup = (typeof ACTION_FILTERS)[number]['key'];

function compactTime(iso: string): string {
  const full = formatIsoToVn(iso);
  const parts = full.split(' ');
  if (parts.length >= 2) {
    return `${parts[1].slice(0, 5)} ${parts[0].slice(0, 5)}`;
  }
  return full;
}

function formatStructuredTag(item: AuditLogItem): { tag: string; tone: string } {
  switch (item.action_type) {
    case 'AWARD_BONUS': {
      const m = item.target_summary.match(/\+([\d.,]+)đ/);
      const num = m ? Number(m[1].replace(/\D/g, '')) : 0;
      const short = num >= 1000 && num % 1000 === 0 ? `${num / 1000}k` : num > 0 ? `${num}đ` : '';
      return {
        tag: short ? `[Thưởng +${short}]` : '[Thưởng]',
        tone: 'text-[#059669] dark:text-[#34D399] bg-[#ECFDF5] dark:bg-[#064E3B]',
      };
    }
    case 'REJECT_PROOF':
    case 'DELETE_PHOTO':
      return {
        tag: '[Xóa ảnh]',
        tone: 'text-[#DC2626] dark:text-[#FCA5A5] bg-[#FEF2F2] dark:bg-[#450A0A]',
      };
    case 'REWORK_HALF_PENALTY':
      return {
        tag: '[Phạt 50%]',
        tone: 'text-[#D97706] dark:text-[#FCD34D] bg-[#FFFBEB] dark:bg-[#451A03]',
      };
    case 'ADJUST_FUND':
    case 'CLOSE_WEEK':
    case 'RESET_PARTY_FUND':
      return {
        tag: '[Quỹ tuần]',
        tone: 'text-[#059669] dark:text-[#34D399] bg-[#ECFDF5] dark:bg-[#064E3B]',
      };
    case 'DELETE_CHORE':
    case 'EDIT_CHORE':
      return {
        tag: '[Việc nhà]',
        tone: 'text-[#2563EB] dark:text-[#93C5FD] bg-[#EFF6FF] dark:bg-[#1E3A8A]/40',
      };
    case 'CHANGE_ROLE':
      return {
        tag: '[Đổi quyền]',
        tone: 'text-[#7C3AED] dark:text-[#C4B5FD] bg-[#F5F3FF] dark:bg-[#4C1D95]/40',
      };
    case 'DEVTOOLS_TAMPER_ATTEMPT':
    case 'HMAC_SPOOF_ATTEMPT':
    case 'BINARY_TAMPER_ATTEMPT':
    case 'AUTH_BRUTE_FORCE_LOCK':
      return {
        tag: '[Bảo mật]',
        tone: 'text-[#B91C1C] dark:text-[#FCA5A5] bg-[#FEF2F2] dark:bg-[#450A0A]',
      };
    case 'MANUAL_CLEANUP':
      return {
        tag: '[Dọn dẹp]',
        tone: 'text-[#374151] dark:text-[#CBD5E1] bg-[#F3F4F6] dark:bg-[#0F172A]',
      };
    default:
      return {
        tag: '[Cài đặt]',
        tone: 'text-[#374151] dark:text-[#CBD5E1] bg-[#F3F4F6] dark:bg-[#0F172A]',
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
      if (
        group === 'PHOTO' &&
        !['REJECT_PROOF', 'DELETE_PHOTO', 'REWORK_HALF_PENALTY'].includes(item.action_type)
      ) {
        return false;
      }
      if (
        group === 'FUND' &&
        !['ADJUST_FUND', 'CLOSE_WEEK', 'RESET_PARTY_FUND', 'AWARD_BONUS'].includes(item.action_type)
      ) {
        return false;
      }
      if (group === 'CHORE' && !['DELETE_CHORE', 'EDIT_CHORE'].includes(item.action_type)) {
        return false;
      }
      if (
        group === 'SECURITY' &&
        ![
          'DEVTOOLS_TAMPER_ATTEMPT',
          'HMAC_SPOOF_ATTEMPT',
          'BINARY_TAMPER_ATTEMPT',
          'AUTH_BRUTE_FORCE_LOCK',
        ].includes(item.action_type)
      ) {
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
      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm..."
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-sm"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <span className="inline-flex items-center gap-1 px-2.5 h-9 rounded-lg bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399] text-[11px] font-semibold shrink-0">
            <Lock className="w-3 h-3" />
            Bất biến
          </span>
          {ACTION_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setGroup(f.key)}
              className={`h-9 px-3 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                group === f.key
                  ? 'bg-[#111827] dark:bg-[#F8FAFC] text-white dark:text-[#0F172A]'
                  : 'bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] text-[#6B7280] dark:text-[#94A3B8]'
              }`}
            >
              {f.label}
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
          <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl divide-y divide-[#F3F4F6] dark:divide-[#334155]">
            {filtered.map((item) => {
              const { tag, tone } = formatStructuredTag(item);
              return (
                <div key={item.id} className="px-4 py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`px-1.5 py-0.5 rounded font-bold text-[10px] shrink-0 ${tone}`}>
                        {tag}
                      </span>
                      <span className="font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                        {item.actor_name}
                      </span>
                    </div>
                    <span className="text-[11px] text-[#9CA3AF] dark:text-[#64748B] tabular-nums shrink-0">
                      {compactTime(item.created_at)}
                    </span>
                  </div>
                  <p className="text-xs text-[#4B5563] dark:text-[#CBD5E1] truncate">
                    → {item.target_summary}
                  </p>
                </div>
              );
            })}
          </div>

          {nextCursor && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={loadMore}
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
