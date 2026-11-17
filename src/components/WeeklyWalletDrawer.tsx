'use client';

import { ArrowDownLeft, ArrowUpRight, Wallet, X } from 'lucide-react';
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px]">
      <div className="w-full max-w-[430px] bg-white dark:bg-[#1E293B] border-t border-[#E5E7EB] dark:border-[#334155] rounded-t-3xl p-5 pb-7 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
        <div className="w-10 h-1 rounded-full bg-[#D1D5DB] dark:bg-[#475569] mx-auto -mt-1 shrink-0" />

        <div className="flex items-start justify-between gap-3 shrink-0">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#059669]">
              <Wallet className="w-3.5 h-3.5" />
              Sổ cái quỹ tuần
            </div>
            <h2 className="text-lg font-bold text-[#111827] dark:text-[#F8FAFC] mt-0.5 tabular-nums">
              Số dư: {me.current_balance.toLocaleString('vi-VN')}đ
            </h2>
            <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
              Định mức tuần được cấp: {me.weekly_allowance.toLocaleString('vi-VN')}đ
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
              return (
                <div key={tx.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isPositive
                          ? 'bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399]'
                          : 'bg-[#FEF2F2] dark:bg-[#450A0A] text-[#DC2626] dark:text-[#F87171]'
                      }`}
                    >
                      {isPositive ? (
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
                        isPositive
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
