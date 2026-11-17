'use client';

import { useEffect, useMemo, useState } from 'react';
import { Camera, CheckCircle2, Clock, Sparkles } from 'lucide-react';
import type { Chore, ChoreLogItem, FeatureFlags } from '@/lib/types';
import { formatRelativeVi, getVnPeriodBounds } from '@/lib/time';
import { ChoreIcon, getInitials } from './ChoreIcon';

interface ChoreBoardProps {
  chores: Chore[];
  logs: ChoreLogItem[];
  featureFlags: FeatureFlags;
  serverNowIso: string;
  onStartComplete: (chore: Chore) => void;
  onInspectPhoto: (log: ChoreLogItem) => void;
}

type FilterKey = 'all' | 'pending' | 'daily' | 'weekly';

export function ChoreBoard({
  chores,
  logs,
  featureFlags,
  serverNowIso,
  onStartComplete,
  onInspectPhoto,
}: ChoreBoardProps) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [tickMs, setTickMs] = useState(() => Date.parse(serverNowIso) || Date.now());

  // Keep ticking clock relative to authoritative server time
  useEffect(() => {
    const baseServer = Date.parse(serverNowIso);
    const baseLocal = Date.now();
    setTickMs(Number.isNaN(baseServer) ? baseLocal : baseServer);

    const timer = setInterval(() => {
      const elapsed = Date.now() - baseLocal;
      setTickMs((Number.isNaN(baseServer) ? baseLocal : baseServer) + elapsed);
    }, 1000);
    return () => clearInterval(timer);
  }, [serverNowIso]);

  const activeChores = useMemo(() => chores.filter((c) => c.is_active), [chores]);

  const latestLogByChore = useMemo(() => {
    const map = new Map<string, ChoreLogItem>();
    for (const log of logs) {
      if (!map.has(log.chore_id)) {
        map.set(log.chore_id, log);
      }
    }
    return map;
  }, [logs]);

  const { startOfDayUtcMs, startOfWeekUtcMs } = useMemo(
    () => getVnPeriodBounds(tickMs),
    [tickMs],
  );

  function isCompletedInCurrentPeriod(chore: Chore, latest?: ChoreLogItem): boolean {
    if (!latest || !featureFlags.recurring_tasks) return false;
    const logMs = Date.parse(latest.server_timestamp);
    if (chore.frequency === 'daily') return logMs >= startOfDayUtcMs;
    if (chore.frequency === 'weekly') return logMs >= startOfWeekUtcMs;
    return false;
  }

  const recurringSummary = useMemo(() => {
    const recurring = activeChores.filter((c) => c.frequency === 'daily' || c.frequency === 'weekly');
    const done = recurring.filter((c) => isCompletedInCurrentPeriod(c, latestLogByChore.get(c.id)));
    return { total: recurring.length, done: done.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChores, latestLogByChore, startOfDayUtcMs, startOfWeekUtcMs, featureFlags.recurring_tasks]);

  const filteredChores = useMemo(() => {
    if (!featureFlags.recurring_tasks) return activeChores;
    return activeChores.filter((c) => {
      if (filter === 'daily') return c.frequency === 'daily';
      if (filter === 'weekly') return c.frequency === 'weekly';
      if (filter === 'pending') return !isCompletedInCurrentPeriod(c, latestLogByChore.get(c.id));
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChores, filter, featureFlags.recurring_tasks, latestLogByChore, startOfDayUtcMs, startOfWeekUtcMs]);

  return (
    <div className="space-y-3.5">
      {featureFlags.recurring_tasks && recurringSummary.total > 0 && (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-[#6B7280] dark:text-[#94A3B8] uppercase tracking-wide">
                Tiến độ định kỳ
              </p>
              <p className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] tabular-nums mt-0.5">
                Đã xong {recurringSummary.done}/{recurringSummary.total} việc định kỳ
              </p>
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399] tabular-nums">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {Math.round((recurringSummary.done / recurringSummary.total) * 100)}%
            </span>
          </div>

          <div className="h-1.5 w-full rounded-full bg-[#F3F4F6] dark:bg-[#0F172A] overflow-hidden">
            <div
              className="h-full bg-[#059669] rounded-full transition-all duration-300"
              style={{
                width: `${Math.round((recurringSummary.done / recurringSummary.total) * 100)}%`,
              }}
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pt-0.5">
            {(
              [
                { key: 'all', label: 'Tất cả' },
                { key: 'pending', label: 'Chưa xong' },
                { key: 'daily', label: 'Hàng ngày' },
                { key: 'weekly', label: 'Hàng tuần' },
              ] as const
            ).map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => setFilter(chip.key)}
                className={`h-8 px-3 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                  filter === chip.key
                    ? 'bg-[#111827] dark:bg-[#F8FAFC] text-white dark:text-[#0F172A]'
                    : 'bg-[#F3F4F6] dark:bg-[#0F172A] text-[#6B7280] dark:text-[#94A3B8]'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {filteredChores.length === 0 ? (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-8 text-center">
          <Sparkles className="w-7 h-7 text-[#059669] mx-auto mb-2" />
          <p className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC]">
            Không còn việc nào trong mục này
          </p>
          <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] mt-1">
            Mọi người đã hoàn thành gọn gàng rồi!
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredChores.map((chore) => {
            const latest = latestLogByChore.get(chore.id);
            const cooldownMs = Math.max(0, chore.cooldown_minutes) * 60_000;
            const lastMs = latest ? Date.parse(latest.server_timestamp) : 0;
            const remainMs = latest && cooldownMs > 0 ? Math.max(0, lastMs + cooldownMs - tickMs) : 0;
            const onCooldown = remainMs > 0;
            const doneThisPeriod = isCompletedInCurrentPeriod(chore, latest);

            const remainMin = Math.floor(remainMs / 60_000);
            const remainSec = Math.floor((remainMs % 60_000) / 1000);

            return (
              <div
                key={chore.id}
                className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-3"
              >
                {/* Header Row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${
                        doneThisPeriod
                          ? 'bg-[#ECFDF5] dark:bg-[#064E3B] border-[#A7F3D0] dark:border-[#047857] text-[#059669] dark:text-[#34D399]'
                          : 'bg-[#F8F9FA] dark:bg-[#0F172A] border-[#E5E7EB] dark:border-[#334155] text-[#111827] dark:text-[#F8FAFC]'
                      }`}
                    >
                      <ChoreIcon icon={chore.icon} className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="text-base font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                          {chore.title}
                        </h3>
                        {doneThisPeriod && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#059669] dark:text-[#34D399]">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Xong
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-[#6B7280] dark:text-[#94A3B8]">
                        {featureFlags.recurring_tasks && chore.frequency !== 'always' && (
                          <span>{chore.frequency === 'daily' ? 'Hàng ngày' : 'Hàng tuần'}</span>
                        )}
                        {chore.cooldown_minutes > 0 && (
                          <span className="tabular-nums">• Chờ {chore.cooldown_minutes}p</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {featureFlags.gamification && (
                    <span className="shrink-0 inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold tabular-nums bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399] border border-[#A7F3D0]/60 dark:border-[#047857]">
                      +{chore.points} đ
                    </span>
                  )}
                </div>

                {/* Last Completed By Strip */}
                {latest ? (
                  <div className="flex items-center justify-between gap-2.5 rounded-xl bg-[#F8F9FA] dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#334155] px-3 py-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-[#E5E7EB] dark:bg-[#334155] text-[#111827] dark:text-[#F8FAFC] text-[11px] font-bold flex items-center justify-center shrink-0">
                        {getInitials(latest.member_name)}
                      </div>
                      <p className="text-xs text-[#374151] dark:text-[#CBD5E1] truncate tabular-nums">
                        Gần nhất: <span className="font-semibold">{latest.member_name}</span> •{' '}
                        <span className="text-[#6B7280] dark:text-[#94A3B8]">
                          {formatRelativeVi(latest.server_timestamp, tickMs)}
                        </span>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onInspectPhoto(latest)}
                      aria-label={`Xem ảnh ${chore.title}`}
                      className="w-10 h-10 rounded-lg overflow-hidden border border-[#E5E7EB] dark:border-[#334155] shrink-0 active:scale-95 transition"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={latest.proof_url}
                        alt="Ảnh xác thực"
                        className="w-full h-full object-cover"
                      />
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl bg-[#F8F9FA] dark:bg-[#0F172A] border border-dashed border-[#E5E7EB] dark:border-[#334155] px-3 py-2 text-xs text-[#6B7280] dark:text-[#94A3B8]">
                    Chưa có lượt hoàn thành nào được ghi nhận
                  </div>
                )}

                {/* Action Button or Cooldown */}
                {onCooldown ? (
                  <div className="w-full h-12 rounded-xl bg-[#FEF3C7] dark:bg-[#451A03] border border-[#FDE68A] dark:border-[#92400E] text-[#B45309] dark:text-[#FCD34D] text-sm font-semibold flex items-center justify-center gap-2 tabular-nums">
                    <Clock className="w-4 h-4" />
                    Vừa hoàn thành • Chờ {String(remainMin).padStart(2, '0')}:
                    {String(remainSec).padStart(2, '0')}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onStartComplete(chore)}
                    className="w-full h-12 rounded-xl bg-[#059669] hover:bg-[#047857] text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition"
                  >
                    <Camera className="w-4 h-4" />
                    Hoàn thành việc
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
