'use client';

import { useState, type FormEvent } from 'react';
import { CalendarClock, CheckCircle2, ClipboardList, PauseCircle, PlayCircle, Plus, Trash2 } from 'lucide-react';
import type {
  AssignedChoreItem,
  AssignmentScheduleType,
  Chore,
  ProfilePublic,
} from '@/lib/types';
import { ChoreIcon } from './ChoreIcon';

interface AssignTasksPanelProps {
  chores: Chore[];
  members: ProfilePublic[];
  assignedChores: AssignedChoreItem[];
  currentVnDate: string;
  onRefresh: () => Promise<void>;
}

const WEEKDAY_CHIPS = [
  { val: 1, label: 'T2' },
  { val: 2, label: 'T3' },
  { val: 3, label: 'T4' },
  { val: 4, label: 'T5' },
  { val: 5, label: 'T6' },
  { val: 6, label: 'T7' },
  { val: 0, label: 'CN' },
];

function formatScheduleLabel(a: AssignedChoreItem): string {
  if (a.schedule_type === 'daily') return `Hàng ngày • Hạn ${a.due_time}`;
  if (a.schedule_type === 'once') {
    const d = a.due_date ? a.due_date.split('-').reverse().join('/') : '';
    return `1 lần (${d}) • Hạn ${a.due_time}`;
  }
  const dayNames = a.days_of_week
    .map((d) => WEEKDAY_CHIPS.find((w) => w.val === d)?.label)
    .filter(Boolean)
    .join(', ');
  return `${dayNames || 'Theo tuần'} • Hạn ${a.due_time}`;
}

