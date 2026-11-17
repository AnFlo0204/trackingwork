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
  HandHelping,
  PartyPopper,
  Play,
  Sparkles,
  Timer,
  Wallet,
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
import { ChoreIcon, getInitials } from './ChoreIcon';
import type { CaptureTarget } from './CameraCaptureSheet';

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
  onStartCapture: (target: CaptureTarget) => void;
  onInspectPhoto: (log: ChoreLogItem) => void;
  onOpenWallet: () => void;
  onOpenSwapSheet: (assignment: AssignedChoreItem) => void;
  onRefresh: () => Promise<void>;
}

type FilterKey = 'all' | 'pending' | 'daily' | 'weekly';

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
  if (a.schedule_type === 'daily') return `Hạn hôm nay: ${a.due_time}`;
  if (a.schedule_type === 'once') {
    const d = a.due_date ? a.due_date.split('-').reverse().join('/') : '';
    return `Hạn ${d} lúc ${a.due_time}`;
  }
  const days = a.days_of_week.map((d) => DAY_LABELS[d]).filter(Boolean).join(', ');
  return `Lịch ${days} • Hạn ${a.due_time}`;
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
  onStartCapture,
  onInspectPhoto,
  onOpenWallet,
  onOpenSwapSheet,
  onRefresh,
}: ChoreBoardProps) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [tickMs, setTickMs] = useState(() => Date.parse(serverNowIso) || Date.now());
  const [busySwapId, setBusySwapId] = useState<string | null>(null);

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

  // Open shift swaps visible to me (not requested by me, targeted to me or open board)
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

  const latestPenaltyContributions = useMemo(
    () => fundTransactions.filter((tx) => tx.tx_type === 'penalty').slice(0, 2),
    [fundTransactions],
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

  async function respondSwap(swapId: string, action: 'accept' | 'cancel') {
    setBusySwapId(swapId);
    haptic(15);
    try {
      await fetch('/api/swaps', {
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
    await fetch(`/api/chores/start?sessionId=${encodeURIComponent(sessionId)}`, {
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

  return (
    <div className="space-y-4">
      {/* Shared Party Fund Banner ("Quỹ Liên Hoan Chung") */}
      {sharedPartyFund.show_banner && (
        <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-3.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#FFFBEB] dark:bg-[#451A03] text-[#D97706] flex items-center justify-center shrink-0">
                <PartyPopper className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#B45309] dark:text-[#FCD34D]">
                  Quỹ Liên Hoan Chung
                </p>
                <p className="text-base font-bold text-[#111827] dark:text-[#F8FAFC] tabular-nums">
                  {sharedPartyFund.balance.toLocaleString('vi-VN')}đ
                </p>
              </div>
            </div>
            <span className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] text-right">
              Góp từ các khoản phạt trễ
            </span>
          </div>
          {latestPenaltyContributions.length > 0 && (
            <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] truncate tabular-nums">
              Gần đây:{' '}
              {latestPenaltyContributions
                .map((p) => `${p.member_name} (${Math.abs(p.amount).toLocaleString('vi-VN')}đ)`)
                .join(' • ')}
            </p>
          )}
        </div>
      )}

      {/* Compact Weekly Fund Wallet Card */}
      {weeklyFundConfig.enabled && (
        <button
          type="button"
          onClick={() => {
            haptic(10);
            onOpenWallet();
          }}
          className="w-full text-left bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-3.5 space-y-2 active:scale-[0.99] transition"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399] flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280] dark:text-[#94A3B8]">
                  Ví quỹ tuần
                </p>
                <p className="text-base font-bold text-[#111827] dark:text-[#F8FAFC] tabular-nums truncate">
                  {me.current_balance.toLocaleString('vi-VN')}đ
                  <span className="text-xs font-medium text-[#6B7280] dark:text-[#94A3B8]">
                    {' '}
                    / {me.weekly_allowance.toLocaleString('vi-VN')}đ
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 text-xs font-semibold text-[#059669] dark:text-[#34D399] shrink-0">
              Lịch sử
              <ChevronRight className="w-4 h-4" />
            </div>
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
      )}

      {/* Open Shift Swaps & Bounty Requests */}
      {openSwapsForMe.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#D97706] px-0.5 flex items-center gap-1.5">
            <HandHelping className="w-3.5 h-3.5" />
            Kèo nhờ làm hộ ({openSwapsForMe.length})
          </h2>
          {openSwapsForMe.map((sw) => (
            <div
              key={sw.id}
              className="bg-[#FFFBEB] dark:bg-[#451A03]/40 border border-[#FDE68A] dark:border-[#92400E] rounded-2xl p-3.5 flex items-center justify-between gap-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                  {sw.chore_title} •{' '}
                  <span className="text-[#B45309] dark:text-[#FCD34D]">
                    {sw.requester_name} nhờ
                  </span>
                </p>
                <p className="text-xs text-[#6B7280] dark:text-[#CBD5E1] tabular-nums">
                  Hạn {sw.due_time}
                  {sw.bounty_amount > 0 && (
                    <span className="font-bold text-[#059669] dark:text-[#34D399]">
                      {' '}
                      • Thưởng +{sw.bounty_amount.toLocaleString('vi-VN')}đ
                    </span>
                  )}
                </p>
                {sw.note && <p className="text-[11px] text-[#6B7280] italic mt-0.5">{sw.note}</p>}
              </div>

              <button
                type="button"
                disabled={busySwapId === sw.id}
                onClick={() => respondSwap(sw.id, 'accept')}
                className="h-11 px-3.5 rounded-xl bg-[#059669] text-white text-xs font-bold shrink-0"
              >
                {busySwapId === sw.id ? 'Đang nhận...' : 'Nhận ca'}
              </button>
            </div>
          ))}
        </section>
      )}

      {/* Section 1: My Assigned Chores */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-[#F8FAFC]">
            Việc được giao cho bạn ({myAssignments.length})
          </h2>
          {myAssignments.some((a) => a.cycle_status === 'pending') && (
            <span className="text-[11px] font-semibold text-[#D97706] tabular-nums">
              {myAssignments.filter((a) => a.cycle_status === 'pending').length} việc cần làm
            </span>
          )}
        </div>

        {myAssignments.length === 0 ? (
          <div className="bg-white dark:bg-[#1E293B] border border-dashed border-[#D1D5DB] dark:border-[#334155] rounded-2xl px-4 py-3.5 text-xs text-[#6B7280] dark:text-[#94A3B8]">
            Hiện chưa có việc riêng nào được phân công trực tiếp cho bạn.
          </div>
        ) : (
          <div className="space-y-2.5">
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
                  className={`bg-white dark:bg-[#1E293B] rounded-2xl p-4 space-y-3 border ${
                    isMissed
                      ? 'border-[#FCA5A5] dark:border-[#991B1B]'
                      : isDone
                        ? 'border-[#A7F3D0] dark:border-[#047857]'
                        : 'border-[#FCD34D] dark:border-[#B45309]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${
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
                          <h3 className="text-base font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                            {a.chore_title}
                          </h3>
                          {isSwappedToMe && (
                            <span className="px-2 py-0.5 rounded-md bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] text-[10px] font-bold">
                              Nhận làm hộ
                              {a.active_swap?.bounty_amount
                                ? ` +${a.active_swap.bounty_amount.toLocaleString('vi-VN')}đ`
                                : ''}
                            </span>
                          )}
                          {isDone && (
                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399] text-[11px] font-bold">
                              <CheckCircle2 className="w-3 h-3" />
                              Đã hoàn thành
                            </span>
                          )}
                          {isMissed && (
                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-[#FEF2F2] dark:bg-[#450A0A] text-[#DC2626] dark:text-[#FCA5A5] text-[11px] font-bold">
                              <AlertCircle className="w-3 h-3" />
                              Thiếu sót / Quá hạn
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] flex items-center gap-1 mt-0.5 tabular-nums">
                          <CalendarClock className="w-3.5 h-3.5 shrink-0" />
                          {describeAssignmentSchedule(a)}
                        </p>
                      </div>
                    </div>

                    {a.penalty_amount > 0 && (
                      <span className="shrink-0 px-2 py-1 rounded-lg bg-[#FEF2F2] dark:bg-[#450A0A] text-[#DC2626] dark:text-[#FCA5A5] text-[11px] font-bold tabular-nums">
                        Phạt -{a.penalty_amount.toLocaleString('vi-VN')}đ
                      </span>
                    )}
                  </div>

                  {isDone && a.completed_proof_url ? (
                    <div className="flex items-center justify-between rounded-xl bg-[#ECFDF5]/60 dark:bg-[#064E3B]/30 border border-[#A7F3D0]/70 dark:border-[#047857] px-3 py-2 text-xs text-[#047857] dark:text-[#6EE7B7]">
                      <span>Giao bởi {a.assigned_by_name} • Đã nộp ảnh xác thực</span>
                      <span className="font-semibold tabular-nums">
                        {a.completed_at_iso ? formatRelativeVi(a.completed_at_iso, tickMs) : 'Xong'}
                      </span>
                    </div>
                  ) : isMissed ? (
                    <div className="rounded-xl bg-[#FEF2F2] dark:bg-[#450A0A] px-3 py-2.5 text-xs text-[#B91C1C] dark:text-[#FCA5A5] font-medium">
                      Đã quá hạn chu kỳ hiện tại và hệ thống đã ghi nhận trừ vào ví quỹ tuần.
                    </div>
                  ) : isPending && linkedChore ? (
                    <div className="space-y-2">
                      {linkedChore.require_before_after ? (
                        !session ? (
                          <button
                            type="button"
                            onClick={() =>
                              onStartCapture({ chore: linkedChore, assignedChore: a, phase: 'before' })
                            }
                            className="w-full h-12 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white font-semibold text-sm flex items-center justify-center gap-2"
                          >
                            <Play className="w-4 h-4" />
                            Bắt đầu làm (Chụp Trước)
                          </button>
                        ) : unlockRemainMs > 0 ? (
                          <div className="flex gap-2">
                            <div className="flex-1 h-12 rounded-xl bg-[#FEF3C7] dark:bg-[#451A03] border border-[#FDE68A] text-[#B45309] dark:text-[#FCD34D] text-xs font-bold flex items-center justify-center gap-1.5 tabular-nums">
                              <Timer className="w-4 h-4" />
                              Đang làm • Mở khóa sau {formatCountdown(unlockRemainMs)}
                            </div>
                            <button
                              type="button"
                              onClick={() => cancelSession(session.id)}
                              aria-label="Huỷ phiên"
                              className="w-12 h-12 rounded-xl border border-[#E5E7EB] dark:border-[#334155] flex items-center justify-center text-[#DC2626]"
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
                            className="w-full h-12 rounded-xl bg-[#059669] hover:bg-[#047857] text-white font-semibold text-sm flex items-center justify-center gap-2"
                          >
                            <Camera className="w-4 h-4" />
                            Chụp ảnh Sau & Hoàn thành
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            onStartCapture({ chore: linkedChore, assignedChore: a, phase: 'single' })
                          }
                          className="w-full h-12 rounded-xl bg-[#059669] hover:bg-[#047857] text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition"
                        >
                          <Camera className="w-4 h-4" />
                          Hoàn thành việc được giao
                        </button>
                      )}

                      {!isSwappedToMe && (
                        isOpenSwapByMe && a.active_swap ? (
                          <div className="flex items-center justify-between rounded-xl bg-[#FFFBEB] dark:bg-[#451A03]/40 px-3 py-2 text-xs">
                            <span className="text-[#B45309] dark:text-[#FCD34D] font-medium">
                              Đang chờ người nhận làm hộ...
                            </span>
                            <button
                              type="button"
                              onClick={() => respondSwap(a.active_swap!.id, 'cancel')}
                              className="font-semibold text-[#DC2626]"
                            >
                              Huỷ nhờ
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              haptic(10);
                              onOpenSwapSheet(a);
                            }}
                            className="w-full h-10 rounded-xl border border-[#E5E7EB] dark:border-[#334155] text-xs font-semibold text-[#374151] dark:text-[#CBD5E1] flex items-center justify-center gap-1.5"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5 text-[#D97706]" />
                            Nhờ làm hộ (Chuyển ca)
                          </button>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-[#F8F9FA] dark:bg-[#0F172A] px-3 py-2 text-xs text-[#6B7280] dark:text-[#94A3B8]">
                      Hôm nay chưa đến lịch thực hiện nhiệm vụ này.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 2: General / Free-for-All Chores */}
      <section className="space-y-3 pt-1">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#6B7280] dark:text-[#94A3B8]">
            Việc chung ({filteredChores.length})
          </h2>
        </div>

        {featureFlags.recurring_tasks && recurringSummary.total > 0 && (
          <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-[#6B7280] dark:text-[#94A3B8] uppercase tracking-wide">
                  Tiến độ việc chung định kỳ
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

              const session = findActiveSession(chore.id, null);
              const unlockRemainMs = session ? Math.max(0, Date.parse(session.unlock_at) - tickMs) : 0;

              return (
                <div
                  key={chore.id}
                  className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-3"
                >
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
                          {chore.require_before_after && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#F3F4F6] dark:bg-[#0F172A] text-[#374151] dark:text-[#CBD5E1] text-[10px] font-semibold">
                              <Columns2 className="w-3 h-3" />
                              Trước/Sau
                              {chore.min_duration_minutes > 0 ? ` • ${chore.min_duration_minutes}p` : ''}
                            </span>
                          )}
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
                        className="relative w-10 h-10 rounded-lg overflow-hidden border border-[#E5E7EB] dark:border-[#334155] shrink-0 active:scale-95 transition"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={latest.thumb_url || latest.proof_url}
                          alt="Ảnh xác thực"
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                        {latest.before_proof_url && (
                          <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[8px] font-bold text-white text-center leading-tight">
                            2 ẢNH
                          </span>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-[#F8F9FA] dark:bg-[#0F172A] border border-dashed border-[#E5E7EB] dark:border-[#334155] px-3 py-2 text-xs text-[#6B7280] dark:text-[#94A3B8]">
                      Chưa có lượt hoàn thành nào được ghi nhận
                    </div>
                  )}

                  {onCooldown ? (
                    <div className="w-full h-12 rounded-xl bg-[#FEF3C7] dark:bg-[#451A03] border border-[#FDE68A] dark:border-[#92400E] text-[#B45309] dark:text-[#FCD34D] text-sm font-semibold flex items-center justify-center gap-2 tabular-nums">
                      <Clock className="w-4 h-4" />
                      Vừa hoàn thành • Chờ {formatCountdown(remainMs)}
                    </div>
                  ) : chore.require_before_after ? (
                    !session ? (
                      <button
                        type="button"
                        onClick={() => onStartCapture({ chore, assignedChore: null, phase: 'before' })}
                        className="w-full h-12 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition"
                      >
                        <Play className="w-4 h-4" />
                        Bắt đầu làm (Chụp Trước)
                      </button>
                    ) : unlockRemainMs > 0 ? (
                      <div className="flex gap-2">
                        <div className="flex-1 h-12 rounded-xl bg-[#FEF3C7] dark:bg-[#451A03] border border-[#FDE68A] text-[#B45309] dark:text-[#FCD34D] text-xs font-bold flex items-center justify-center gap-1.5 tabular-nums">
                          <Timer className="w-4 h-4" />
                          Đang làm • Mở khóa sau {formatCountdown(unlockRemainMs)}
                        </div>
                        <button
                          type="button"
                          onClick={() => cancelSession(session.id)}
                          aria-label="Huỷ phiên"
                          className="w-12 h-12 rounded-xl border border-[#E5E7EB] dark:border-[#334155] flex items-center justify-center text-[#DC2626]"
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
                        className="w-full h-12 rounded-xl bg-[#059669] hover:bg-[#047857] text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition"
                      >
                        <Camera className="w-4 h-4" />
                        Chụp ảnh Sau & Hoàn thành
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={() => onStartCapture({ chore, assignedChore: null, phase: 'single' })}
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
      </section>
    </div>
  );
}
