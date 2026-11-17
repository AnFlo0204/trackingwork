'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  CheckCircle2,
  Coins,
  FileSpreadsheet,
  Plus,
  Trash2,
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
import { getInitials } from './ChoreIcon';

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
    const map = new Map<string, { profile: ProfilePublic; count: number; points: number }>();

    for (const p of activeProfiles) {
      map.set(p.id, { profile: p, count: 0, points: 0 });
    }

    for (const log of logs) {
      const existing = map.get(log.profile_id);
      if (existing) {
        existing.count += 1;
        existing.points += log.points_awarded || 0;
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (featureFlags.gamification && b.points !== a.points) return b.points - a.points;
      return b.count - a.count;
    });
  }, [members, logs, featureFlags.gamification]);

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
      const res = await fetch('/api/admin/penalties', {
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
    await fetch('/api/admin/penalties', {
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
    await fetch(`/api/admin/penalties?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await onRefresh();
  }

  const nonAdminMembers = members.filter((m) => m.role === 'member');

  return (
    <div className="space-y-4">
      {/* Weekly Settlement Report (Bảng quyết toán cuối tuần) */}
      {weeklyFundConfig.enabled && (
        <section className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#059669]" />
              <h2 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
                Bảng quyết toán quỹ tuần
              </h2>
            </div>
            <span className="text-xs font-semibold text-[#D97706] tabular-nums">
              Quỹ chung: {sharedPartyFund.balance.toLocaleString('vi-VN')}đ
            </span>
          </div>

          {weeklySettlement.length === 0 ? (
            <p className="text-xs text-[#6B7280] dark:text-[#94A3B8]">
              Chưa có thành viên nào được thiết lập định mức quỹ tuần.
            </p>
          ) : (
            <div className="divide-y divide-[#F3F4F6] dark:divide-[#334155]">
              {weeklySettlement.map((row) => (
                <div key={row.profile_id} className="py-2.5 space-y-1 tabular-nums">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
                      {row.display_name}
                    </span>
                    <span className="text-sm font-bold text-[#059669] dark:text-[#34D399]">
                      Nhận: {row.current_balance.toLocaleString('vi-VN')}đ
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#6B7280] dark:text-[#94A3B8]">
                    <span>Cấp: {row.weekly_allowance.toLocaleString('vi-VN')}đ</span>
                    <span className="text-[#DC2626]">
                      Phạt/chi: -{(row.total_penalties + row.total_bounty_paid).toLocaleString('vi-VN')}đ
                    </span>
                    <span className="text-[#059669]">
                      Làm hộ: +{row.total_bounty_earned.toLocaleString('vi-VN')}đ
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 1. Leaderboard (Gamification) */}
      {featureFlags.gamification && (
        <section className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-[#059669]" />
              <h2 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
                Bảng xếp hạng điểm thưởng
              </h2>
            </div>
            <span className="text-xs text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
              {totalLogs} lượt
            </span>
          </div>

          {memberStats.length === 0 ? (
            <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] py-2">
              Chưa có thành viên nào trong bảng xếp hạng.
            </p>
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
                      <div className="w-8 h-8 rounded-full bg-[#F3F4F6] dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#334155] text-[11px] font-bold flex items-center justify-center shrink-0">
                        {getInitials(entry.profile.display_name)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC] truncate">
                          {entry.profile.display_name}{' '}
                          {isMe && <span className="text-xs text-[#059669]">(Bạn)</span>}
                        </p>
                        <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
                          {entry.count} lần hoàn thành
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-[#059669] dark:text-[#34D399] tabular-nums shrink-0">
                      {entry.points} đ
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* 2. Visual Analytics Dashboard */}
      {featureFlags.analytics && (
        <section className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#059669]" />
            <h2 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
              Thống kê đóng góp trực quan
            </h2>
          </div>

          {donutSegments.length === 0 ? (
            <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] py-2">
              Chưa có dữ liệu đóng góp để hiển thị biểu đồ.
            </p>
          ) : (
            <div className="flex items-center gap-4">
              <div className="relative w-28 h-28 shrink-0">
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
                  <span className="text-lg font-bold text-[#111827] dark:text-[#F8FAFC] tabular-nums leading-none">
                    {totalLogs}
                  </span>
                  <span className="text-[10px] text-[#6B7280] dark:text-[#94A3B8] mt-0.5">
                    Tổng lượt
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
            <div className="pt-2 border-t border-[#F3F4F6] dark:border-[#334155] space-y-2.5">
              <p className="text-xs font-semibold text-[#6B7280] dark:text-[#94A3B8] uppercase tracking-wide">
                Tần suất theo đầu việc
              </p>
              {choreStats.map((c) => (
                <div key={c.title} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#111827] dark:text-[#F8FAFC]">{c.title}</span>
                    <span className="tabular-nums text-[#6B7280] dark:text-[#94A3B8]">
                      {c.count} lần
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[#F3F4F6] dark:bg-[#0F172A] overflow-hidden">
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

      {/* 3. Penalty & Shared Fund Tracker */}
      {featureFlags.penalty_fund && (
        <section className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-[#D97706]" />
              <h2 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
                Quỹ phạt & Nhắc nhở
              </h2>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setPenaltyFormOpen((o) => !o)}
                className="h-9 px-3 rounded-xl bg-[#FEF3C7] dark:bg-[#451A03] text-[#B45309] dark:text-[#FCD34D] text-xs font-semibold inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Ghi phạt
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl bg-[#FEF3C7]/60 dark:bg-[#451A03]/50 border border-[#FDE68A] dark:border-[#92400E] p-3">
              <p className="text-[11px] text-[#B45309] dark:text-[#FCD34D] font-medium">
                Chưa đóng vào quỹ
              </p>
              <p className="text-base font-bold text-[#92400E] dark:text-[#FDE68A] tabular-nums mt-0.5">
                {fundSummary.unpaid.toLocaleString('vi-VN')} đ
              </p>
            </div>
            <div className="rounded-xl bg-[#ECFDF5]/60 dark:bg-[#064E3B]/40 border border-[#A7F3D0] dark:border-[#047857] p-3">
              <p className="text-[11px] text-[#059669] dark:text-[#34D399] font-medium">
                Tổng quỹ đã thu
              </p>
              <p className="text-base font-bold text-[#047857] dark:text-[#6EE7B7] tabular-nums mt-0.5">
                {fundSummary.paid.toLocaleString('vi-VN')} đ
              </p>
            </div>
          </div>

          {missedDuties.length > 0 && (
            <div className="rounded-xl bg-[#FFFBEB] dark:bg-[#451A03]/30 border border-[#FDE68A] dark:border-[#92400E] p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#B45309] dark:text-[#FCD34D]">
                <AlertTriangle className="w-3.5 h-3.5" />
                Nhắc nhở việc định kỳ chưa hoàn thành
              </div>
              <p className="text-xs text-[#92400E] dark:text-[#FDE68A]">
                {missedDuties
                  .map((d) => `${d.title} (${d.frequency === 'daily' ? 'hôm nay' : 'tuần này'})`)
                  .join(', ')}
              </p>
            </div>
          )}

          {isAdmin && penaltyFormOpen && (
            <form
              onSubmit={handleAddPenalty}
              className="rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] p-3 space-y-2.5"
            >
              <select
                value={penProfileId}
                onChange={(e) => setPenProfileId(e.target.value)}
                required
                className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-sm"
              >
                <option value="">Chọn thành viên...</option>
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
                    if (!penReason) setPenReason(`Quên làm việc: ${found.title}`);
                  }
                }}
                className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-sm"
              >
                <option value="">Liên kết việc nhà (tuỳ chọn)</option>
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
                placeholder="Số tiền phạt (VNĐ)"
                className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-sm tabular-nums"
              />

              <input
                type="text"
                value={penReason}
                onChange={(e) => setPenReason(e.target.value)}
                placeholder="Lý do (VD: Quên đổ rác hôm nay)"
                required
                className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-sm"
              />

              <button
                type="submit"
                disabled={submittingPenalty}
                className="w-full h-12 rounded-xl bg-[#D97706] text-white font-semibold text-sm"
              >
                {submittingPenalty ? 'Đang lưu...' : 'Lưu khoản phạt'}
              </button>
            </form>
          )}

          {penalties.length > 0 ? (
            <div className="divide-y divide-[#F3F4F6] dark:divide-[#334155]">
              {penalties.map((p) => (
                <div key={p.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC] truncate">
                      {p.member_name} •{' '}
                      <span className="tabular-nums text-[#D97706]">
                        {p.amount.toLocaleString('vi-VN')} đ
                      </span>
                    </p>
                    <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] truncate">
                      {p.reason} • {formatIsoToVn(p.created_at).slice(0, 10)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isAdmin ? (
                      <>
                        <button
                          type="button"
                          onClick={() => togglePenaltyPaid(p)}
                          className={`h-9 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 ${
                            p.status === 'paid'
                              ? 'bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399]'
                              : 'bg-[#FEF3C7] dark:bg-[#451A03] text-[#B45309] dark:text-[#FCD34D]'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {p.status === 'paid' ? 'Đã đóng' : 'Thu tiền'}
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePenalty(p.id)}
                          aria-label="Xóa khoản phạt"
                          className="w-9 h-9 rounded-lg text-[#6B7280] hover:text-[#DC2626] flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <span
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
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
          ) : (
            <p className="text-xs text-[#6B7280] dark:text-[#94A3B8]">
              Chưa có khoản phạt nào được ghi nhận.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
