'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Database,
  Download,
  KeyRound,
  Plus,
  Shield,
  Sliders,
  Trash2,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import type { Chore, ChoreFrequency, ChoreLogItem, FeatureFlags, ProfilePublic } from '@/lib/types';
import { formatIsoToVn } from '@/lib/time';
import { CHORE_ICON_OPTIONS, ChoreIcon } from './ChoreIcon';

interface AdminPanelProps {
  chores: Chore[];
  logs: ChoreLogItem[];
  members: ProfilePublic[];
  featureFlags: FeatureFlags;
  retentionDays: number;
  lastCleanupAt: string | null;
  onRefresh: () => Promise<void>;
  onModerate: (log: ChoreLogItem) => Promise<void>;
  onInspectPhoto: (log: ChoreLogItem) => void;
}

type AdminSection = 'flags' | 'chores' | 'members' | 'data';

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
    title: 'Quỹ phạt & Nhắc nhở',
    desc: 'Cảnh báo việc định kỳ bị bỏ sót và theo dõi quỹ đóng phạt chung.',
  },
];

export function AdminPanel({
  chores,
  logs,
  members,
  featureFlags,
  retentionDays,
  lastCleanupAt,
  onRefresh,
  onModerate,
  onInspectPhoto,
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
  const [savingChore, setSavingChore] = useState(false);

  // Member form state
  const [memUsername, setMemUsername] = useState('');
  const [memDisplayName, setMemDisplayName] = useState('');
  const [memPin, setMemPin] = useState('');
  const [savingMember, setSavingMember] = useState(false);
  const [resetPinId, setResetPinId] = useState<string | null>(null);
  const [resetPinVal, setResetPinVal] = useState('');

  // Retention state
  const [retInput, setRetInput] = useState(String(retentionDays));
  const [cleaningUp, setCleaningUp] = useState(false);

  useEffect(() => {
    setRetInput(String(retentionDays));
  }, [retentionDays]);

  const memberRoster = members.filter((m) => m.role === 'member');

  function notify(type: 'ok' | 'err', text: string) {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 4000);
  }

  async function toggleFeature(key: keyof FeatureFlags) {
    const nextFlags = { ...featureFlags, [key]: !featureFlags[key] };
    const res = await fetch('/api/admin/settings', {
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

  function startEditChore(c: Chore) {
    setEditingChoreId(c.id);
    setChoreTitle(c.title);
    setChoreIcon(c.icon);
    setChorePoints(String(c.points));
    setChoreCooldown(String(c.cooldown_minutes));
    setChoreFreq(c.frequency);
    setChorePenalty(String(c.penalty_amount || 20000));
  }

  function resetChoreForm() {
    setEditingChoreId(null);
    setChoreTitle('');
    setChoreIcon('sparkles');
    setChorePoints('15');
    setChoreCooldown('30');
    setChoreFreq('daily');
    setChorePenalty('20000');
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
      };
      const res = await fetch('/api/admin/chores', {
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
    await fetch('/api/admin/chores', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, move }),
    });
    await onRefresh();
  }

  async function deleteChore(id: string) {
    await fetch(`/api/admin/chores?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await onRefresh();
    notify('ok', 'Đã xóa công việc.');
  }

  async function handleCreateMember(e: FormEvent) {
    e.preventDefault();
    setSavingMember(true);
    try {
      const res = await fetch('/api/admin/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: memUsername.trim(),
          display_name: memDisplayName.trim() || memUsername.trim(),
          pin: memPin.trim(),
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
      await onRefresh();
      notify('ok', 'Đã tạo tài khoản thành viên mới.');
    } finally {
      setSavingMember(false);
    }
  }

  async function toggleMemberActive(m: ProfilePublic) {
    await fetch('/api/admin/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.id, is_active: !m.is_active }),
    });
    await onRefresh();
    notify('ok', m.is_active ? `Đã tạm khóa ${m.display_name}.` : `Đã mở khóa ${m.display_name}.`);
  }

  async function submitResetPin(id: string) {
    const res = await fetch('/api/admin/members', {
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
    await fetch(`/api/admin/members?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await onRefresh();
    notify('ok', 'Đã xóa thành viên.');
  }

  async function saveRetentionDays(e: FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/settings', {
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
      const res = await fetch('/api/admin/cleanup', { method: 'POST' });
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

  return (
    <div className="space-y-3.5">
      {/* Admin Sub-Navigation */}
      <div className="grid grid-cols-4 gap-1.5 bg-[#F3F4F6] dark:bg-[#1E293B] p-1 rounded-2xl border border-[#E5E7EB] dark:border-[#334155]">
        {(
          [
            { key: 'flags', label: 'Tính năng', icon: Sliders },
            { key: 'chores', label: 'Việc nhà', icon: Shield },
            { key: 'members', label: 'Thành viên', icon: Users },
            { key: 'data', label: 'Dữ liệu', icon: Database },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = section === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSection(tab.key)}
              className={`h-11 rounded-xl text-[11px] font-semibold flex flex-col items-center justify-center gap-0.5 transition ${
                active
                  ? 'bg-white dark:bg-[#0F172A] text-[#059669] shadow-sm'
                  : 'text-[#6B7280] dark:text-[#94A3B8]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
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

      {/* 1. Feature Flags */}
      {section === 'flags' && (
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
      )}

      {/* 2. Chore & Cooldown Management */}
      {section === 'chores' && (
        <div className="space-y-3">
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
              placeholder="Tên công việc (VD: Giặt đồ)"
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
                  Phạt (đ)
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
                    </p>
                    <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
                      +{c.points} đ • Chờ {c.cooldown_minutes}p •{' '}
                      {c.frequency === 'daily'
                        ? 'Hàng ngày'
                        : c.frequency === 'weekly'
                          ? 'Hàng tuần'
                          : 'Tự do'}
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

      {/* 3. 10-Slot Member Roster */}
      {section === 'members' && (
        <div className="space-y-3">
          <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
                Danh sách thành viên
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

              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="\d{6}"
                  value={memPin}
                  onChange={(e) => setMemPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Mã PIN 6 số (VD: 123456)"
                  required
                  className="flex-1 h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm tabular-nums"
                />
                <button
                  type="submit"
                  disabled={savingMember || memberRoster.length >= 10}
                  className="h-12 px-4 rounded-xl bg-[#059669] disabled:opacity-50 text-white text-sm font-semibold shrink-0"
                >
                  {savingMember ? 'Đang thêm...' : 'Thêm'}
                </button>
              </div>
            </form>
          </div>

          <div className="space-y-2">
            {memberRoster.map((m) => (
              <div
                key={m.id}
                className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-3.5 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                      {m.display_name}{' '}
                      {!m.is_active && (
                        <span className="text-[11px] font-semibold text-[#DC2626]">(Đã khóa)</span>
                      )}
                    </p>
                    <p className="text-xs text-[#6B7280] dark:text-[#94A3B8]">@{m.username}</p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
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

      {/* 4. Data Retention, Backup CSV & Quick Moderation */}
      {section === 'data' && (
        <div className="space-y-3">
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={log.proof_url}
                    alt={log.chore_title}
                    className="w-10 h-10 rounded-lg object-cover border border-[#E5E7EB] dark:border-[#334155] shrink-0"
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
                  onClick={() => onModerate(log)}
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
  );
}
