'use client';

import { useState, type FormEvent } from 'react';
import { ArrowRightLeft, Coins, X } from 'lucide-react';
import type { AssignedChoreItem, ProfilePublic } from '@/lib/types';
import { haptic } from '@/lib/offlineQueue';
import { signedFetch } from '@/lib/requestSigner';

interface ShiftSwapSheetProps {
  assignment: AssignedChoreItem | null;
  members: ProfilePublic[];
  me: ProfilePublic;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

const BOUNTY_PRESETS = [0, 10000, 20000, 30000];

export function ShiftSwapSheet({
  assignment,
  members,
  me,
  onClose,
  onCreated,
}: ShiftSwapSheetProps) {
  const [targetId, setTargetId] = useState('');
  const [bounty, setBounty] = useState(10000);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!assignment) return null;

  const candidates = members.filter((m) => m.is_active && m.id !== me.id);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!assignment || !assignment.current_cycle_key) return;
    setSaving(true);
    setError(null);
    haptic(15);

    try {
      const res = await signedFetch('/api/swaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_chore_id: assignment.id,
          cycle_key: assignment.current_cycle_key,
          target_id: targetId || null,
          bounty_amount: bounty,
          note: note.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Không thể gửi yêu cầu chuyển ca.');
        return;
      }
      await onCreated();
      onClose();
    } catch {
      setError('Lỗi mạng khi gửi yêu cầu.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center pt-[calc(env(safe-area-inset-top,20px)+12px)] md:p-4 bg-black/55 backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white dark:bg-[#0B1215] border-t md:border border-[#E5E7EB] dark:border-[#334155] rounded-t-3xl md:rounded-2xl px-5 pt-4 pb-[max(1.75rem,env(safe-area-inset-bottom))] md:p-5 shadow-2xl space-y-4 max-h-full overflow-y-auto"
      >
        <div className="w-10 h-1 rounded-full bg-[#D1D5DB] dark:bg-[#475569] mx-auto -mt-1 md:hidden" />

        <div className="sticky top-0 z-20 bg-white dark:bg-[#0B1215] pb-1 flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#D97706]">
              <ArrowRightLeft className="w-3.5 h-3.5" />
              Nhờ làm hộ (Chuyển ca)
            </div>
            <h2 className="text-lg font-bold text-[#111827] dark:text-[#F8FAFC] mt-0.5">
              {assignment.chore_title}
            </h2>
            <p className="text-xs text-[#6B7280] dark:text-[#94A3B8]">
              Khi có người nhận, trách nhiệm & tiền thưởng sẽ chuyển cho người làm hộ.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="w-11 h-11 rounded-xl bg-[#F3F4F6] dark:bg-[#0F172A] flex items-center justify-center text-[#6B7280]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
              Gửi yêu cầu tới
            </label>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm"
            >
              <option value="">Đăng lên bảng chung (Ai rảnh nhận)</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-[#6B7280] dark:text-[#94A3B8] flex items-center gap-1">
                <Coins className="w-3.5 h-3.5 text-[#D97706]" />
                Thưởng làm hộ (từ ví của bạn)
              </label>
              <span className="text-[11px] text-[#6B7280] tabular-nums">
                Số dư: {me.current_balance.toLocaleString('vi-VN')}đ
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {BOUNTY_PRESETS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setBounty(amt)}
                  className={`h-11 rounded-xl text-xs font-bold border tabular-nums ${
                    bounty === amt
                      ? 'bg-[#059669] border-[#059669] text-white'
                      : 'bg-[#F8F9FA] dark:bg-[#0F172A] border-[#E5E7EB] dark:border-[#334155]'
                  }`}
                >
                  {amt === 0 ? '0đ' : `${amt / 1000}k`}
                </button>
              ))}
            </div>
          </div>

          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Lời nhắn (VD: Hôm nay mình về trễ, giúp nhé!)"
            className="w-full h-12 px-3 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm"
          />

          {error && (
            <div className="rounded-xl bg-[#FEF2F2] dark:bg-[#450A0A] border border-[#FECACA] px-3 py-2 text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full h-12 rounded-xl bg-[#D97706] hover:bg-[#B45309] disabled:opacity-50 text-white font-semibold text-sm"
          >
            {saving ? 'Đang gửi...' : 'Đăng yêu cầu nhờ làm hộ'}
          </button>
        </form>
      </div>
    </div>
  );
}