export function AssignTasksPanel({
  chores,
  members,
  assignedChores,
  currentVnDate,
  onRefresh,
}: AssignTasksPanelProps) {
  const activeChores = chores.filter((c) => c.is_active);
  const activeMembers = members.filter((m) => m.is_active);

  const [choreId, setChoreId] = useState(activeChores[0]?.id || '');
  const [assigneeId, setAssigneeId] = useState(
    activeMembers.find((m) => m.role === 'member')?.id || activeMembers[0]?.id || '',
  );
  const [scheduleType, setScheduleType] = useState<AssignmentScheduleType>('daily');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 3, 5]);
  const [dueDate, setDueDate] = useState(currentVnDate);
  const [dueTime, setDueTime] = useState('22:00');
  const [penaltyAmount, setPenaltyAmount] = useState(
    String(activeChores[0]?.penalty_amount ?? 20000),
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  function showMsg(type: 'ok' | 'err', text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3500);
  }

  function handleChoreChange(nextId: string) {
    setChoreId(nextId);
    const found = activeChores.find((c) => c.id === nextId);
    if (found) {
      setPenaltyAmount(String(found.penalty_amount ?? 20000));
    }
  }

  function toggleDay(dayVal: number) {
    setDaysOfWeek((prev) =>
      prev.includes(dayVal) ? prev.filter((d) => d !== dayVal) : [...prev, dayVal],
    );
  }

  async function handleAssign(e: FormEvent) {
    e.preventDefault();
    if (!choreId || !assigneeId) {
      showMsg('err', 'Vui lòng chọn việc nhà và người nhận.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chore_id: choreId,
          assignee_id: assigneeId,
          schedule_type: scheduleType,
          days_of_week: daysOfWeek,
          due_date: scheduleType === 'once' ? dueDate : null,
          due_time: dueTime,
          penalty_amount: Number(penaltyAmount || 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg('err', data?.error || 'Không thể giao việc.');
        return;
      }
      await onRefresh();
      showMsg('ok', 'Đã giao việc thành công!');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item: AssignedChoreItem) {
    await fetch('/api/assignments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, is_active: !item.is_active }),
    });
    await onRefresh();
  }

  async function removeAssignment(id: string) {
    await fetch(`/api/assignments?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await onRefresh();
    showMsg('ok', 'Đã xóa lịch giao việc.');
  }

  return (
    <div className="space-y-3.5">
      <form
        onSubmit={handleAssign}
        className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-[#059669]" />
          <h3 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
            Giao việc mới cho thành viên
          </h3>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
              Đầu việc
            </label>
            <select
              value={choreId}
              onChange={(e) => handleChoreChange(e.target.value)}
              required
              className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm"
            >
              {activeChores.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
              Người thực hiện
            </label>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              required
              className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm"
            >
              {activeMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
            Tần suất lặp lại
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                { key: 'daily', label: 'Hàng ngày' },
                { key: 'weekly_days', label: 'Theo thứ' },
                { key: 'once', label: 'Một lần' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setScheduleType(opt.key)}
                className={`h-11 rounded-xl text-xs font-semibold border transition ${
                  scheduleType === opt.key
                    ? 'bg-[#059669] border-[#059669] text-white'
                    : 'bg-[#F8F9FA] dark:bg-[#0F172A] border-[#E5E7EB] dark:border-[#334155] text-[#374151] dark:text-[#CBD5E1]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {scheduleType === 'weekly_days' && (
          <div>
            <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1.5">
              Chọn các ngày trong tuần
            </label>
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAY_CHIPS.map((d) => {
                const selected = daysOfWeek.includes(d.val);
                return (
                  <button
                    key={d.val}
                    type="button"
                    onClick={() => toggleDay(d.val)}
                    className={`h-10 rounded-lg text-xs font-bold border transition ${
                      selected
                        ? 'bg-[#111827] dark:bg-[#059669] border-transparent text-white'
                        : 'bg-[#F8F9FA] dark:bg-[#0F172A] border-[#E5E7EB] dark:border-[#334155] text-[#6B7280] dark:text-[#94A3B8]'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {scheduleType === 'once' && (
          <div>
            <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
              Ngày hạn chót
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
              className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm tabular-nums"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
              Giờ chốt hạn (UTC+7)
            </label>
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              required
              className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
              Phạt trễ hạn (VNĐ)
            </label>
            <input
              type="number"
              min={0}
              step={5000}
              value={penaltyAmount}
              onChange={(e) => setPenaltyAmount(e.target.value)}
              className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm tabular-nums"
            />
          </div>
        </div>

        {msg && (
          <div
            className={`rounded-xl px-3 py-2 text-xs font-medium border ${
              msg.type === 'ok'
                ? 'bg-[#ECFDF5] dark:bg-[#064E3B] border-[#A7F3D0] text-[#047857] dark:text-[#6EE7B7]'
                : 'bg-[#FEF2F2] dark:bg-[#450A0A] border-[#FECACA] text-[#B91C1C] dark:text-[#FCA5A5]'
            }`}
          >
            {msg.text}
          </div>
        )}

        <button
          type="submit"
          disabled={saving || activeChores.length === 0 || activeMembers.length === 0}
          className="w-full h-12 rounded-xl bg-[#059669] hover:bg-[#047857] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          {saving ? 'Đang giao việc...' : 'Xác nhận giao việc'}
        </button>
      </form>

      {/* Assigned List */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h4 className="text-xs font-bold uppercase tracking-wide text-[#6B7280] dark:text-[#94A3B8]">
            Lịch đang phân công ({assignedChores.length})
          </h4>
        </div>

        {assignedChores.length === 0 ? (
          <div className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-6 text-center text-xs text-[#6B7280] dark:text-[#94A3B8]">
            Chưa có nhiệm vụ riêng nào được giao.
          </div>
        ) : (
          assignedChores.map((item) => (
            <div
              key={item.id}
              className={`bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-3.5 space-y-2 ${
                !item.is_active ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#F8F9FA] dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#334155] flex items-center justify-center shrink-0">
                    <ChoreIcon icon={item.chore_icon} className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                      {item.chore_title} →{' '}
                      <span className="text-[#059669] dark:text-[#34D399]">
                        {item.assignee_name}
                      </span>
                    </p>
                    <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] flex items-center gap-1 mt-0.5 tabular-nums">
                      <CalendarClock className="w-3.5 h-3.5 shrink-0" />
                      {formatScheduleLabel(item)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleActive(item)}
                    title={item.is_active ? 'Tạm dừng' : 'Kích hoạt'}
                    className="w-9 h-9 rounded-lg border border-[#E5E7EB] dark:border-[#334155] flex items-center justify-center text-[#6B7280]"
                  >
                    {item.is_active ? (
                      <PauseCircle className="w-4 h-4 text-[#D97706]" />
                    ) : (
                      <PlayCircle className="w-4 h-4 text-[#059669]" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeAssignment(item.id)}
                    title="Xóa lịch giao"
                    className="w-9 h-9 rounded-lg text-[#DC2626] hover:bg-[#FEF2F2] dark:hover:bg-[#450A0A] flex items-center justify-center"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-1 border-t border-[#F3F4F6] dark:border-[#334155] tabular-nums">
                <span className="text-[#B45309] dark:text-[#FCD34D] font-semibold">
                  Phạt trễ: -{item.penalty_amount.toLocaleString('vi-VN')}đ
                </span>

                {item.cycle_status === 'completed' ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-[#059669] dark:text-[#34D399]">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Đã xong hôm nay
                  </span>
                ) : item.cycle_status === 'missed' ? (
                  <span className="font-semibold text-[#DC2626] dark:text-[#F87171]">
                    Quá hạn / Đã trừ phạt
                  </span>
                ) : item.cycle_status === 'pending' ? (
                  <span className="font-medium text-[#6B7280] dark:text-[#94A3B8]">
                    Đang chờ hôm nay
                  </span>
                ) : (
                  <span className="font-medium text-[#6B7280] dark:text-[#94A3B8]">
                    Chưa đến lịch
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
