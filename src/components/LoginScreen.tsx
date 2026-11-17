'use client';

import { useState, type FormEvent } from 'react';
import { CheckSquare, Eye, EyeOff, Lock, Moon, Sun, User } from 'lucide-react';
import { setInMemorySigningKey } from '@/lib/requestSigner';
import type { ProfilePublic } from '@/lib/types';

interface LoginScreenProps {
  onSuccess: (user: ProfilePublic) => void;
  darkMode: boolean;
  onToggleDark: () => void;
}

export function LoginScreen({ onSuccess, darkMode, onToggleDark }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !secret) {
      setError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu / mã PIN.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), secret, rememberMe }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Đăng nhập thất bại.');
        return;
      }
      if (data?.signingKey) {
        setInMemorySigningKey(data.signingKey, data.serverNowMs);
      }
      onSuccess(data.user);
    } catch {
      setError('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col justify-between px-5 py-6 md:px-10 md:py-8 bg-[#F8F9FA] dark:bg-[#0F172A]">
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#059669] text-white flex items-center justify-center shadow-sm">
            <CheckSquare className="w-5 h-5" strokeWidth={2} />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC] leading-tight">
              trackingwork
            </p>
            <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8]">
              Quản lý việc nhà & xác thực minh bạch
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleDark}
          aria-label="Đổi giao diện sáng tối"
          className="w-11 h-11 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] flex items-center justify-center text-[#6B7280] dark:text-[#CBD5E1] active:scale-95 transition"
        >
          {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </div>

      <div className="my-auto py-8 w-full max-w-md mx-auto">
        <div className="mb-6 md:text-center">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#111827] dark:text-[#F8FAFC]">
            Đăng nhập
          </h1>
          <p className="mt-1.5 text-sm text-[#6B7280] dark:text-[#94A3B8]">
            Nhập tên tài khoản và mã PIN 6 số (hoặc mật khẩu quản trị).
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] rounded-2xl p-5 md:p-6 space-y-4 shadow-sm"
        >
          <div>
            <label
              htmlFor="login-username"
              className="block text-xs font-semibold uppercase tracking-wide text-[#6B7280] dark:text-[#94A3B8] mb-1.5"
            >
              Tên đăng nhập
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-[#6B7280] dark:text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="VD: MinhAnh hoặc Admin"
                className="w-full h-12 pl-10 pr-4 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-[#111827] dark:text-[#F8FAFC] text-base placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#059669] focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="login-secret"
              className="block text-xs font-semibold uppercase tracking-wide text-[#6B7280] dark:text-[#94A3B8] mb-1.5"
            >
              Mật khẩu / Mã PIN
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#6B7280] dark:text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="login-secret"
                type={showSecret ? 'text' : 'password'}
                autoComplete="current-password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="••••••"
                className="w-full h-12 pl-10 pr-12 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-[#111827] dark:text-[#F8FAFC] text-base tabular-nums placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#059669] focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowSecret((prev) => !prev)}
                aria-label={showSecret ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-[#6B7280] dark:text-[#94A3B8] rounded-lg"
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <label className="flex items-start gap-2.5 rounded-xl bg-[#F8F9FA] dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#334155] px-3.5 py-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-[#059669] rounded shrink-0"
            />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-[#111827] dark:text-[#F8FAFC]">
                Duy trì đăng nhập trên thiết bị này (90 ngày)
              </span>
              <span className="block text-[11px] text-[#6B7280] dark:text-[#94A3B8] mt-0.5">
                Tự động giữ &amp; gia hạn phiên đăng nhập cho đến khi bạn bấm Đăng xuất.
              </span>
            </span>
          </label>

          {error && (
            <div className="rounded-xl bg-[#FEF2F2] dark:bg-[#450A0A] border border-[#FECACA] dark:border-[#7F1D1D] px-3.5 py-2.5 text-sm text-[#B91C1C] dark:text-[#FCA5A5]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-[#059669] hover:bg-[#047857] disabled:opacity-60 text-white font-semibold text-base transition active:scale-[0.99]"
          >
            {loading ? 'Đang xác thực...' : 'Vào bảng việc nhà'}
          </button>
        </form>
      </div>

      <p className="text-center text-xs text-[#6B7280] dark:text-[#94A3B8]">
        Tối ưu cho Điện thoại, iPad & Laptop • Chụp ảnh trực tiếp chống gian lận
      </p>
    </div>
  );
}
