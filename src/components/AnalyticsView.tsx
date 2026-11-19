'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Coins,
  Plus,
  Trash2,
  Wallet,
} from 'lucide-react';
import type {
  Chore,
  ChoreLogItem,
  FeatureFlags,
  PenaltyItem,
  ProfilePublic,
  SharedPartyFund,
  WeeklyFundConfig,
  WeeklySettlementRow,
} from '@/lib/types';
import { formatIsoToVn, getVnPeriodBounds } from '@/lib/time';
import { signedFetch } from '@/lib/requestSigner';
import { MemberAvatar } from './MemberAvatar';

interface AnalyticsViewProps {
  chores: Chore[];
  logs: ChoreLogItem[];
  members: ProfilePublic[];
  penalties: PenaltyItem[];
  weeklySettlement: WeeklySettlementRow[];
  sharedPartyFund: SharedPartyFund;
  weeklyFundConfig: WeeklyFundConfig;
  featureFlags: FeatureFlags;
  serverNowIso: string;
  isAdmin: boolean;
  meId: string;
  onRefresh: () => Promise<void>;
}

const CHART_PALETTE = [
  '#059669',
  '#0284C7',
  '#D97706',
  '#4F46E5',
  '#0D9488',
  '#DC2626',
  '#65A30D',
  '#9333EA',
  '#EA580C',
  '#475569',
];

function formatCompactK(amount: number): string {
  const abs = Math.abs(Math.round(amount));
  if (abs >= 1000 && abs % 1000 === 0) {
    return `${abs / 1000}k`;
  }
  return `${abs.toLocaleString('vi-VN')}đ`;
}

