'use client';

import { ArrowDownLeft, ArrowUpRight, Gift, Wallet, X } from 'lucide-react';
import type { FundTransactionItem, ProfilePublic } from '@/lib/types';
import { formatIsoToVn } from '@/lib/time';

interface WeeklyWalletDrawerProps {
  open: boolean;
  me: ProfilePublic;
  transactions: FundTransactionItem[];
  onClose: () => void;
}

export function WeeklyWalletDrawer({
  open,
  me,
  transactions,
  onClose,
}: WeeklyWalletDrawerProps) {
  if (!open) return null;

  const myTxs = transactions.filter((t) => t.profile_id === me.id);
  const totalBonusEarned = myTxs
    .filter((t) => t.tx_type === 'BONUS_REWARD' || t.tx_type === 'bonus_reward' || t.category === 'bonus_reward')
    .reduce((acc, t) => acc + Math.max(0, t.amount), 0);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center pt-[calc(env(safe-area-inset-top,20px)+12px)] md:p-4 bg-black/55 backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white dark:bg-[#0B1215] border-t md:border border-[#E5E7EB] dark:border-[#334155] rounded-t-3xl md:rounded-2xl px-5 pt-4 pb-[max(1.75rem,env(safe-area-inset-bottom))] md:p-5 shadow-2xl space-y-4 max-h-full md:max-h-[85vh] flex flex-col"
      >
        <div className="w-10 h-1 rounded-full bg-[#D1D5DB] dark:bg-[#475569] mx-auto -mt-1 shrink-0 md:hidden" />

        <div className="bg-white dark:bg-[#0B1215] z-10 flex items-start justify-between gap-3 shrink-0">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#059669]">
              <Wallet className="w-3.5 h-3.5" />
              Sổ cái quỹ tuần
            </div>
            <h2 className="text-lg font-bold text-[#111827] dark:text-[#F8FAFC] mt-0.5 tabular-nums">
              Số dư: {me.current_balance.toLocaleString('vi-VN')}đ
            </h2>
            <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
              Định mức tuần: {me.weekly_allowance.toLocaleString('vi-VN')}đ
              {totalBonusEarned > 0 && (
                <span className="ml-2 font-bold text-[#D97706] dark:text-[#FCD34D]">
                  • Thưởng làm tốt: +{totalBonusEarned.toLocaleString('vi-VN')}đ
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="w-11 h-11 rounded-xl bg-[#F3F4F6] dark:bg-[#0F172A] flex items-center justify-center text-[#6B7280] dark:text-[#94A3B8] shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#F3F4F6] dark:divide-[#334155]">
          {myTxs.length === 0 ? (
            <p className="py-8 text-center text-xs text-[#6B7280] dark:text-[#94A3B8]">
              Chưa có biến động số dư nào được ghi nhận.
            </p>
          ) : (
            myTxs.map((tx) => {
              const isPositive = tx.amount >= 0;
              const isBonus =
                tx.tx_type === 'BONUS_REWARD' ||
                tx.tx_type === 'bonus_reward' ||
                tx.category === 'bonus_reward';
              return (
                <div key={tx.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isBonus
                          ? 'bg-[#FFFBEB] dark:bg-[#451A03] text-[#D97706] dark:text-[#FCD34D]'
                          : isPositive
                            ? 'bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399]'
                            : 'bg-[#FEF2F2] dark:bg-[#450A0A] text-[#DC2626] dark:text-[#F87171]'
                      }`}
                    >
                      {isBonus ? (
                        <Gift className="w-4 h-4" />
                      ) : isPositive ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC] truncate">
                        {tx.description}
                      </p>
                      <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
                        {formatIsoToVn(tx.server_timestamp)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 tabular-nums">
                    <p
                      className={`text-sm font-bold ${
                        isBonus
                          ? 'text-[#D97706] dark:text-[#FCD34D]'
                          : isPositive
                            ? 'text-[#059669] dark:text-[#34D399]'
                            : 'text-[#DC2626] dark:text-[#F87171]'
                      }`}
                    >
                      {isPositive ? '+' : ''}
                      {tx.amount.toLocaleString('vi-VN')}đ
                    </p>
                    <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8]">
                      Còn {tx.balance_after.toLocaleString('vi-VN')}đ
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
