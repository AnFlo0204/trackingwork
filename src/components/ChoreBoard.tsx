'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  CalendarClock,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  Columns2,
  Eye,
  Gift,
  HandHelping,
  MoreHorizontal,
  PartyPopper,
  Play,
  Sparkles,
  Timer,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AssignedChoreItem,
  Chore,
  ChoreLogItem,
  ChoreSessionItem,
  FeatureFlags,
  FundTransactionItem,
  ProfilePublic,
  SharedPartyFund,
  ShiftSwapItem,
  WeeklyFundConfig,
} from '@/lib/types';
import { formatRelativeVi, getVnPeriodBounds } from '@/lib/time';
import { haptic } from '@/lib/offlineQueue';
import { signedFetch } from '@/lib/requestSigner';
import { ChoreIcon } from './ChoreIcon';
import { ProtectedImage } from './ProtectedImage';
import type { CaptureTarget } from './CameraCaptureSheet';
import type { BonusTarget } from './AwardBonusModal';

interface ChoreBoardProps {
  me: ProfilePublic;
  chores: Chore[];
  activeSessions: ChoreSessionItem[];
  logs: ChoreLogItem[];
  assignedChores: AssignedChoreItem[];
  shiftSwaps: ShiftSwapItem[];
  fundTransactions: FundTransactionItem[];
  sharedPartyFund: SharedPartyFund;
  featureFlags: FeatureFlags;
  weeklyFundConfig: WeeklyFundConfig;
  serverNowIso: string;
  canAwardBonus?: boolean;
  onAwardBonus?: (target: BonusTarget) => void;
  onStartCapture: (target: CaptureTarget) => void;
  onInspectPhoto: (log: ChoreLogItem) => void;
  onOpenWallet: () => void;
  onOpenSwapSheet: (assignment: AssignedChoreItem) => void;
  onRefresh: () => Promise<void>;
}

type FilterKey = 'all' | 'pending' | 'daily' | 'weekly';

type DetailTarget =
  | { kind: 'chore'; chore: Chore; latest?: ChoreLogItem }
  | { kind: 'assigned'; assignment: AssignedChoreItem; chore?: Chore; latest?: ChoreLogItem };

const DAY_LABELS: Record<number, string> = {
  1: 'T2',
  2: 'T3',
  3: 'T4',
  4: 'T5',
  5: 'T6',
  6: 'T7',
  0: 'CN',
};

function describeAssignmentSchedule(a: AssignedChoreItem): string {
  if (a.schedule_type === 'daily') return `Hôm nay • ${a.due_time}`;
  if (a.schedule_type === 'once') {
    const d = a.due_date ? a.due_date.split('-').reverse().join('/') : '';
    return `${d} • ${a.due_time}`;
  }
  const days = a.days_of_week.map((d) => DAY_LABELS[d]).filter(Boolean).join(', ');
  return `${days} • ${a.due_time}`;
}