export function AnalyticsView({
  chores,
  logs,
  members,
  penalties,
  weeklySettlement,
  sharedPartyFund,
  weeklyFundConfig,
  featureFlags,
  serverNowIso,
  isAdmin,
  meId,
  onRefresh,
}: AnalyticsViewProps) {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [penaltyFormOpen, setPenaltyFormOpen] = useState(false);
  const [penProfileId, setPenProfileId] = useState('');
  const [penChoreId, setPenChoreId] = useState('');
  const [penAmount, setPenAmount] = useState('20000');
  const [penReason, setPenReason] = useState('');
  const [submittingPenalty, setSubmittingPenalty] = useState(false);

  const serverNowMs = Date.parse(serverNowIso) || Date.now();
  const { startOfDayUtcMs, startOfWeekUtcMs } = useMemo(
    () => getVnPeriodBounds(serverNowMs),
    [serverNowMs],
  );

  const memberStats = useMemo(() => {
    const activeProfiles = members.filter(
      (m) => m.role === 'member' || logs.some((l) => l.profile_id === m.id),
    );
    const chorePointsMap = new Map(chores.map((c) => [c.id, Number(c.points || 0)]));
    const settlementMap = new Map(weeklySettlement.map((s) => [s.profile_id, s]));
    const map = new Map<
      string,
      { profile: ProfilePublic; count: number; points: number; bonusVnd: number }
    >();

    for (const p of activeProfiles) {
      const sRow = settlementMap.get(p.id);
      map.set(p.id, {
        profile: p,
        count: 0,
        points: 0,
        bonusVnd: sRow ? Number(sRow.total_bounty_earned || 0) : 0,
      });
    }

    for (const log of logs) {
      const existing = map.get(log.profile_id);
      if (existing) {
        const earned =
          Number(log.points_earned ?? 0) > 0
            ? Number(log.points_earned)
            : Number(log.points_awarded || 0) > 0
              ? Number(log.points_awarded)
              : chorePointsMap.get(log.chore_id) || 0;
        existing.count += 1;
        existing.points += earned;
        existing.bonusVnd += Number(log.bonus_awarded || 0);
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return b.count - a.count;
    });
  }, [members, logs, chores, weeklySettlement]);

  const choreStats = useMemo(() => {
    const map = new Map<string, { title: string; count: number }>();
    for (const log of logs) {
      const prev = map.get(log.chore_id) || { title: log.chore_title, count: 0 };
      prev.count += 1;
      map.set(log.chore_id, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [logs]);

  const missedDuties = useMemo(() => {
    if (!featureFlags.penalty_fund) return [];
    return chores
      .filter((c) => c.is_active && (c.frequency === 'daily' || c.frequency === 'weekly'))
      .filter((c) => {
        const threshold = c.frequency === 'daily' ? startOfDayUtcMs : startOfWeekUtcMs;
        return !logs.some((l) => l.chore_id === c.id && Date.parse(l.server_timestamp) >= threshold);
      });
  }, [chores, logs, featureFlags.penalty_fund, startOfDayUtcMs, startOfWeekUtcMs]);

  const totalLogs = logs.length;
  const maxChoreCount = Math.max(1, ...choreStats.map((c) => c.count));

  const donutSegments = useMemo(() => {
    const contributors = memberStats.filter((m) => m.count > 0);
    if (contributors.length === 0) return [];
    const total = contributors.reduce((s, m) => s + m.count, 0);
    const radius = 44;
    const circumference = 2 * Math.PI * radius;
    let cumulative = 0;

    return contributors.map((item, idx) => {
      const frac = item.count / total;
      const dash = frac * circumference;
      const offset = -cumulative * circumference;
      cumulative += frac;
      return {
        id: item.profile.id,
        name: item.profile.display_name,
        count: item.count,
        percent: Math.round(frac * 100),
        color: CHART_PALETTE[idx % CHART_PALETTE.length],
        dashArray: `${dash} ${circumference - dash}`,
        dashOffset: offset,
      };
    });
  }, [memberStats]);

  const fundSummary = useMemo(() => {
    let unpaid = 0;
    let paid = 0;
    for (const p of penalties) {
      if (p.status === 'paid') paid += p.amount;
      else unpaid += p.amount;
    }
    return { unpaid, paid, total: unpaid + paid };
  }, [penalties]);

  async function handleAddPenalty(e: FormEvent) {
    e.preventDefault();
    if (!penProfileId || !penReason.trim()) return;
    setSubmittingPenalty(true);
    try {
      const res = await signedFetch('/api/admin/penalties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: penProfileId,
          chore_id: penChoreId || null,
          amount: Number(penAmount || 20000),
          reason: penReason.trim(),
        }),
      });
      if (res.ok) {
        setPenReason('');
        setPenaltyFormOpen(false);
        await onRefresh();
      }
    } finally {
      setSubmittingPenalty(false);
    }
  }

  async function togglePenaltyPaid(item: PenaltyItem) {
    await signedFetch('/api/admin/penalties', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: item.id,
        status: item.status === 'paid' ? 'unpaid' : 'paid',
      }),
    });
    await onRefresh();
  }

  async function deletePenalty(id: string) {
    await signedFetch(`/api/admin/penalties?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await onRefresh();
  }

  const nonAdminMembers = members.filter((m) => m.role === 'member');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {/* 1. Weekly Settlement — Single-Line Rows with Smart Delta Pills & Tap-to-Expand */}
      {weeklyFundConfig.enabled && (
        <section className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-2 pb-1">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-[#059669]" />
              <h2 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">Quỹ tuần</h2>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-[#FFFBEB] dark:bg-[#451A03] text-[11px] font-semibold text-[#B45309] dark:text-[#FCD34D] tabular-nums">
              Quỹ chung: {sharedPartyFund.balance.toLocaleString('vi-VN')}đ
            </span>
          </div>

          {weeklySettlement.length === 0 ? (
            <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] py-3">Trống</p>
          ) : (
            <div className="divide-y divide-[#F3F4F6] dark:divide-[#334155]">
              {weeklySettlement.map((row) => {
                const plusDelta =
                  (row.total_bonuses || 0) +
                  (row.total_bounty_earned || 0) +
                  (row.total_refunds || 0);
                const minusDelta =
                  (row.total_penalties || 0) + (row.total_bounty_paid || 0);
                const isExpanded = expandedRowId === row.profile_id;

                return (
                  <div key={row.profile_id} className="border-[#F3F4F6] dark:border-[#334155]">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedRowId((prev) => (prev === row.profile_id ? null : row.profile_id))
                      }
                      className="w-full py-3 flex items-center justify-between gap-2 text-left hover:bg-[#F8F9FA]/60 dark:hover:bg-[#0F172A]/40 -mx-1 px-1 rounded-lg transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <MemberAvatar
                          name={row.display_name}
                          avatarUrl={row.avatar_url}
                          size="md"
                        />
                        <p className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC] truncate">
                          {row.display_name}
                        </p>
                      </div>

                      {/* Middle Smart Delta Pills (hidden if 0đ) */}
                      <div className="flex items-center gap-1 shrink-0 tabular-nums">
                        {plusDelta > 0 && (
                          <span className="px-1.5 py-0.5 rounded-md bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399] text-[11px] font-bold">
                            +{formatCompactK(plusDelta)}
                          </span>
                        )}
                        {minusDelta > 0 && (
                          <span className="px-1.5 py-0.5 rounded-md bg-[#FEF2F2] dark:bg-[#450A0A] text-[#DC2626] dark:text-[#F87171] text-[11px] font-bold">
                            -{formatCompactK(minusDelta)}
                          </span>
                        )}
                      </div>

                      {/* Right Bold Net Payout */}
                      <div className="flex items-center gap-1 shrink-0 tabular-nums">
                        <span className="text-sm font-bold text-[#059669] dark:text-[#34D399]">
                          {row.current_balance.toLocaleString('vi-VN')}đ
                        </span>
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-[#9CA3AF] transition-transform ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="pb-2.5 pl-10 pr-1 text-[11px] text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
                        {row.weekly_allowance.toLocaleString('vi-VN')}đ
                        {plusDelta > 0 ? ` • +${formatCompactK(plusDelta)}` : ''}
                        {minusDelta > 0 ? ` • -${formatCompactK(minusDelta)}` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* 2. Leaderboard */}
      {featureFlags.gamification && (
        <section className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between pb-1">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-[#059669]" />
              <h2 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">Xếp hạng</h2>
            </div>
            <span className="text-xs text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
              {totalLogs} lượt
            </span>
          </div>

          {memberStats.length === 0 ? (
            <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] py-3">Trống</p>
          ) : (
            <div className="divide-y divide-[#F3F4F6] dark:divide-[#334155]">
              {memberStats.map((entry, idx) => {
                const isMe = entry.profile.id === meId;
                return (
                  <div
                    key={entry.profile.id}
                    className={`py-2.5 flex items-center justify-between gap-3 ${
                      isMe ? 'bg-[#ECFDF5]/60 dark:bg-[#064E3B]/25 -mx-2 px-2 rounded-xl' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-6 h-6 rounded-full text-xs font-bold tabular-nums flex items-center justify-center shrink-0 ${
                          idx === 0
                            ? 'bg-[#FEF3C7] text-[#B45309]'
                            : idx === 1
                              ? 'bg-[#E5E7EB] text-[#374151]'
                              : idx === 2
                                ? 'bg-[#FFEDD5] text-[#C2410C]'
                                : 'bg-[#F3F4F6] dark:bg-[#0F172A] text-[#6B7280] dark:text-[#94A3B8]'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <MemberAvatar
                        name={entry.profile.display_name}
                        avatarUrl={entry.profile.avatar_url}
                        size="md"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC] truncate">
                          {entry.profile.display_name}
                          {isMe && <span className="text-xs text-[#059669] ml-1">(Bạn)</span>}
                        </p>
                        <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
                          {entry.count} lần
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
                      {entry.bonusVnd > 0 && (
                        <span className="px-1.5 py-0.5 rounded-md bg-[#FFFBEB] dark:bg-[#451A03] text-[#B45309] dark:text-[#FCD34D] text-[11px] font-bold">
                          +{formatCompactK(entry.bonusVnd)}
                        </span>
                      )}
                      <span className="text-sm font-bold text-[#059669] dark:text-[#34D399]">
                        {entry.points > 0
                          ? `${entry.points} điểm`
                          : entry.bonusVnd > 0
                            ? `+${entry.bonusVnd.toLocaleString('vi-VN')}đ`
                            : `${entry.count} lần`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* 3. Visual Contribution Donut & Frequency */}
      {featureFlags.analytics && (
        <section className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#059669]" />
            <h2 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">Đóng góp</h2>
          </div>

          {donutSegments.length === 0 ? (
            <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] py-2">Trống</p>
          ) : (
            <div className="flex items-center gap-4">
              <div className="relative w-24 h-24 shrink-0">
                <svg viewBox="0 0 110 110" className="w-full h-full -rotate-90">
                  <circle
                    cx="55"
                    cy="55"
                    r="44"
                    fill="none"
                    stroke="currentColor"
                    className="text-[#F3F4F6] dark:text-[#0F172A]"
                    strokeWidth="14"
                  />
                  {donutSegments.map((seg) => (
                    <circle
                      key={seg.id}
                      cx="55"
                      cy="55"
                      r="44"
                      fill="none"
                      stroke={seg.color}
                      strokeWidth="14"
                      strokeDasharray={seg.dashArray}
                      strokeDashoffset={seg.dashOffset}
                    />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-base font-bold text-[#111827] dark:text-[#F8FAFC] tabular-nums leading-none">
                    {totalLogs}
                  </span>
                  <span className="text-[10px] text-[#6B7280] dark:text-[#94A3B8] mt-0.5">
                    Lượt
                  </span>
                </div>
              </div>

              <div className="flex-1 min-w-0 space-y-1.5">
                {donutSegments.map((seg) => (
                  <div key={seg.id} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: seg.color }}
                      />
                      <span className="truncate text-[#374151] dark:text-[#CBD5E1] font-medium">
                        {seg.name}
                      </span>
                    </div>
                    <span className="tabular-nums text-[#6B7280] dark:text-[#94A3B8] shrink-0">
                      {seg.count} ({seg.percent}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {choreStats.length > 0 && (
            <div className="pt-3 border-t border-[#F3F4F6] dark:border-[#334155] space-y-2.5">
              <p className="text-xs font-semibold text-[#6B7280] dark:text-[#94A3B8] uppercase tracking-wide">
                Theo việc
              </p>
              {choreStats.map((c) => (
                <div key={c.title} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#111827] dark:text-[#F8FAFC]">{c.title}</span>
                    <span className="tabular-nums text-[#6B7280] dark:text-[#94A3B8]">
                      {c.count}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#F3F4F6] dark:bg-[#0F172A] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#059669]"
                      style={{ width: `${Math.round((c.count / maxChoreCount) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 4. Penalty Tracker */}
      {featureFlags.penalty_fund && (
        <section className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-[#D97706]" />
              <h2 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">Quỹ phạt</h2>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setPenaltyFormOpen((o) => !o)}
                className="h-8 px-2.5 rounded-lg bg-[#FEF3C7] dark:bg-[#451A03] text-[#B45309] dark:text-[#FCD34D] text-xs font-semibold inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Ghi phạt
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
            <div className="rounded-xl bg-[#FEF3C7]/60 dark:bg-[#451A03]/40 px-3 py-2 flex items-center justify-between">
              <span className="text-[#B45309] dark:text-[#FCD34D]">Chưa đóng</span>
              <span className="font-bold text-[#92400E] dark:text-[#FDE68A]">
                {fundSummary.unpaid.toLocaleString('vi-VN')}đ
              </span>
            </div>
            <div className="rounded-xl bg-[#ECFDF5]/60 dark:bg-[#064E3B]/40 px-3 py-2 flex items-center justify-between">
              <span className="text-[#059669] dark:text-[#34D399]">Đã thu</span>
              <span className="font-bold text-[#047857] dark:text-[#6EE7B7]">
                {fundSummary.paid.toLocaleString('vi-VN')}đ
              </span>
            </div>
          </div>

          {missedDuties.length > 0 && (
            <div className="rounded-xl bg-[#FFFBEB] dark:bg-[#451A03]/30 px-3 py-2 flex items-center gap-2 text-xs text-[#92400E] dark:text-[#FDE68A]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                Chưa xong: {missedDuties.map((d) => d.title).join(', ')}
              </span>
            </div>
          )}

          {isAdmin && penaltyFormOpen && (
            <form
              onSubmit={handleAddPenalty}
              className="rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] p-3 space-y-2"
            >
              <select
                value={penProfileId}
                onChange={(e) => setPenProfileId(e.target.value)}
                required
                className="w-full h-11 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-sm"
              >
                <option value="">Thành viên...</option>
                {(nonAdminMembers.length > 0 ? nonAdminMembers : members).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </select>

              <select
                value={penChoreId}
                onChange={(e) => {
                  const cid = e.target.value;
                  setPenChoreId(cid);
                  const found = chores.find((c) => c.id === cid);
                  if (found) {
                    setPenAmount(String(found.penalty_amount || 20000));
                    if (!penReason) setPenReason(found.title);
                  }
                }}
                className="w-full h-11 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-sm"
              >
                <option value="">Đầu việc (tuỳ chọn)</option>
                {chores.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>

              <input
                type="number"
                min={1000}
                step={1000}
                value={penAmount}
                onChange={(e) => setPenAmount(e.target.value)}
                placeholder="Số tiền (VNĐ)"
                className="w-full h-11 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-sm tabular-nums"
              />

              <input
                type="text"
                value={penReason}
                onChange={(e) => setPenReason(e.target.value)}
                placeholder="Lý do"
                required
                className="w-full h-11 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-sm"
              />

              <button
                type="submit"
                disabled={submittingPenalty}
                className="w-full h-11 rounded-xl bg-[#D97706] text-white font-semibold text-sm"
              >
                {submittingPenalty ? 'Đang lưu...' : 'Lưu'}
              </button>
            </form>
          )}

          {penalties.length > 0 && (
            <div className="divide-y divide-[#F3F4F6] dark:divide-[#334155]">
              {penalties.map((p) => (
                <div key={p.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC] truncate">
                      {p.member_name} •{' '}
                      <span className="tabular-nums text-[#D97706]">
                        {p.amount.toLocaleString('vi-VN')}đ
                      </span>
                    </p>
                    <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] truncate tabular-nums">
                      {p.reason} • {formatIsoToVn(p.created_at).slice(0, 10)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isAdmin ? (
                      <>
                        <button
                          type="button"
                          onClick={() => togglePenaltyPaid(p)}
                          className={`h-8 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 ${
                            p.status === 'paid'
                              ? 'bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399]'
                              : 'bg-[#FEF3C7] dark:bg-[#451A03] text-[#B45309] dark:text-[#FCD34D]'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {p.status === 'paid' ? 'Đã đóng' : 'Thu'}
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePenalty(p.id)}
                          aria-label="Xóa"
                          className="w-8 h-8 rounded-lg text-[#6B7280] hover:text-[#DC2626] flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <span
                        className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${
                          p.status === 'paid'
                            ? 'bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399]'
                            : 'bg-[#FEF3C7] dark:bg-[#451A03] text-[#B45309] dark:text-[#FCD34D]'
                        }`}
                      >
                        {p.status === 'paid' ? 'Đã đóng' : 'Chưa đóng'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
