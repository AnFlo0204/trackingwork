'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  FileSpreadsheet,
  Gift,
  KeyRound,
  PartyPopper,
  Plus,
  RotateCcw,
  Shield,
  Sliders,
  Trash2,
  UserCheck,
  UserX,
  Users,
  Wallet,
} from 'lucide-react';
import type {
  AssignedChoreItem,
  BonusRewardConfig,
  Chore,
  ChoreFrequency,
  ChoreLogItem,
  FeatureFlags,
  FundTransactionItem,
  ProfilePublic,
  SharedPartyFund,
  WeeklyFundConfig,
  WeeklySettlementRow,
} from '@/lib/types';
import { formatIsoToVn } from '@/lib/time';
import { signedFetch } from '@/lib/requestSigner';
import { CHORE_ICON_OPTIONS, ChoreIcon } from './ChoreIcon';
import { AssignTasksPanel } from './AssignTasksPanel';
import { ProtectedImage } from './ProtectedImage';
import type { BonusTarget } from './AwardBonusModal';

interface AdminPanelProps {
  chores: Chore[];
  logs: ChoreLogItem[];
  members: ProfilePublic[];
  assignedChores: AssignedChoreItem[];
  fundTransactions: FundTransactionItem[];
  weeklySettlement: WeeklySettlementRow[];
  sharedPartyFund: SharedPartyFund;
  featureFlags: FeatureFlags;
  weeklyFundConfig: WeeklyFundConfig;
  bonusRewardConfig: BonusRewardConfig;
  retentionDays: number;
  lastCleanupAt: string | null;
  currentVnDate: string;
  currentUserId: string;
  onRefresh: () => Promise<void>;
  onModerate: (log: ChoreLogItem, action?: 'reject' | 'rework_half_penalty') => Promise<void>;
  onInspectPhoto: (log: ChoreLogItem) => void;
  onAwardBonus: (target: BonusTarget) => void;
}

type AdminSection = 'flags' | 'assign' | 'chores' | 'members' | 'data';

const FEATURE_META: Array<{ key: keyof FeatureFlags; title: string; desc: string }> = [
  {
    key: 'recurring_tasks',
    title: 'Bảng công việc & Lịch định kỳ',
    desc: 'Tự động đánh dấu việc hàng ngày / hàng tuần và lọc việc chưa xong.',
  },
  {
    key: 'gamification',
    title: 'Hệ thống điểm thưởng & Bảng xếp hạng',
    desc: 'Hiển thị huy hiệu điểm trên từng thẻ việc và bảng xếp hạng thành viên.',
  },
  {
    key: 'analytics',
    title: 'Thống kê trực quan',
    desc: 'Hiển thị biểu đồ tỷ lệ đóng góp theo thành viên và đầu việc.',
  },
  {
    key: 'penalty_fund',
    title: 'Quỹ phạt chung & Nhắc nhở',
    desc: 'Hiển thị mục quỹ phạt và cảnh báo việc định kỳ chưa hoàn thành ở tab Thống kê.',
  },
];

const RESET_DAYS = [
  { val: 1, label: 'Thứ 2 hàng tuần' },
  { val: 2, label: 'Thứ 3 hàng tuần' },
  { val: 3, label: 'Thứ 4 hàng tuần' },
  { val: 4, label: 'Thứ 5 hàng tuần' },
  { val: 5, label: 'Thứ 6 hàng tuần' },
  { val: 6, label: 'Thứ 7 hàng tuần' },
  { val: 0, label: 'Chủ nhật hàng tuần' },
];