export function ChoreBoard({
  me,
  chores,
  activeSessions,
  logs,
  assignedChores,
  shiftSwaps,
  fundTransactions,
  sharedPartyFund,
  featureFlags,
  weeklyFundConfig,
  serverNowIso,
  canAwardBonus = false,
  onAwardBonus,
  onStartCapture,
  onInspectPhoto,
  onOpenWallet,
  onOpenSwapSheet,
  onRefresh,
}: ChoreBoardProps) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [tickMs, setTickMs] = useState(() => Date.parse(serverNowIso) || Date.now());
  const [busySwapId, setBusySwapId] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);

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
  const choreById = useMemo(() => new Map(chores.map((c) => [c.id, c])), [chores]);

  const myAssignments = useMemo(
    () =>
      assignedChores.filter(
        (a) =>
          a.is_active &&
          (a.effective_assignee_id === me.id ||
            (a.assignee_id === me.id && a.active_swap?.status === 'open')),
      ),
    [assignedChores, me.id],
  );

  const openSwapsForMe = useMemo(
    () =>
      shiftSwaps.filter(
        (sw) =>
          sw.status === 'open' &&
          sw.requester_id !== me.id &&
          (sw.target_id === null || sw.target_id === me.id),
      ),
    [shiftSwaps, me.id],
  );

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

  const balancePct =
    me.weekly_allowance > 0
      ? Math.max(0, Math.min(100, Math.round((me.current_balance / me.weekly_allowance) * 100)))
      : 0;

  const myBonusTotal = useMemo(
    () =>
      fundTransactions
        .filter(
          (tx) =>
            tx.profile_id === me.id &&
            (tx.tx_type === 'BONUS_REWARD' ||
              tx.tx_type === 'bonus_reward' ||
              tx.category === 'bonus_reward'),
        )
        .reduce((acc, tx) => acc + Math.max(0, tx.amount), 0),
    [fundTransactions, me.id],
  );

  async function respondSwap(swapId: string, action: 'accept' | 'cancel') {
    setBusySwapId(swapId);
    haptic(15);
    try {
      await signedFetch('/api/swaps', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swapId, action }),
      });
      await onRefresh();
    } finally {
      setBusySwapId(null);
    }
  }

  async function cancelSession(sessionId: string) {
    haptic(15);
    await signedFetch(`/api/chores/start?sessionId=${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
    await onRefresh();
  }

  function findActiveSession(choreId: string, assignedChoreId: string | null) {
    return (
      activeSessions.find(
        (s) =>
          s.chore_id === choreId &&
          (assignedChoreId ? s.assigned_chore_id === assignedChoreId : !s.assigned_chore_id),
      ) ||
      activeSessions.find((s) => s.chore_id === choreId) ||
      null
    );
  }

  function formatCountdown(ms: number): string {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  const pendingPersonalCount = myAssignments.filter((a) => a.cycle_status === 'pending').length;
  const progressPct =
    recurringSummary.total > 0
      ? Math.round((recurringSummary.done / recurringSummary.total) * 100)
      : 0;

  return (
    <div className="space-y-4">
      {/* Unified Dual-Metric Top Summary Strip (Wallet + Progress, immediate above-the-fold layout) */}
      {(weeklyFundConfig.enabled || featureFlags.recurring_tasks || sharedPartyFund.show_banner) && (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl overflow-hidden shadow-xs">
          <div className="grid grid-cols-2 divide-x divide-[#F3F4F6] dark:divide-[#334155]">
            {weeklyFundConfig.enabled ? (
              <button
                type="button"
                onClick={() => {
                  haptic(10);
                  onOpenWallet();
                }}
                className="p-3.5 text-left hover:bg-[#F8F9FA] dark:hover:bg-[#0F172A]/40 active:opacity-80 transition space-y-1.5"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[#6B7280] dark:text-[#94A3B8]">
                    <Wallet className="w-3.5 h-3.5 text-[#059669]" />
                    Ví quỹ
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-[#9CA3AF]" />
                </div>
                <div className="flex items-baseline gap-1.5 flex-wrap tabular-nums">
                  <span className="text-base font-bold text-[#111827] dark:text-[#F8FAFC]">
                    {me.current_balance.toLocaleString('vi-VN')}đ
                  </span>
                  {myBonusTotal > 0 && (
                    <span className="text-[10px] font-bold text-[#D97706] dark:text-[#FCD34D]">
                      (+{myBonusTotal.toLocaleString('vi-VN')}đ)
                    </span>
                  )}
                </div>
                {me.weekly_allowance > 0 && (
                  <div className="h-1.5 w-full rounded-full bg-[#F3F4F6] dark:bg-[#0F172A] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        me.current_balance <= 0
                          ? 'bg-[#DC2626]'
                          : balancePct < 50
                            ? 'bg-[#D97706]'
                            : 'bg-[#059669]'
                      }`}
                      style={{ width: `${balancePct}%` }}
                    />
                  </div>
                )}
              </button>
            ) : (
              <div className="p-3.5 flex items-center text-xs text-[#6B7280] dark:text-[#94A3B8]">
                Ví quỹ đang tắt
              </div>
            )}

            {featureFlags.recurring_tasks && recurringSummary.total > 0 ? (
              <div className="p-3.5 space-y-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280] dark:text-[#94A3B8]">
                    Tiến độ
                  </span>
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399] tabular-nums">
                    <CheckCircle2 className="w-3 h-3" />
                    {progressPct}%
                  </span>
                </div>
                <p className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] tabular-nums truncate">
                  {recurringSummary.done}/{recurringSummary.total} chung
                  {pendingPersonalCount > 0 ? ` • ${pendingPersonalCount} riêng` : ''}
                </p>
                <div className="h-1.5 w-full rounded-full bg-[#F3F4F6] dark:bg-[#0F172A] overflow-hidden">
                  <div
                    className="h-full bg-[#059669] rounded-full transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="p-3.5 flex flex-col justify-center">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280] dark:text-[#94A3B8]">
                  Việc riêng
                </span>
                <span className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] tabular-nums mt-0.5">
                  {pendingPersonalCount > 0 ? `${pendingPersonalCount} chờ làm` : 'Gọn gàng'}
                </span>
              </div>
            )}
          </div>

          {sharedPartyFund.show_banner && (
            <div className="px-3.5 py-2 border-t border-[#F3F4F6] dark:border-[#334155] bg-[#FFFBEB]/60 dark:bg-[#451A03]/25 flex items-center justify-between text-xs tabular-nums">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#B45309] dark:text-[#FCD34D]">
                <PartyPopper className="w-3.5 h-3.5" />
                Quỹ liên hoan chung
              </span>
              <span className="font-bold text-[#111827] dark:text-[#F8FAFC]">
                {sharedPartyFund.balance.toLocaleString('vi-VN')}đ
              </span>
            </div>
          )}
        </div>
      )}

      {/* Open Shift Swaps & Bounty Requests */}
      {openSwapsForMe.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#D97706] px-0.5 flex items-center gap-1.5">
            <HandHelping className="w-3.5 h-3.5" />
            Kèo nhờ làm hộ ({openSwapsForMe.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {openSwapsForMe.map((sw) => (
              <div
                key={sw.id}
                className="bg-[#FFFBEB] dark:bg-[#451A03]/40 border border-[#FDE68A] dark:border-[#92400E] rounded-2xl p-3 flex items-center justify-between gap-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                    {sw.chore_title} •{' '}
                    <span className="text-[#B45309] dark:text-[#FCD34D]">
                      {sw.requester_name}
                    </span>
                  </p>
                  <p className="text-xs text-[#6B7280] dark:text-[#CBD5E1] tabular-nums">
                    Hạn {sw.due_time}
                    {sw.bounty_amount > 0 && (
                      <span className="font-bold text-[#059669] dark:text-[#34D399]">
                        {' '}
                        • +{sw.bounty_amount.toLocaleString('vi-VN')}đ
                      </span>
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={busySwapId === sw.id}
                  onClick={() => respondSwap(sw.id, 'accept')}
                  className="h-10 px-3.5 rounded-xl bg-[#059669] text-white text-xs font-bold shrink-0"
                >
                  {busySwapId === sw.id ? '...' : 'Nhận ca'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 1: My Assigned Chores (Collapsed to slim 1-line bar when 0) */}
      {myAssignments.length === 0 ? (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs text-[#6B7280] dark:text-[#94A3B8]">
          <span className="font-medium">Việc riêng: Trống</span>
          <span className="px-2 py-0.5 rounded-md bg-[#F3F4F6] dark:bg-[#0F172A] text-[11px] font-semibold tabular-nums">
            0
          </span>
        </div>
      ) : (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-[#F8FAFC]">
              Việc được giao ({myAssignments.length})
            </h2>
            {pendingPersonalCount > 0 && (
              <span className="text-[11px] font-semibold text-[#D97706] tabular-nums">
                {pendingPersonalCount} chờ làm
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {myAssignments.map((a) => {
              const linkedChore = choreById.get(a.chore_id);
              const isDone = a.cycle_status === 'completed';
              const isMissed = a.cycle_status === 'missed';
              const isPending = a.cycle_status === 'pending';
              const isSwappedToMe =
                a.active_swap?.status === 'accepted' && a.active_swap.accepted_by === me.id;
              const isOpenSwapByMe =
                a.active_swap?.status === 'open' && a.active_swap.requester_id === me.id;

              const session = linkedChore ? findActiveSession(linkedChore.id, a.id) : null;
              const unlockRemainMs = session ? Math.max(0, Date.parse(session.unlock_at) - tickMs) : 0;

              return (
                <div
                  key={a.id}
                  className={`bg-white dark:bg-[#1E293B] rounded-2xl p-3.5 space-y-2.5 border flex flex-col justify-between ${
                    isMissed
                      ? 'border-[#FCA5A5] dark:border-[#991B1B]'
                      : isDone
                        ? 'border-[#A7F3D0] dark:border-[#047857]'
                        : 'border-[#FCD34D] dark:border-[#B45309]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                          isDone
                            ? 'bg-[#ECFDF5] dark:bg-[#064E3B] border-[#A7F3D0] text-[#059669] dark:text-[#34D399]'
                            : isMissed
                              ? 'bg-[#FEF2F2] dark:bg-[#450A0A] border-[#FECACA] text-[#DC2626]'
                              : 'bg-[#FFFBEB] dark:bg-[#451A03] border-[#FDE68A] text-[#D97706]'
                        }`}
                      >
                        <ChoreIcon icon={a.chore_icon} className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                            {a.chore_title}
                          </h3>
                          {isDone && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#059669] dark:text-[#34D399]">
                              <CheckCircle2 className="w-3 h-3" />
                              Xong
                            </span>
                          )}
                          {isMissed && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#DC2626]">
                              <AlertCircle className="w-3 h-3" />
                              Quá hạn
                            </span>
                          )}
                          {isSwappedToMe && (
                            <span className="px-1.5 py-0.5 rounded bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] text-[10px] font-bold">
                              Làm hộ
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] flex items-center gap-1 tabular-nums truncate">
                          <CalendarClock className="w-3 h-3 shrink-0" />
                          {describeAssignmentSchedule(a)}
                          {a.bonus_amount > 0 && (
                            <span className="text-[#059669] font-semibold">
                              • +{a.bonus_amount.toLocaleString('vi-VN')}đ
                            </span>
                          )}
                          {a.penalty_amount > 0 && (
                            <span className="text-[#DC2626] font-semibold">
                              • -{a.penalty_amount.toLocaleString('vi-VN')}đ
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        haptic(10);
                        setDetailTarget({ kind: 'assigned', assignment: a, chore: linkedChore });
                      }}
                      aria-label={`Tùy chọn ${a.chore_title}`}
                      className="w-10 h-10 rounded-xl hover:bg-[#F3F4F6] dark:hover:bg-[#0F172A] flex items-center justify-center text-[#6B7280] dark:text-[#94A3B8] shrink-0"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>

                  {isDone ? (
                    <div className="flex items-center justify-between rounded-xl bg-[#ECFDF5]/60 dark:bg-[#064E3B]/30 px-3 py-2 text-xs text-[#047857] dark:text-[#6EE7B7] tabular-nums">
                      <span>Đã nộp ảnh xác thực</span>
                      <span className="font-semibold">
                        {a.completed_at_iso ? formatRelativeVi(a.completed_at_iso, tickMs) : 'Xong'}
                      </span>
                    </div>
                  ) : isMissed ? (
                    <div className="rounded-xl bg-[#FEF2F2] dark:bg-[#450A0A] px-3 py-2 text-xs text-[#B91C1C] dark:text-[#FCA5A5] font-medium">
                      Đã quá hạn &amp; trừ quỹ tuần.
                    </div>
                  ) : isPending && linkedChore ? (
                    <div className="space-y-1.5">
                      {linkedChore.require_before_after ? (
                        !session ? (
                          <button
                            type="button"
                            onClick={() =>
                              onStartCapture({ chore: linkedChore, assignedChore: a, phase: 'before' })
                            }
                            className="w-full h-11 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white font-semibold text-sm flex items-center justify-center gap-2"
                          >
                            <Play className="w-4 h-4" />
                            Chụp Trước
                          </button>
                        ) : unlockRemainMs > 0 ? (
                          <div className="flex gap-2">
                            <div className="flex-1 h-11 rounded-xl bg-[#FEF3C7] dark:bg-[#451A03] text-[#B45309] dark:text-[#FCD34D] text-xs font-bold flex items-center justify-center gap-1.5 tabular-nums">
                              <Timer className="w-4 h-4" />
                              Chờ {formatCountdown(unlockRemainMs)}
                            </div>
                            <button
                              type="button"
                              onClick={() => cancelSession(session.id)}
                              aria-label="Huỷ phiên"
                              className="w-11 h-11 rounded-xl border border-[#E5E7EB] dark:border-[#334155] flex items-center justify-center text-[#DC2626]"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              onStartCapture({
                                chore: linkedChore,
                                assignedChore: a,
                                phase: 'after',
                                sessionId: session.id,
                              })
                            }
                            className="w-full h-11 rounded-xl bg-[#059669] hover:bg-[#047857] text-white font-semibold text-sm flex items-center justify-center gap-2"
                          >
                            <Camera className="w-4 h-4" />
                            Chụp hoàn thành
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            onStartCapture({ chore: linkedChore, assignedChore: a, phase: 'single' })
                          }
                          className="w-full h-11 rounded-xl bg-[#059669] hover:bg-[#047857] text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition"
                        >
                          <Camera className="w-4 h-4" />
                          Chụp hoàn thành
                        </button>
                      )}

                      {isOpenSwapByMe && a.active_swap && (
                        <div className="flex items-center justify-between rounded-xl bg-[#FFFBEB] dark:bg-[#451A03]/40 px-3 py-1.5 text-[11px]">
                          <span className="text-[#B45309] dark:text-[#FCD34D] font-medium">
                            Đang chờ người nhận hộ...
                          </span>
                          <button
                            type="button"
                            onClick={() => respondSwap(a.active_swap!.id, 'cancel')}
                            className="font-semibold text-[#DC2626]"
                          >
                            Huỷ
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] px-1">
                      Chưa đến lịch hôm nay
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 2: General / Free-for-All Chores (Crisp Minimalist Cards) */}
      <section className="space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-0.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#6B7280] dark:text-[#94A3B8]">
            Việc chung ({filteredChores.length})
          </h2>

          {featureFlags.recurring_tasks && (
            <div className="flex items-center gap-1.5 overflow-x-auto">
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
                      : 'bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] text-[#6B7280] dark:text-[#94A3B8]'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {filteredChores.length === 0 ? (
          <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-6 text-center">
            <Sparkles className="w-6 h-6 text-[#059669] mx-auto mb-1.5" />
            <p className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC]">
              Đã hoàn thành hết mục này
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {filteredChores.map((chore) => {
              const latest = latestLogByChore.get(chore.id);
              const cooldownMs = Math.max(0, chore.cooldown_minutes) * 60_000;
              const lastMs = latest ? Date.parse(latest.server_timestamp) : 0;
              const remainMs = latest && cooldownMs > 0 ? Math.max(0, lastMs + cooldownMs - tickMs) : 0;
              const onCooldown = remainMs > 0;
              const doneThisPeriod = isCompletedInCurrentPeriod(chore, latest);

              const session = findActiveSession(chore.id, null);
              const unlockRemainMs = session ? Math.max(0, Date.parse(session.unlock_at) - tickMs) : 0;

              const freqText =
                chore.frequency === 'daily'
                  ? 'Hàng ngày'
                  : chore.frequency === 'weekly'
                    ? 'Hàng tuần'
                    : 'Tự do';

              return (
                <div
                  key={chore.id}
                  className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-3.5 space-y-3 flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
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
                          <h3 className="text-[15px] font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                            {chore.title}
                          </h3>
                          {doneThisPeriod && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#059669] dark:text-[#34D399] shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] truncate tabular-nums">
                          {latest
                            ? `Gần nhất: ${latest.member_name} • ${formatRelativeVi(latest.server_timestamp, tickMs)}`
                            : `${freqText}${chore.cooldown_minutes > 0 ? ` • Chờ ${chore.cooldown_minutes}p` : ''}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {latest && (
                        <button
                          type="button"
                          onClick={() => onInspectPhoto(latest)}
                          aria-label={`Xem ảnh ${chore.title}`}
                          className="relative w-10 h-10 rounded-lg overflow-hidden border border-[#E5E7EB] dark:border-[#334155] shrink-0 active:scale-95 transition"
                        >
                          <ProtectedImage
                            src={latest.thumb_url || latest.proof_url}
                            alt={chore.title}
                            className="w-full h-full"
                          />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          haptic(10);
                          setDetailTarget({ kind: 'chore', chore, latest });
                        }}
                        aria-label={`Chi tiết ${chore.title}`}
                        className="w-10 h-10 rounded-xl hover:bg-[#F3F4F6] dark:hover:bg-[#0F172A] flex items-center justify-center text-[#6B7280] dark:text-[#94A3B8]"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {onCooldown ? (
                    <div className="w-full h-11 rounded-xl bg-[#FEF3C7] dark:bg-[#451A03] border border-[#FDE68A] dark:border-[#92400E] text-[#B45309] dark:text-[#FCD34D] text-xs font-bold flex items-center justify-center gap-1.5 tabular-nums">
                      <Clock className="w-4 h-4" />
                      Chờ {formatCountdown(remainMs)}
                    </div>
                  ) : chore.require_before_after ? (
                    !session ? (
                      <button
                        type="button"
                        onClick={() => onStartCapture({ chore, assignedChore: null, phase: 'before' })}
                        className="w-full h-11 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition"
                      >
                        <Play className="w-4 h-4" />
                        Chụp Trước (Before)
                      </button>
                    ) : unlockRemainMs > 0 ? (
                      <div className="flex gap-2">
                        <div className="flex-1 h-11 rounded-xl bg-[#FEF3C7] dark:bg-[#451A03] border border-[#FDE68A] text-[#B45309] dark:text-[#FCD34D] text-xs font-bold flex items-center justify-center gap-1.5 tabular-nums">
                          <Timer className="w-4 h-4" />
                          Mở khóa sau {formatCountdown(unlockRemainMs)}
                        </div>
                        <button
                          type="button"
                          onClick={() => cancelSession(session.id)}
                          aria-label="Huỷ phiên"
                          className="w-11 h-11 rounded-xl border border-[#E5E7EB] dark:border-[#334155] flex items-center justify-center text-[#DC2626]"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          onStartCapture({
                            chore,
                            assignedChore: null,
                            phase: 'after',
                            sessionId: session.id,
                          })
                        }
                        className="w-full h-11 rounded-xl bg-[#059669] hover:bg-[#047857] text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition"
                      >
                        <Camera className="w-4 h-4" />
                        Chụp hoàn thành
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={() => onStartCapture({ chore, assignedChore: null, phase: 'single' })}
                      className="w-full h-11 rounded-xl bg-[#059669] hover:bg-[#047857] text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition"
                    >
                      <Camera className="w-4 h-4" />
                      Chụp hoàn thành
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Compact Chore Details / Actions Sheet (•••) */}
      {detailTarget && (
        <div
          onClick={() => setDetailTarget(null)}
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center pt-[calc(env(safe-area-inset-top,20px)+12px)] md:p-4 bg-black/55 backdrop-blur-[2px]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white dark:bg-[#0B1215] border-t md:border border-[#E5E7EB] dark:border-[#334155] rounded-t-3xl md:rounded-2xl px-5 pt-4 pb-[max(1.75rem,env(safe-area-inset-bottom))] md:p-5 shadow-2xl space-y-4 max-h-full overflow-y-auto"
          >
            <div className="w-10 h-1 rounded-full bg-[#D1D5DB] dark:bg-[#475569] mx-auto -mt-1 md:hidden" />

            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#059669]">
                  {detailTarget.kind === 'assigned' ? 'Nhiệm vụ được giao' : 'Chi tiết đầu việc'}
                </p>
                <h3 className="text-lg font-bold text-[#111827] dark:text-[#F8FAFC] mt-0.5">
                  {detailTarget.kind === 'assigned'
                    ? detailTarget.assignment.chore_title
                    : detailTarget.chore.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailTarget(null)}
                aria-label="Đóng"
                className="w-11 h-11 rounded-full bg-[#F3F4F6] dark:bg-[#1E293B] flex items-center justify-center text-[#374151] dark:text-[#F8FAFC] shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-xl bg-[#F8F9FA] dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#334155] p-3.5 space-y-2 text-xs">
              {detailTarget.chore && (
                <>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280] dark:text-[#94A3B8]">Xác thực ảnh</span>
                    <span className="font-semibold inline-flex items-center gap-1">
                      {detailTarget.chore.require_before_after ? (
                        <>
                          <Columns2 className="w-3.5 h-3.5 text-[#D97706]" />
                          Trước &amp; Sau (tối thiểu {detailTarget.chore.min_duration_minutes}p)
                        </>
                      ) : (
                        '1 ảnh hoàn thành'
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between tabular-nums">
                    <span className="text-[#6B7280] dark:text-[#94A3B8]">Thời gian chờ</span>
                    <span className="font-semibold">{detailTarget.chore.cooldown_minutes} phút</span>
                  </div>
                  {featureFlags.gamification && (
                    <div className="flex justify-between tabular-nums">
                      <span className="text-[#6B7280] dark:text-[#94A3B8]">Điểm thưởng</span>
                      <span className="font-bold text-[#059669]">+{detailTarget.chore.points} điểm</span>
                    </div>
                  )}
                </>
              )}

              {detailTarget.kind === 'assigned' && (
                <>
                  <div className="flex justify-between tabular-nums">
                    <span className="text-[#6B7280] dark:text-[#94A3B8]">Giao bởi</span>
                    <span className="font-semibold">{detailTarget.assignment.assigned_by_name}</span>
                  </div>
                  {detailTarget.assignment.bonus_amount > 0 && (
                    <div className="flex justify-between tabular-nums">
                      <span className="text-[#6B7280] dark:text-[#94A3B8]">Thưởng đúng hạn</span>
                      <span className="font-bold text-[#059669]">
                        +{detailTarget.assignment.bonus_amount.toLocaleString('vi-VN')}đ
                      </span>
                    </div>
                  )}
                  {detailTarget.assignment.penalty_amount > 0 && (
                    <div className="flex justify-between tabular-nums">
                      <span className="text-[#6B7280] dark:text-[#94A3B8]">Phạt trễ hạn</span>
                      <span className="font-bold text-[#DC2626]">
                        -{detailTarget.assignment.penalty_amount.toLocaleString('vi-VN')}đ
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="space-y-2">
              {detailTarget.latest && (
                <button
                  type="button"
                  onClick={() => {
                    const log = detailTarget.latest!;
                    setDetailTarget(null);
                    onInspectPhoto(log);
                  }}
                  className="w-full h-11 rounded-xl border border-[#E5E7EB] dark:border-[#334155] text-sm font-semibold flex items-center justify-center gap-2"
                >
                  <Eye className="w-4 h-4 text-[#059669]" />
                  Xem ảnh hoàn thành gần nhất
                </button>
              )}

              {detailTarget.kind === 'chore' &&
                detailTarget.latest &&
                canAwardBonus &&
                onAwardBonus &&
                detailTarget.latest.profile_id !== me.id && (
                  <button
                    type="button"
                    onClick={() => {
                      const l = detailTarget.latest!;
                      setDetailTarget(null);
                      onAwardBonus({
                        logId: l.id,
                        recipientId: l.profile_id,
                        recipientName: l.member_name,
                        defaultNote: l.chore_title,
                      });
                    }}
                    className="w-full h-11 rounded-xl bg-gradient-to-r from-[#059669] to-[#D97706] text-white text-sm font-bold flex items-center justify-center gap-2"
                  >
                    <Gift className="w-4 h-4" />
                    Tặng thưởng lượt làm gần nhất ({detailTarget.latest.member_name})
                  </button>
                )}

              {detailTarget.kind === 'assigned' &&
                detailTarget.assignment.cycle_status === 'pending' &&
                !(
                  detailTarget.assignment.active_swap?.status === 'accepted' &&
                  detailTarget.assignment.active_swap.accepted_by === me.id
                ) &&
                !(
                  detailTarget.assignment.active_swap?.status === 'open' &&
                  detailTarget.assignment.active_swap.requester_id === me.id
                ) && (
                  <button
                    type="button"
                    onClick={() => {
                      const a = detailTarget.assignment;
                      setDetailTarget(null);
                      onOpenSwapSheet(a);
                    }}
                    className="w-full h-11 rounded-xl bg-[#FFFBEB] dark:bg-[#451A03] border border-[#FDE68A] dark:border-[#92400E] text-[#B45309] dark:text-[#FCD34D] text-sm font-bold flex items-center justify-center gap-2"
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                    Nhờ làm hộ (Chuyển ca)
                  </button>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
