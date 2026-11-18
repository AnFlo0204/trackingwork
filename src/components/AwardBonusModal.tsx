'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Gift, Sparkles, X } from 'lucide-react';
import { haptic } from '@/lib/offlineQueue';
import { signedFetch } from '@/lib/requestSigner';

export interface BonusTarget {
  logId?: string | null;
  recipientId: string;
  recipientName: string;
  defaultNote?: string;
}

interface AwardBonusModalProps {
  target: BonusTarget | null;
  maxDelegatedCap: number | null; // null = Admin unlimited
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

const PRESET_AMOUNTS = [10000, 20000, 50000];

export function AwardBonusModal({
  target,
  maxDelegatedCap,
  onClose,
  onSuccess,
}: AwardBonusModalProps) {
  const [amount, setAmount] = useState('20000');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      const initAmt =
        maxDelegatedCap !== null && maxDelegatedCap < 20000
          ? String(Math.max(1000, maxDelegatedCap))
          : '20000';
      setAmount(initAmt);
      setNote(target.defaultNote || '');
      setError(null);
      setSubmitting(false);
    }
  }, [target, maxDelegatedCap]);

  if (!target) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;

    const val = Math.round(Number(amount || 0));
    if (!Number.isFinite(val) || val < 1000) {
      setError('Số tiền thưởng tối thiểu là 1.000đ.');
      return;
    }
    if (maxDelegatedCap !== null && val > maxDelegatedCap) {
      setError(
        `Người giao việc chỉ được thưởng tối đa ${maxDelegatedCap.toLocaleString('vi-VN')}đ mỗi lượt.`,
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    haptic(15);

    try {
      const res = await signedFetch('/api/bonus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientId: target.recipientId,
          logId: target.logId || null,
          amount: val,
          reason: note.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Không thể gửi tiền thưởng.');
        return;
      }
      await onSuccess();
      onClose();
    } catch {
      setError('Lỗi kết nối khi tặng thưởng.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end md:items-center justify-center pt-[calc(env(safe-area-inset-top,20px)+12px)] md:p-4 bg-black/60 backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-[#0B1215] border-t md:border border-[#E5E7EB] dark:border-[#334155] rounded-t-3xl md:rounded-2xl px-5 pt-4 pb-[max(1.75rem,env(safe-area-inset-bottom))] md:p-5 shadow-2xl space-y-4 max-h-full overflow-y-auto"
      >
        <div className="w-10 h-1 rounded-full bg-[#D1D5DB] dark:bg-[#475569] mx-auto -mt-1 shrink-0 md:hidden" />

        <div className="sticky top-0 z-20 bg-white dark:bg-[#0B1215] pb-1 flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#D97706] dark:text-[#FBBF24]">
              <Gift className="w-3.5 h-3.5" />
              Tặng thưởng vào quỹ
            </div>
            <h3 className="text-lg font-bold text-[#111827] dark:text-[#F8FAFC] mt-0.5">
              Thưởng cho {target.recipientName}
            </h3>
            {maxDelegatedCap !== null && (
              <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
                Hạn mức tối đa của bạn: {maxDelegatedCap.toLocaleString('vi-VN')}đ / lần
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="w-11 h-11 rounded-full bg-[#F3F4F6] dark:bg-[#1E293B] flex items-center justify-center text-[#374151] dark:text-[#F8FAFC] shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1.5">
              Chọn nhanh mức thưởng
            </label>
            <div className="grid grid-cols-3 gap-2">
              {PRESET_AMOUNTS.map((preset) => {
                const disabledPreset = maxDelegatedCap !== null && preset > maxDelegatedCap;
                const active = Number(amount) === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    disabled={disabledPreset}
                    onClick={() => {
                      haptic(10);
                      setAmount(String(preset));
                    }}
                    className={`h-11 rounded-xl text-xs font-bold border transition tabular-nums disabled:opacity-40 ${
                      active
                        ? 'bg-[#059669] border-[#059669] text-white shadow-sm'
                        : 'bg-[#FFFBEB] dark:bg-[#451A03]/40 border-[#FDE68A] dark:border-[#92400E] text-[#B45309] dark:text-[#FCD34D]'
                    }`}
                  >
                    +{preset.toLocaleString('vi-VN')}đ
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
              Hoặc nhập số tiền tùy chỉnh (VNĐ)
            </label>
            <input
              type="number"
              min={1000}
              step={1000}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="w-full h-12 px-3.5 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-base font-bold text-[#059669] dark:text-[#34D399] tabular-nums"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#6B7280] dark:text-[#94A3B8] mb-1">
              Lời nhắn / Lý do khen thưởng (tuỳ chọn)
            </label>
            <input
              type="text"
              maxLength={140}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: Rửa chén sạch, dọn bếp gọn gàng"
              className="w-full h-11 px-3.5 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-sm"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-[#FEF2F2] dark:bg-[#450A0A] border border-[#FECACA] dark:border-[#991B1B] px-3 py-2 text-xs font-medium text-[#B91C1C] dark:text-[#FCA5A5]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-xl bg-gradient-to-r from-[#059669] to-[#D97706] hover:opacity-95 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm"
          >
            <Sparkles className="w-4 h-4" />
            {submitting
              ? 'Đang cộng vào ví...'
              : `Xác nhận thưởng +${Math.max(0, Number(amount || 0)).toLocaleString('vi-VN')}đ`}
          </button>
        </form>
      </div>
    </div>
  );
}