export function AdminPanel({
  chores,
  logs,
  members,
  assignedChores,
  fundTransactions,
  weeklySettlement,
  sharedPartyFund,
  featureFlags,
  weeklyFundConfig,
  bonusRewardConfig,
  retentionDays,
  lastCleanupAt,
  currentVnDate,
  currentUserId,
  onRefresh,
  onModerate,
  onInspectPhoto,
  onAwardBonus,
}: AdminPanelProps) {
  const [section, setSection] = useState<AdminSection>('flags');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Chore form state
  const [editingChoreId, setEditingChoreId] = useState<string | null>(null);
  const [choreTitle, setChoreTitle] = useState('');
  const [choreIcon, setChoreIcon] = useState('sparkles');
  const [chorePoints, setChorePoints] = useState('15');
  const [choreCooldown, setChoreCooldown] = useState('30');
  const [choreFreq, setChoreFreq] = useState<ChoreFrequency>('daily');
  const [chorePenalty, setChorePenalty] = useState('20000');
  const [choreRequireBA, setChoreRequireBA] = useState(false);
  const [choreMinDuration, setChoreMinDuration] = useState('5');
  const [savingChore, setSavingChore] = useState(false);

  // Member form state
  const [memUsername, setMemUsername] = useState('');
  const [memDisplayName, setMemDisplayName] = useState('');
  const [memPin, setMemPin] = useState('');
  const [memCanAssign, setMemCanAssign] = useState(false);
  const [memAllowance, setMemAllowance] = useState('500000');
  const [savingMember, setSavingMember] = useState(false);
  const [resetPinId, setResetPinId] = useState<string | null>(null);
  const [resetPinVal, setResetPinVal] = useState('');
  const [allowanceEdits, setAllowanceEdits] = useState<Record<string, string>>({});

  // Fund adjustment state
  const [adjProfileId, setAdjProfileId] = useState('');
  const [adjType, setAdjType] = useState<'refund' | 'deduct'>('refund');
  const [adjAmount, setAdjAmount] = useState('20000');
  const [adjReason, setAdjReason] = useState('Hoàn tiền khiếu nại hợp lệ');
  const [savingAdj, setSavingAdj] = useState(false);
  const [closingWeek, setClosingWeek] = useState(false);

  // Retention & bonus config state
  const [retInput, setRetInput] = useState(String(retentionDays));
  const [cleaningUp, setCleaningUp] = useState(false);
  const [maxBonusCapInput, setMaxBonusCapInput] = useState(
    String(bonusRewardConfig.max_delegated_bonus ?? 100000),
  );

  useEffect(() => {
    setRetInput(String(retentionDays));
  }, [retentionDays]);

  useEffect(() => {
    setMaxBonusCapInput(String(bonusRewardConfig.max_delegated_bonus ?? 100000));
  }, [bonusRewardConfig.max_delegated_bonus]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const m of members) {
      next[m.id] = String(m.weekly_allowance ?? 0);
    }
    setAllowanceEdits(next);
    if (!adjProfileId && members.length > 0) {
      const firstMember = members.find((m) => m.role === 'member') || members[0];
      setAdjProfileId(firstMember.id);
    }
  }, [members, adjProfileId]);

  const memberRoster = members.filter((m) => m.role === 'member');
  const flaggedLogs = logs.filter((l) => l.quality_status === 'flagged');

  function notify(type: 'ok' | 'err', text: string) {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 4000);
  }

  async function toggleFeature(key: keyof FeatureFlags) {
    const nextFlags = { ...featureFlags, [key]: !featureFlags[key] };
    const res = await signedFetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featureFlags: nextFlags }),
    });
    if (!res.ok) {
      notify('err', 'Không thể cập nhật công tắc tính năng.');
      return;
    }
    await onRefresh();
    notify('ok', 'Đã đồng bộ cấu hình cho tất cả thành viên.');
  }

  async function updateBonusRewardConfig(nextCfg: BonusRewardConfig) {
    const res = await signedFetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bonusRewardConfig: nextCfg }),
    });
    if (!res.ok) {
      notify('err', 'Không thể cập nhật cấu hình tặng thưởng.');
      return;
    }
    await onRefresh();
    notify('ok', 'Đã lưu cấu hình Tặng thưởng.');
  }

  async function updateWeeklyFundConfig(nextConfig: WeeklyFundConfig) {
    const res = await signedFetch('/api/admin/fund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'config', config: nextConfig }),
    });
    if (!res.ok) {
      notify('err', 'Không thể lưu cấu hình ví quỹ tuần.');
      return;
    }
    await onRefresh();
    notify('ok', 'Đã cập nhật cấu hình ví quỹ tuần.');
  }

  async function updatePartyFund(opts: { show_banner?: boolean; reset_balance?: boolean }) {
    const res = await signedFetch('/api/admin/fund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'party_fund_config', ...opts }),
    });
    if (res.ok) {
      await onRefresh();
      notify('ok', opts.reset_balance ? 'Đã quyết toán / chi hết Quỹ Liên Hoan Chung.' : 'Đã cập nhật hiển thị Quỹ Liên Hoan Chung.');
    }
  }

  async function handleCloseWeekSettlement() {
    setClosingWeek(true);
    try {
      const res = await signedFetch('/api/admin/fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close_week_settlement' }),
      });
      if (res.ok) {
        await onRefresh();
        notify('ok', 'Đã chốt sổ và cấp quỹ tuần mới cho toàn bộ thành viên!');
      }
    } finally {
      setClosingWeek(false);
    }
  }

  function startEditChore(c: Chore) {
    setEditingChoreId(c.id);
    setChoreTitle(c.title);
    setChoreIcon(c.icon);
    setChorePoints(String(c.points));
    setChoreCooldown(String(c.cooldown_minutes));
    setChoreFreq(c.frequency);
    setChorePenalty(String(c.penalty_amount || 20000));
    setChoreRequireBA(Boolean(c.require_before_after));
    setChoreMinDuration(String(c.min_duration_minutes ?? 5));
  }

  function resetChoreForm() {
    setEditingChoreId(null);
    setChoreTitle('');
    setChoreIcon('sparkles');
    setChorePoints('15');
    setChoreCooldown('30');
    setChoreFreq('daily');
    setChorePenalty('20000');
    setChoreRequireBA(false);
    setChoreMinDuration('5');
  }

  async function handleSaveChore(e: FormEvent) {
    e.preventDefault();
    if (!choreTitle.trim()) return;
    setSavingChore(true);
    try {
      const payload = {
        id: editingChoreId || undefined,
        title: choreTitle.trim(),
        icon: choreIcon,
        points: Number(chorePoints || 0),
        cooldown_minutes: Number(choreCooldown || 0),
        frequency: choreFreq,
        penalty_amount: Number(chorePenalty || 20000),
        require_before_after: choreRequireBA,
        min_duration_minutes: choreRequireBA ? Number(choreMinDuration || 0) : 0,
      };
      const res = await signedFetch('/api/admin/chores', {
        method: editingChoreId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('err', data?.error || 'Không thể lưu công việc.');
        return;
      }
      resetChoreForm();
      await onRefresh();
      notify('ok', editingChoreId ? 'Đã cập nhật công việc.' : 'Đã thêm công việc mới.');
    } finally {
      setSavingChore(false);
    }
  }

  async function moveChore(id: string, move: 'up' | 'down') {
    await signedFetch('/api/admin/chores', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, move }),
    });
    await onRefresh();
  }

  async function deleteChore(id: string) {
    await signedFetch(`/api/admin/chores?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await onRefresh();
    notify('ok', 'Đã xóa công việc.');
  }

  async function handleCreateMember(e: FormEvent) {
    e.preventDefault();
    setSavingMember(true);
    try {
      const res = await signedFetch('/api/admin/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: memUsername.trim(),
          display_name: memDisplayName.trim() || memUsername.trim(),
          pin: memPin.trim(),
          can_assign_tasks: memCanAssign,
          weekly_allowance: Number(memAllowance || 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('err', data?.error || 'Không thể thêm thành viên.');
        return;
      }
      setMemUsername('');
      setMemDisplayName('');
      setMemPin('');
      setMemCanAssign(false);
      await onRefresh();
      notify('ok', 'Đã tạo tài khoản thành viên mới.');
    } finally {
      setSavingMember(false);
    }
  }

  async function toggleMemberActive(m: ProfilePublic) {
    await signedFetch('/api/admin/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.id, is_active: !m.is_active }),
    });
    await onRefresh();
    notify('ok', m.is_active ? `Đã tạm khóa ${m.display_name}.` : `Đã mở khóa ${m.display_name}.`);
  }

  async function toggleCanAssign(m: ProfilePublic) {
    await signedFetch('/api/admin/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.id, can_assign_tasks: !m.can_assign_tasks }),
    });
    await onRefresh();
    notify(
      'ok',
      !m.can_assign_tasks
        ? `Đã cấp quyền giao việc cho ${m.display_name}.`
        : `Đã thu hồi quyền giao việc của ${m.display_name}.`,
    );
  }

  async function saveMemberAllowance(m: ProfilePublic) {
    const val = Number(allowanceEdits[m.id] ?? 0);
    const res = await signedFetch('/api/admin/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.id, weekly_allowance: val }),
    });
    if (res.ok) {
      await onRefresh();
      notify('ok', `Đã lưu định mức quỹ tuần cho ${m.display_name}.`);
    }
  }

  async function resetMemberBalanceNow(m: ProfilePublic) {
    const res = await signedFetch('/api/admin/fund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset_member', profile_id: m.id }),
    });
    if (res.ok) {
      await onRefresh();
      notify('ok', `Đã cấp lại số dư theo định mức cho ${m.display_name}.`);
    }
  }

  async function submitResetPin(id: string) {
    const res = await signedFetch('/api/admin/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pin: resetPinVal.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify('err', data?.error || 'Không thể đặt lại mã PIN.');
      return;
    }
    setResetPinId(null);
    setResetPinVal('');
    notify('ok', 'Đã đặt lại mã PIN 6 số mới.');
  }

  async function deleteMember(id: string) {
    await signedFetch(`/api/admin/members?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await onRefresh();
    notify('ok', 'Đã xóa thành viên.');
  }

  async function handleManualAdjustment(e: FormEvent) {
    e.preventDefault();
    const raw = Math.abs(Number(adjAmount || 0));
    if (!adjProfileId || raw === 0 || !adjReason.trim()) return;
    setSavingAdj(true);
    try {
      const signedAmount = adjType === 'refund' ? raw : -raw;
      const res = await signedFetch('/api/admin/fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adjust',
          profile_id: adjProfileId,
          amount: signedAmount,
          tx_type: adjType === 'refund' ? 'refund' : 'adjustment',
          description: adjReason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('err', data?.error || 'Không thể điều chỉnh số dư.');
        return;
      }
      await onRefresh();
      notify('ok', 'Đã cập nhật số dư ví quỹ tuần.');
    } finally {
      setSavingAdj(false);
    }
  }

  async function saveRetentionDays(e: FormEvent) {
    e.preventDefault();
    const res = await signedFetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retentionDays: Number(retInput) }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify('err', data?.error || 'Giá trị không hợp lệ.');
      return;
    }
    await onRefresh();
    notify('ok', `Đã lưu chu kỳ lưu trữ ${retInput} ngày.`);
  }

  async function triggerManualCleanup() {
    setCleaningUp(true);
    try {
      const res = await signedFetch('/api/admin/cleanup', { method: 'POST' });
      const data = await res.json();
      await onRefresh();
      notify(
        'ok',
        `Đã dọn dẹp ${data.deletedLogs ?? 0} lượt và ${data.deletedFiles ?? 0} ảnh quá hạn.`,
      );
    } finally {
      setCleaningUp(false);
    }
  }

  const [desktopRightSection, setDesktopRightSection] = useState<'members' | 'chores' | 'assign' | 'data'>('members');

  return (
    <div className="space-y-3.5">
      {/* Mobile Sub-Navigation (< 768px) */}
      <div className="md:hidden grid grid-cols-5 gap-1 bg-[#F3F4F6] dark:bg-[#1E293B] p-1 rounded-2xl border border-[#E5E7EB] dark:border-[#334155]">
        {(
          [
            { key: 'flags', label: 'Tính năng', icon: Sliders },
            { key: 'assign', label: 'Giao việc', icon: ClipboardList },
            { key: 'chores', label: 'Việc nhà', icon: Shield },
            { key: 'members', label: 'Nhân sự', icon: Users },
            { key: 'data', label: 'Quỹ & DL', icon: Database, badge: flaggedLogs.length },
          ] as Array<{ key: AdminSection; label: string; icon: typeof Sliders; badge?: number }>
        ).map((tab) => {
          const Icon = tab.icon;
          const active = section === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSection(tab.key)}
              className={`relative h-11 rounded-xl text-[10px] font-semibold flex flex-col items-center justify-center gap-0.5 transition ${
                active
                  ? 'bg-white dark:bg-[#0F172A] text-[#059669] shadow-sm'
                  : 'text-[#6B7280] dark:text-[#94A3B8]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.badge && tab.badge > 0 ? (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#DC2626]" />
              ) : null}
            </button>
          );
        })}
      </div>

      {feedback && (
        <div
          className={`rounded-xl px-3.5 py-2.5 text-xs font-medium border ${
            feedback.type === 'ok'
              ? 'bg-[#ECFDF5] dark:bg-[#064E3B] border-[#A7F3D0] dark:border-[#047857] text-[#047857] dark:text-[#6EE7B7]'
              : 'bg-[#FEF2F2] dark:bg-[#450A0A] border-[#FECACA] dark:border-[#7F1D1D] text-[#B91C1C] dark:text-[#FCA5A5]'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* 2-Column Adaptive Dashboard Grid on iPad/PC */}
      <div className="md:grid md:grid-cols-12 md:gap-5 md:items-start">
        {/* Left Column on iPad/PC: Feature Flags & Global Weekly Fund Config */}
        <div className={`${section === 'flags' ? 'block' : 'hidden md:block'} md:col-span-5 space-y-3`}>
          <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Wallet className="w-4 h-4 text-[#059669]" />
                  <p className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
                    Ví quỹ tuần & Trừ phạt tự động
                  </p>
                </div>
                <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] mt-0.5">
                  Tự động cấp định mức hàng tuần và trừ số dư khi trễ hạn việc được giao.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={weeklyFundConfig.enabled}
                onClick={() =>
                  updateWeeklyFundConfig({
                    ...weeklyFundConfig,
                    enabled: !weeklyFundConfig.enabled,
                  })
                }
                className={`w-12 h-7 rounded-full p-0.5 transition-colors shrink-0 ${
                  weeklyFundConfig.enabled ? 'bg-[#059669]' : 'bg-[#D1D5DB] dark:bg-[#475569]'
                }`}
              >
                <span
                  className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${
                    weeklyFundConfig.enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {weeklyFundConfig.enabled && (
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#F3F4F6] dark:border-[#334155]">
                <div>
                  <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
                    Ngày reset tuần
                  </label>
                  <select
                    value={weeklyFundConfig.reset_day}
                    onChange={(e) =>
                      updateWeeklyFundConfig({
                        ...weeklyFundConfig,
                        reset_day: Number(e.target.value),
                      })
                    }
                    className="w-full h-11 px-2.5 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-xs"
                  >
                    {RESET_DAYS.map((d) => (
                      <option key={d.val} value={d.val}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
                    Giờ reset (UTC+7)
                  </label>
                  <select
                    value={weeklyFundConfig.reset_hour}
                    onChange={(e) =>
                      updateWeeklyFundConfig({
                        ...weeklyFundConfig,
                        reset_hour: Number(e.target.value),
                      })
                    }
                    className="w-full h-11 px-2.5 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-xs tabular-nums"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#F3F4F6] dark:border-[#334155]">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <PartyPopper className="w-4 h-4 text-[#D97706]" />
                  <p className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
                    Banner Quỹ Liên Hoan Chung
                  </p>
                </div>
                <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] mt-0.5">
                  Hiển thị tổng tiền phạt tích luỹ ở trang chủ.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={sharedPartyFund.show_banner}
                onClick={() => updatePartyFund({ show_banner: !sharedPartyFund.show_banner })}
                className={`w-12 h-7 rounded-full p-0.5 transition-colors shrink-0 ${
                  sharedPartyFund.show_banner ? 'bg-[#059669]' : 'bg-[#D1D5DB] dark:bg-[#475569]'
                }`}
              >
                <span
                  className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${
                    sharedPartyFund.show_banner ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Gift className="w-4 h-4 text-[#D97706]" />
                  <p className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
                    Tính năng Tặng thưởng (Bonus)
                  </p>
                </div>
                <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] mt-0.5">
                  Cho phép Admin &amp; Người giao việc thưởng nóng vào ví quỹ tuần.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={bonusRewardConfig.enabled}
                onClick={() =>
                  updateBonusRewardConfig({
                    ...bonusRewardConfig,
                    enabled: !bonusRewardConfig.enabled,
                  })
                }
                className={`w-12 h-7 rounded-full p-0.5 transition-colors shrink-0 ${
                  bonusRewardConfig.enabled ? 'bg-[#059669]' : 'bg-[#D1D5DB] dark:bg-[#475569]'
                }`}
              >
                <span
                  className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${
                    bonusRewardConfig.enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {bonusRewardConfig.enabled && (
              <div className="pt-2 border-t border-[#F3F4F6] dark:border-[#334155] space-y-1.5">
                <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8]">
                  Trần thưởng tối đa / lần cho Người giao việc (VNĐ)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={maxBonusCapInput}
                    onChange={(e) => setMaxBonusCapInput(e.target.value)}
                    className="flex-1 h-10 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-xs tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      updateBonusRewardConfig({
                        ...bonusRewardConfig,
                        max_delegated_bonus: Math.max(0, Number(maxBonusCapInput || 0)),
                      })
                    }
                    className="h-10 px-3 rounded-xl bg-[#111827] dark:bg-[#059669] text-white text-xs font-semibold shrink-0"
                  >
                    Lưu trần
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl divide-y divide-[#F3F4F6] dark:divide-[#334155]">
            {FEATURE_META.map((item) => {
              const on = featureFlags[item.key];
              return (
                <div key={item.key} className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
                      {item.title}
                    </p>
                    <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] mt-0.5 leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => toggleFeature(item.key)}
                    className={`w-12 h-7 rounded-full p-0.5 transition-colors shrink-0 ${
                      on ? 'bg-[#059669]' : 'bg-[#D1D5DB] dark:bg-[#475569]'
                    }`}
                  >
                    <span
                      className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${
                        on ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column on iPad/PC: Members, Chores, Assign & Settlement */}
        <div className={`${section === 'flags' ? 'hidden md:block' : 'block'} md:col-span-7 space-y-3`}>
          {/* Desktop / iPad Segmented Switcher for Right Column */}
          <div className="hidden md:grid grid-cols-4 gap-1.5 bg-[#F3F4F6] dark:bg-[#1E293B] p-1 rounded-2xl border border-[#E5E7EB] dark:border-[#334155]">
            {(
              [
                { key: 'members', label: 'Nhân sự (10)', icon: Users },
                { key: 'chores', label: 'Việc nhà', icon: Shield },
                { key: 'assign', label: 'Giao việc', icon: ClipboardList },
                { key: 'data', label: 'Quỹ & Duyệt', icon: Database, badge: flaggedLogs.length },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = desktopRightSection === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setDesktopRightSection(tab.key);
                    setSection(tab.key);
                  }}
                  className={`relative h-10 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                    active
                      ? 'bg-white dark:bg-[#0F172A] text-[#059669] shadow-sm'
                      : 'text-[#6B7280] dark:text-[#94A3B8]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                  {'badge' in tab && tab.badge && tab.badge > 0 ? (
                    <span className="w-2 h-2 rounded-full bg-[#DC2626]" />
                  ) : null}
                </button>
              );
            })}
          </div>

      {/* 2. Delegated / Admin Task Assignment */}
      {(section === 'assign' || (section === 'flags' && desktopRightSection === 'assign')) && (
        <div className={section === 'assign' ? 'block' : 'hidden md:block'}>
        <AssignTasksPanel
          chores={chores}
          members={members}
          assignedChores={assignedChores}
          currentVnDate={currentVnDate}
          canAwardBonus={bonusRewardConfig.enabled}
          currentUserId={currentUserId}
          onAwardBonus={onAwardBonus}
          onRefresh={onRefresh}
        />
        </div>
      )}

      {/* 3. Chore, Before/After & Min Duration Management */}
      {(section === 'chores' || (section === 'flags' && desktopRightSection === 'chores')) && (
        <div className={`${section === 'chores' ? 'block' : 'hidden md:block'} space-y-3`}>
          <form
            onSubmit={handleSaveChore}
            className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
                {editingChoreId ? 'Sửa đầu việc' : 'Thêm đầu việc mới'}
              </h3>
              {editingChoreId && (
                <button
                  type="button"
                  onClick={resetChoreForm}
                  className="text-xs font-medium text-[#6B7280]"
                >
                  Huỷ sửa
                </button>
              )}
            </div>

            <input
              type="text"
              value={choreTitle}
              onChange={(e) => setChoreTitle(e.target.value)}
              placeholder="Tên công việc (VD: Rửa chén)"
              required
              className="w-full h-12 px-3.5 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm"
            />

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
                  Biểu tượng
                </label>
                <select
                  value={choreIcon}
                  onChange={(e) => setChoreIcon(e.target.value)}
                  className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm"
                >
                  {CHORE_ICON_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
                  Định kỳ
                </label>
                <select
                  value={choreFreq}
                  onChange={(e) => setChoreFreq(e.target.value as ChoreFrequency)}
                  className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm"
                >
                  <option value="daily">Hàng ngày</option>
                  <option value="weekly">Hàng tuần</option>
                  <option value="always">Tự do</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
                  Điểm
                </label>
                <input
                  type="number"
                  min={0}
                  value={chorePoints}
                  onChange={(e) => setChorePoints(e.target.value)}
                  className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
                  Chờ (phút)
                </label>
                <input
                  type="number"
                  min={0}
                  value={choreCooldown}
                  onChange={(e) => setChoreCooldown(e.target.value)}
                  className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
                  Phạt mặc định
                </label>
                <input
                  type="number"
                  min={0}
                  step={5000}
                  value={chorePenalty}
                  onChange={(e) => setChorePenalty(e.target.value)}
                  className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm tabular-nums"
                />
              </div>
            </div>

            {/* Before & After Toggle + Minimum Duration */}
            <div className="rounded-xl bg-[#F8F9FA] dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#334155] p-3 space-y-2.5">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-xs font-semibold text-[#111827] dark:text-[#F8FAFC]">
                  Yêu cầu ảnh Trước & Sau
                </span>
                <input
                  type="checkbox"
                  checked={choreRequireBA}
                  onChange={(e) => setChoreRequireBA(e.target.checked)}
                  className="w-4 h-4 accent-[#059669]"
                />
              </label>

              {choreRequireBA && (
                <div>
                  <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
                    Thời gian làm tối thiểu trước khi chụp ảnh Sau (phút)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={240}
                    value={choreMinDuration}
                    onChange={(e) => setChoreMinDuration(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-sm tabular-nums"
                  />
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={savingChore}
              className="w-full h-12 rounded-xl bg-[#059669] text-white font-semibold text-sm flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              {savingChore ? 'Đang lưu...' : editingChoreId ? 'Lưu thay đổi' : 'Thêm công việc'}
            </button>
          </form>

          <div className="space-y-2">
            {chores.map((c, idx) => (
              <div
                key={c.id}
                className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-3.5 flex items-center justify-between gap-2"
              >
                <button
                  type="button"
                  onClick={() => startEditChore(c)}
                  className="flex items-center gap-2.5 min-w-0 text-left flex-1"
                >
                  <div className="w-10 h-10 rounded-xl bg-[#F8F9FA] dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#334155] flex items-center justify-center shrink-0">
                    <ChoreIcon icon={c.icon} className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                      {c.title}
                      {c.require_before_after && (
                        <span className="ml-1.5 text-[10px] font-semibold text-[#D97706]">
                          (Trước/Sau {c.min_duration_minutes}p)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
                      +{c.points} đ • Phạt {c.penalty_amount.toLocaleString('vi-VN')}đ • Chờ{' '}
                      {c.cooldown_minutes}p
                    </p>
                  </div>
                </button>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => moveChore(c.id, 'up')}
                    aria-label="Lên"
                    className="w-9 h-9 rounded-lg border border-[#E5E7EB] dark:border-[#334155] flex items-center justify-center disabled:opacity-30"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === chores.length - 1}
                    onClick={() => moveChore(c.id, 'down')}
                    aria-label="Xuống"
                    className="w-9 h-9 rounded-lg border border-[#E5E7EB] dark:border-[#334155] flex items-center justify-center disabled:opacity-30"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteChore(c.id)}
                    aria-label="Xóa"
                    className="w-9 h-9 rounded-lg text-[#DC2626] hover:bg-[#FEF2F2] dark:hover:bg-[#450A0A] flex items-center justify-center"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. 10-Slot Member Roster */}
      {(section === 'members' || (section === 'flags' && desktopRightSection === 'members')) && (
        <div className={`${section === 'members' ? 'block' : 'hidden md:block'} space-y-3`}>
          <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
                Thêm thành viên mới
              </h3>
              <span className="px-2.5 py-1 rounded-lg bg-[#F3F4F6] dark:bg-[#0F172A] text-xs font-bold tabular-nums">
                {memberRoster.length} / 10 slot
              </span>
            </div>

            <form onSubmit={handleCreateMember} className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={memUsername}
                  onChange={(e) => setMemUsername(e.target.value)}
                  placeholder="Tên đăng nhập"
                  required
                  className="h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm"
                />
                <input
                  type="text"
                  value={memDisplayName}
                  onChange={(e) => setMemDisplayName(e.target.value)}
                  placeholder="Tên hiển thị"
                  className="h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="\d{6}"
                  value={memPin}
                  onChange={(e) => setMemPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Mã PIN 6 số"
                  required
                  className="h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm tabular-nums"
                />
                <input
                  type="number"
                  min={0}
                  step={50000}
                  value={memAllowance}
                  onChange={(e) => setMemAllowance(e.target.value)}
                  placeholder="Quỹ tuần (VNĐ)"
                  className="h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm tabular-nums"
                />
              </div>

              <label className="flex items-center justify-between rounded-xl bg-[#F8F9FA] dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#334155] px-3 py-2.5 cursor-pointer">
                <span className="text-xs font-semibold text-[#111827] dark:text-[#F8FAFC]">
                  Cấp quyền giao việc (Người giao việc)
                </span>
                <input
                  type="checkbox"
                  checked={memCanAssign}
                  onChange={(e) => setMemCanAssign(e.target.checked)}
                  className="w-4 h-4 accent-[#059669]"
                />
              </label>

              <button
                type="submit"
                disabled={savingMember || memberRoster.length >= 10}
                className="w-full h-12 rounded-xl bg-[#059669] disabled:opacity-50 text-white text-sm font-semibold"
              >
                {savingMember ? 'Đang thêm...' : 'Thêm thành viên'}
              </button>
            </form>
          </div>

          <div className="space-y-2.5">
            {memberRoster.map((m) => (
              <div
                key={m.id}
                className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-3.5 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                      {m.display_name}{' '}
                      {!m.is_active && (
                        <span className="text-[11px] font-semibold text-[#DC2626]">(Đã khóa)</span>
                      )}
                    </p>
                    <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
                      @{m.username} • Số dư: {m.current_balance.toLocaleString('vi-VN')}đ
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {bonusRewardConfig.enabled && m.id !== currentUserId && (
                      <button
                        type="button"
                        onClick={() =>
                          onAwardBonus({
                            recipientId: m.id,
                            recipientName: m.display_name,
                          })
                        }
                        title="Thưởng trực tiếp"
                        className="h-10 px-2.5 rounded-xl bg-[#FFFBEB] dark:bg-[#451A03]/60 border border-[#FDE68A] dark:border-[#92400E] text-[#B45309] dark:text-[#FCD34D] text-xs font-bold inline-flex items-center gap-1"
                      >
                        <Gift className="w-3.5 h-3.5" />
                        Thưởng trực tiếp
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setResetPinId(resetPinId === m.id ? null : m.id);
                        setResetPinVal('');
                      }}
                      title="Đổi mã PIN"
                      className="h-10 px-2.5 rounded-xl border border-[#E5E7EB] dark:border-[#334155] text-xs font-medium inline-flex items-center gap-1"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      PIN
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMemberActive(m)}
                      title={m.is_active ? 'Khóa tài khoản' : 'Mở khóa'}
                      className="w-10 h-10 rounded-xl border border-[#E5E7EB] dark:border-[#334155] flex items-center justify-center"
                    >
                      {m.is_active ? (
                        <UserX className="w-4 h-4 text-[#D97706]" />
                      ) : (
                        <UserCheck className="w-4 h-4 text-[#059669]" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMember(m.id)}
                      title="Xóa thành viên"
                      className="w-10 h-10 rounded-xl text-[#DC2626] hover:bg-[#FEF2F2] dark:hover:bg-[#450A0A] flex items-center justify-center"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl bg-[#F8F9FA] dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#334155] px-3 py-2">
                  <span className="text-xs font-semibold text-[#374151] dark:text-[#CBD5E1]">
                    Quyền giao việc
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={m.can_assign_tasks}
                    onClick={() => toggleCanAssign(m)}
                    className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 ${
                      m.can_assign_tasks ? 'bg-[#059669]' : 'bg-[#D1D5DB] dark:bg-[#475569]'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        m.can_assign_tasks ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-0.5">
                      Định mức quỹ tuần (VNĐ)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={50000}
                      value={allowanceEdits[m.id] ?? String(m.weekly_allowance)}
                      onChange={(e) =>
                        setAllowanceEdits((prev) => ({ ...prev, [m.id]: e.target.value }))
                      }
                      className="w-full h-10 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-xs tabular-nums"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => saveMemberAllowance(m)}
                    className="mt-4 h-10 px-3 rounded-xl bg-[#111827] dark:bg-[#059669] text-white text-xs font-semibold shrink-0"
                  >
                    Lưu quỹ
                  </button>
                  <button
                    type="button"
                    onClick={() => resetMemberBalanceNow(m)}
                    className="mt-4 h-10 px-2.5 rounded-xl border border-[#E5E7EB] dark:border-[#334155] text-xs font-medium shrink-0"
                  >
                    Cấp lại
                  </button>
                </div>

                {resetPinId === m.id && (
                  <div className="flex gap-2 pt-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={resetPinVal}
                      onChange={(e) => setResetPinVal(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="Nhập PIN 6 số mới"
                      className="flex-1 h-11 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => submitResetPin(m.id)}
                      className="h-11 px-4 rounded-xl bg-[#111827] dark:bg-[#059669] text-white text-xs font-semibold"
                    >
                      Lưu PIN
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Weekly Settlement, Party Fund, Adjustments, Retention & Quality Moderation */}
      {(section === 'data' || (section === 'flags' && desktopRightSection === 'data')) && (
        <div className={`${section === 'data' ? 'block' : 'hidden md:block'} space-y-3`}>
          {/* Highlighted Flagged ("Làm ẩu") Moderation Queue */}
          {flaggedLogs.length > 0 && (
            <div className="bg-[#FFFBEB] dark:bg-[#451A03]/40 border border-[#F59E0B] dark:border-[#D97706] rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center gap-1.5 text-sm font-bold text-[#B45309] dark:text-[#FCD34D]">
                <AlertTriangle className="w-4 h-4" />
                Cần duyệt báo cáo &ldquo;Làm ẩu&rdquo; ({flaggedLogs.length})
              </div>
              {flaggedLogs.map((log) => (
                <div
                  key={log.id}
                  className="bg-white dark:bg-[#1E293B] rounded-xl p-3 space-y-2 border border-[#FDE68A] dark:border-[#92400E]"
                >
                  <button
                    type="button"
                    onClick={() => onInspectPhoto(log)}
                    className="flex items-center gap-2.5 w-full text-left"
                  >
                    <ProtectedImage
                      src={log.thumb_url || log.proof_url}
                      alt={log.chore_title}
                      className="w-11 h-11 rounded-lg shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate">
                        {log.member_name} • {log.chore_title}
                      </p>
                      <p className="text-[11px] text-[#6B7280] tabular-nums">
                        {formatIsoToVn(log.server_timestamp)}
                      </p>
                    </div>
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onModerate(log, 'rework_half_penalty')}
                      className="h-9 rounded-lg bg-[#D97706] text-white text-xs font-semibold"
                    >
                      Làm lại / Phạt 50%
                    </button>
                    <button
                      type="button"
                      onClick={() => onModerate(log, 'reject')}
                      className="h-9 rounded-lg bg-[#DC2626] text-white text-xs font-semibold"
                    >
                      Hủy hoàn toàn
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Weekly Settlement + Close Week Button + Party Fund */}
          <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-[#059669]" />
                <h3 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
                  Quyết toán tuần & Quỹ Liên Hoan
                </h3>
              </div>
            </div>

            <div className="rounded-xl bg-[#FFFBEB] dark:bg-[#451A03]/40 border border-[#FDE68A] dark:border-[#92400E] p-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold text-[#B45309] dark:text-[#FCD34D]">
                  Quỹ Liên Hoan Chung
                </p>
                <p className="text-base font-bold text-[#92400E] dark:text-[#FDE68A] tabular-nums">
                  {sharedPartyFund.balance.toLocaleString('vi-VN')}đ
                </p>
              </div>
              <button
                type="button"
                disabled={sharedPartyFund.balance === 0}
                onClick={() => updatePartyFund({ reset_balance: true })}
                className="h-9 px-3 rounded-lg bg-[#D97706] disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Chi quỹ / 0đ
              </button>
            </div>

            {weeklySettlement.length > 0 && (
              <div className="divide-y divide-[#F3F4F6] dark:divide-[#334155] text-xs tabular-nums">
                {weeklySettlement.map((r) => (
                  <div key={r.profile_id} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                        {r.display_name}
                      </p>
                      <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8]">
                        Cấp {r.weekly_allowance.toLocaleString('vi-VN')}đ • Trừ -
                        {(r.total_penalties + r.total_bounty_paid).toLocaleString('vi-VN')}đ • Hộ +
                        {r.total_bounty_earned.toLocaleString('vi-VN')}đ
                      </p>
                    </div>
                    <span className="font-bold text-[#059669] shrink-0">
                      {r.current_balance.toLocaleString('vi-VN')}đ
                    </span>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              disabled={closingWeek}
              onClick={handleCloseWeekSettlement}
              className="w-full h-12 rounded-xl bg-[#111827] dark:bg-[#059669] text-white text-sm font-semibold flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              {closingWeek ? 'Đang chốt sổ...' : 'Chốt sổ tuần mới'}
            </button>
          </div>

          {/* Manual Balance Adjustment / Refund */}
          <form
            onSubmit={handleManualAdjustment}
            className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-3"
          >
            <div>
              <h3 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
                Điều chỉnh / Hoàn tiền ví quỹ tuần
              </h3>
              <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] mt-0.5">
                Hoàn tiền khi thành viên khiếu nại hợp lệ hoặc cộng/trừ số dư thủ công.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={adjProfileId}
                onChange={(e) => setAdjProfileId(e.target.value)}
                required
                className="h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name} ({m.current_balance.toLocaleString('vi-VN')}đ)
                  </option>
                ))}
              </select>

              <select
                value={adjType}
                onChange={(e) => setAdjType(e.target.value as 'refund' | 'deduct')}
                className="h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm"
              >
                <option value="refund">+ Hoàn tiền / Cộng quỹ</option>
                <option value="deduct">- Trừ số dư</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                min={1000}
                step={5000}
                value={adjAmount}
                onChange={(e) => setAdjAmount(e.target.value)}
                placeholder="Số tiền"
                required
                className="h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm tabular-nums"
              />
              <input
                type="text"
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder="Lý do điều chỉnh"
                required
                className="col-span-2 h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={savingAdj}
              className="w-full h-12 rounded-xl bg-[#059669] text-white text-sm font-semibold"
            >
              {savingAdj ? 'Đang cập nhật...' : 'Xác nhận điều chỉnh số dư'}
            </button>

            {fundTransactions.length > 0 && (
              <div className="pt-2 border-t border-[#F3F4F6] dark:border-[#334155] space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#6B7280] dark:text-[#94A3B8]">
                  Biến động quỹ gần đây
                </p>
                {fundTransactions.slice(0, 6).map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between gap-2 text-xs py-1 tabular-nums"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold truncate text-[#111827] dark:text-[#F8FAFC]">
                        {tx.member_name} • {tx.description}
                      </p>
                      <p className="text-[10px] text-[#6B7280] dark:text-[#94A3B8]">
                        {formatIsoToVn(tx.server_timestamp)}
                      </p>
                    </div>
                    <span
                      className={`font-bold shrink-0 ${
                        tx.amount >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'
                      }`}
                    >
                      {tx.amount >= 0 ? '+' : ''}
                      {tx.amount.toLocaleString('vi-VN')}đ
                    </span>
                  </div>
                ))}
              </div>
            )}
          </form>

          {/* Retention & Backup */}
          <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
                Lưu trữ & Tự động dọn dẹp
              </h3>
              <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] mt-0.5">
                Tự động xóa nhật ký & ảnh xác thực quá hạn để giữ dung lượng miễn phí 1GB.
              </p>
            </div>

            <form onSubmit={saveRetentionDays} className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
                  Chu kỳ lưu trữ (ngày)
                </label>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={retInput}
                  onChange={(e) => setRetInput(e.target.value)}
                  className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm tabular-nums"
                />
              </div>
              <button
                type="submit"
                className="h-12 px-4 rounded-xl bg-[#111827] dark:bg-[#059669] text-white text-sm font-semibold"
              >
                Lưu
              </button>
            </form>

            {lastCleanupAt && (
              <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
                Lần dọn dẹp gần nhất: {formatIsoToVn(lastCleanupAt)}
              </p>
            )}

            <div className="grid grid-cols-1 gap-2 pt-1">
              <a
                href="/api/admin/export-csv"
                className="w-full h-12 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-[#111827] dark:text-[#F8FAFC] text-sm font-semibold flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                Xuất báo cáo CSV (Backup)
              </a>

              <button
                type="button"
                disabled={cleaningUp}
                onClick={triggerManualCleanup}
                className="w-full h-12 rounded-xl bg-[#FEF2F2] dark:bg-[#450A0A] border border-[#FECACA] dark:border-[#7F1D1D] text-[#B91C1C] dark:text-[#FCA5A5] text-sm font-semibold flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                {cleaningUp ? 'Đang dọn dẹp...' : 'Dọn dẹp dữ liệu quá hạn ngay'}
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-2.5">
            <h3 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
              Kiểm duyệt ảnh gần đây
            </h3>
            {logs.slice(0, 8).map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between gap-2.5 py-2 border-t border-[#F3F4F6] dark:border-[#334155] first:border-t-0"
              >
                <button
                  type="button"
                  onClick={() => onInspectPhoto(log)}
                  className="flex items-center gap-2.5 min-w-0 text-left flex-1"
                >
                  <ProtectedImage
                    src={log.thumb_url || log.proof_url}
                    alt={log.chore_title}
                    className="w-10 h-10 rounded-lg border border-[#E5E7EB] dark:border-[#334155] shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate">
                      {log.member_name} • {log.chore_title}
                    </p>
                    <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
                      {formatIsoToVn(log.server_timestamp)}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onModerate(log, 'reject')}
                  className="h-9 px-2.5 rounded-lg bg-[#FEF2F2] dark:bg-[#450A0A] text-[#DC2626] dark:text-[#FCA5A5] text-[11px] font-semibold shrink-0"
                >
                  Hủy lượt
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
