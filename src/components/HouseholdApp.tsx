'use client';

import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import useSWR from 'swr';
import {
  BarChart3,
  Bell,
  CheckSquare,
  ClipboardList,
  History,
  Lock,
  LogOut,
  Moon,
  RefreshCw,
  Shield,
  Sun,
  Wallet,
  WifiOff,
} from 'lucide-react';
import { getSupabaseBrowser } from '@/lib/supabaseClient';
import { flushOfflineProofQueue, haptic, listOfflineProofs } from '@/lib/offlineQueue';
import type {
  AssignedChoreItem,
  BootstrapPayload,
  ChoreLogItem,
  ProfilePublic,
} from '@/lib/types';
import { getInitials } from './ChoreIcon';
import { LoginScreen } from './LoginScreen';
import { InstallBanner } from './InstallBanner';
import { ChoreBoard } from './ChoreBoard';
import { ActivityHistory } from './ActivityHistory';
import { AuditLogView } from './AuditLogView';
import { AnalyticsView } from './AnalyticsView';
import { AdminPanel } from './AdminPanel';
import { AssignTasksPanel } from './AssignTasksPanel';
import { CameraCaptureSheet, type CaptureTarget } from './CameraCaptureSheet';
import { PhotoViewerModal } from './PhotoViewerModal';
import { WeeklyWalletDrawer } from './WeeklyWalletDrawer';
import { NotificationDrawer } from './NotificationDrawer';
import { ShiftSwapSheet } from './ShiftSwapSheet';

type TabKey = 'chores' | 'history' | 'audit' | 'stats' | 'assign' | 'admin';

async function bootstrapFetcher(url: string): Promise<BootstrapPayload | null> {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 401) {
    const err = new Error('UNAUTHORIZED') as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    throw new Error('Không thể tải dữ liệu');
  }
  return (await res.json()) as BootstrapPayload;
}

export function HouseholdApp({ initialAuthed }: { initialAuthed: boolean }) {
  const [darkMode, setDarkMode] = useState(false);
  const [authed, setAuthed] = useState(initialAuthed);
  const [tab, setTab] = useState<TabKey>('chores');

  const [captureTarget, setCaptureTarget] = useState<CaptureTarget | null>(null);
  const [inspectingLog, setInspectingLog] = useState<ChoreLogItem | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [swapAssignment, setSwapAssignment] = useState<AssignedChoreItem | null>(null);

  const [offlineCount, setOfflineCount] = useState(0);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [pullDist, setPullDist] = useState(0);
  const touchStartY = useRef<number | null>(null);
  const sentLocalPushKeys = useRef<Set<string>>(new Set());

  const { data, isLoading, isValidating, mutate } = useSWR<BootstrapPayload | null>(
    authed ? '/api/bootstrap' : null,
    bootstrapFetcher,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      dedupingInterval: 2000,
      onError: (err) => {
        if ((err as { status?: number })?.status === 401) {
          setAuthed(false);
        }
      },
    },
  );

  useEffect(() => {
    const saved = localStorage.getItem('hct_dark');
    if (saved === '1') setDarkMode(true);

    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    if (typeof Notification !== 'undefined') {
      setNotifPermission(Notification.permission);
    } else {
      setNotifPermission('unsupported');
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('hct_dark', darkMode ? '1' : '0');
  }, [darkMode]);

  const refreshData = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const syncOfflineQueue = useCallback(async () => {
    const queued = await listOfflineProofs();
    setOfflineCount(queued.length);
    if (queued.length > 0 && navigator.onLine) {
      const res = await flushOfflineProofQueue();
      setOfflineCount(res.remaining);
      if (res.synced > 0) {
        setOfflineNotice(`Đã tự động đồng bộ ${res.synced} ảnh từ hàng đợi ngoại tuyến.`);
        setTimeout(() => setOfflineNotice(null), 4000);
        await mutate();
      }
    }
  }, [mutate]);

  useEffect(() => {
    if (authed) {
      void syncOfflineQueue();
    }
  }, [authed, syncOfflineQueue]);

  useEffect(() => {
    if (!authed) return;
    const supabase = getSupabaseBrowser();
    const channel = supabase
      ?.channel('household-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sync_signals' },
        () => {
          void mutate();
        },
      )
      .subscribe();

    function handleVisible() {
      if (document.visibilityState === 'visible') {
        void mutate();
        void syncOfflineQueue();
      }
    }
    function handleOnline() {
      void syncOfflineQueue();
    }

    window.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleVisible);
    window.addEventListener('online', handleOnline);

    return () => {
      if (channel && supabase) {
        void supabase.removeChannel(channel);
      }
      window.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleVisible);
      window.removeEventListener('online', handleOnline);
    };
  }, [authed, mutate, syncOfflineQueue]);

  useEffect(() => {
    if (!authed || !data) return;

    async function checkLocalDeadlineReminders() {
      if (!data || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const nowMs = Date.now();
      const myPending = data.assignedChores.filter(
        (a) =>
          a.is_active &&
          a.effective_assignee_id === data.me.id &&
          a.cycle_status === 'pending' &&
          a.deadline_iso,
      );

      for (const a of myPending) {
        const deadlineMs = Date.parse(a.deadline_iso!);
        const remainMin = Math.ceil((deadlineMs - nowMs) / 60_000);
        if (remainMin > 0 && remainMin <= 30) {
          const bucket = remainMin <= 5 ? '5m' : '30m';
          const key = `${a.id}::${a.current_cycle_key}::${bucket}`;
          if (sentLocalPushKeys.current.has(key)) continue;
          sentLocalPushKeys.current.add(key);

          const title = `Nhắc việc: Còn ${remainMin} phút — ${a.chore_title}`;
          const body =
            a.penalty_amount > 0
              ? `Hoàn thành trước ${a.due_time} để tránh bị trừ ${a.penalty_amount.toLocaleString('vi-VN')}đ.`
              : `Hạn chót ${a.due_time}.`;

          try {
            const reg = await navigator.serviceWorker?.ready;
            if (reg?.showNotification) {
              await reg.showNotification(title, {
                body,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag: key,
              });
            } else {
              new Notification(title, { body, icon: '/icon-192.png' });
            }
          } catch {
            // ignore OS notification error
          }
        }
      }
    }

    void checkLocalDeadlineReminders();
    const timer = setInterval(() => void checkLocalDeadlineReminders(), 60_000);
    return () => clearInterval(timer);
  }, [authed, data]);

  async function handleRequestNotifPermission() {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
    haptic(15);
  }

  async function handleMarkAllRead() {
    if (data) {
      await mutate(
        {
          ...data,
          notifications: data.notifications.map((n) => ({ ...n, is_read: true })),
        },
        false,
      );
    }
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    await mutate();
  }

  async function handleLoginSuccess(_user: ProfilePublic) {
    setAuthed(true);
    setTab('chores');
    await mutate();
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().then(setNotifPermission).catch(() => undefined);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAuthed(false);
    await mutate(null, false);
  }

  async function handleModerateLog(
    log: ChoreLogItem,
    action: 'reject' | 'rework_half_penalty' = 'reject',
  ) {
    const res = await fetch('/api/admin/moderate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logId: log.id, action }),
    });
    if (res.ok) {
      await mutate();
    }
  }

  async function handleReactLog(log: ChoreLogItem, reaction: 'ok' | 'sloppy') {
    if (data) {
      const updatedLogs = data.logs.map((l) => {
        if (l.id !== log.id) return l;
        const prev = l.my_reaction;
        let ok = l.ok_count;
        let sloppy = l.sloppy_count;
        if (prev === 'ok') ok = Math.max(0, ok - 1);
        if (prev === 'sloppy') sloppy = Math.max(0, sloppy - 1);
        if (reaction === 'ok') ok += 1;
        if (reaction === 'sloppy') sloppy += 1;
        return {
          ...l,
          my_reaction: reaction,
          ok_count: ok,
          sloppy_count: sloppy,
          quality_status: sloppy > 0 ? ('flagged' as const) : ok > 0 ? ('ok' as const) : l.quality_status,
        };
      });
      await mutate({ ...data, logs: updatedLogs }, false);
    }
    const res = await fetch('/api/logs/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logId: log.id, reaction }),
    });
    if (res.ok) {
      await mutate();
    }
  }

  function onTouchStart(e: TouchEvent<HTMLDivElement>) {
    if (window.scrollY <= 2 && e.touches.length === 1) {
      touchStartY.current = e.touches[0].clientY;
    } else {
      touchStartY.current = null;
    }
  }

  function onTouchMove(e: TouchEvent<HTMLDivElement>) {
    if (touchStartY.current === null || e.touches.length !== 1) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0 && window.scrollY <= 2) {
      setPullDist(Math.min(84, Math.round(delta * 0.45)));
    }
  }

  function onTouchEnd() {
    if (pullDist >= 56) {
      haptic(15);
      void mutate();
      void syncOfflineQueue();
    }
    setPullDist(0);
    touchStartY.current = null;
  }

  const showStatsTab = Boolean(
    data &&
      (data.featureFlags.gamification ||
        data.featureFlags.analytics ||
        data.featureFlags.penalty_fund),
  );
  const isAdmin = data?.me.role === 'admin';
  const isDelegatedAssigner = Boolean(data && !isAdmin && data.me.can_assign_tasks);
  const unreadNotifs = (data?.notifications || []).filter((n) => !n.is_read).length;

  useEffect(() => {
    if (tab === 'stats' && !showStatsTab) setTab('chores');
    if (tab === 'admin' && !isAdmin) setTab('chores');
    if (tab === 'assign' && !isDelegatedAssigner) setTab('chores');
  }, [tab, showStatsTab, isAdmin, isDelegatedAssigner]);

  const pageTitle =
    tab === 'chores'
      ? 'Bảng việc nhà'
      : tab === 'history'
        ? 'Nhật ký hoạt động'
        : tab === 'audit'
          ? 'Nhật ký Minh bạch'
          : tab === 'stats'
            ? 'Thống kê & Xếp hạng'
            : tab === 'assign'
              ? 'Giao việc thành viên'
              : 'Quản trị hệ thống';

  if (!authed) {
    return (
      <div className="min-h-screen w-full bg-[#F8F9FA] dark:bg-[#0F172A]">
        <InstallBanner />
        <LoginScreen
          onSuccess={handleLoginSuccess}
          darkMode={darkMode}
          onToggleDark={() => setDarkMode((d) => !d)}
        />
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="min-h-screen w-full bg-[#F8F9FA] dark:bg-[#0F172A] flex flex-col items-center justify-center p-8 space-y-3">
        <div className="w-8 h-8 border-2 border-[#059669] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-[#6B7280] dark:text-[#94A3B8]">Đang tải dữ liệu việc nhà...</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="min-h-screen w-full bg-[#F8F9FA] dark:bg-[#0F172A] text-[#111827] dark:text-[#F8FAFC]"
    >
      <div className="max-w-7xl mx-auto md:flex min-h-screen">
        {/* Desktop & iPad Left Sidebar (240px fixed width, visible >= 768px) */}
        <aside className="hidden md:flex md:flex-col md:w-[240px] shrink-0 sticky top-0 h-screen border-r border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] px-3.5 py-5 justify-between">
          <div className="space-y-5">
            {/* Brand Logo */}
            <div className="flex items-center gap-2.5 px-1.5">
              <div className="w-9 h-9 rounded-xl bg-[#059669] text-white flex items-center justify-center shadow-sm shrink-0">
                <CheckSquare className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold tracking-tight truncate">trackingwork</p>
                <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] truncate">
                  Việc nhà minh bạch
                </p>
              </div>
            </div>

            {/* Profile Badge */}
            <div className="rounded-2xl bg-[#F8F9FA] dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#334155] p-3 flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-[#059669]/15 text-[#059669] text-xs font-bold flex items-center justify-center shrink-0">
                {getInitials(data.me.display_name)}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold truncate">{data.me.display_name}</p>
                <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] truncate">
                  {isAdmin
                    ? 'Quản trị viên'
                    : isDelegatedAssigner
                      ? 'Người giao việc'
                      : 'Thành viên'}
                </p>
              </div>
            </div>

            {/* Live Weekly Fund Card in Sidebar */}
            {data.weeklyFundConfig.enabled && (
              <button
                type="button"
                onClick={() => setWalletOpen(true)}
                className="w-full text-left rounded-2xl bg-[#ECFDF5]/60 dark:bg-[#064E3B]/30 border border-[#A7F3D0] dark:border-[#047857] p-3 space-y-0.5 hover:border-[#059669] transition"
              >
                <div className="flex items-center justify-between text-[11px] font-semibold text-[#047857] dark:text-[#6EE7B7]">
                  <span className="flex items-center gap-1">
                    <Wallet className="w-3.5 h-3.5" />
                    Ví quỹ tuần
                  </span>
                </div>
                <p className="text-sm font-bold text-[#065F46] dark:text-[#A7F3D0] tabular-nums">
                  {data.me.current_balance.toLocaleString('vi-VN')}đ
                </p>
              </button>
            )}

            {/* Navigation Links */}
            <nav aria-label="Điều hướng chính" className="space-y-1">
              {(
                [
                  { key: 'chores', label: 'Việc nhà', icon: CheckSquare, show: true },
                  { key: 'history', label: 'Lịch sử', icon: History, show: true },
                  { key: 'audit', label: 'Minh bạch', icon: Lock, show: true },
                  { key: 'stats', label: 'Thống kê', icon: BarChart3, show: showStatsTab },
                  {
                    key: 'assign',
                    label: 'Giao việc',
                    icon: ClipboardList,
                    show: isDelegatedAssigner,
                  },
                  { key: 'admin', label: 'Quản trị (Admin)', icon: Shield, show: isAdmin },
                ] as const
              )
                .filter((item) => item.show)
                .map((item) => {
                  const Icon = item.icon;
                  const active = tab === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setTab(item.key)}
                      className={`w-full h-11 px-3 rounded-xl text-sm font-semibold flex items-center gap-2.5 transition ${
                        active
                          ? 'bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669] dark:text-[#34D399]'
                          : 'text-[#6B7280] dark:text-[#94A3B8] hover:bg-[#F3F4F6] dark:hover:bg-[#0F172A]'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
            </nav>
          </div>

          {/* Sidebar Bottom Actions */}
          <div className="space-y-2 pt-3 border-t border-[#E5E7EB] dark:border-[#334155]">
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => setNotifOpen(true)}
                title="Thông báo"
                className="relative h-10 rounded-xl border border-[#E5E7EB] dark:border-[#334155] flex items-center justify-center text-[#6B7280] dark:text-[#CBD5E1] hover:bg-[#F3F4F6] dark:hover:bg-[#0F172A]"
              >
                <Bell className="w-4 h-4" />
                {unreadNotifs > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-[#DC2626] text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadNotifs > 9 ? '9+' : unreadNotifs}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  void mutate();
                  void syncOfflineQueue();
                }}
                title="Làm mới"
                className="h-10 rounded-xl border border-[#E5E7EB] dark:border-[#334155] flex items-center justify-center text-[#6B7280] dark:text-[#CBD5E1] hover:bg-[#F3F4F6] dark:hover:bg-[#0F172A]"
              >
                <RefreshCw className={`w-4 h-4 ${isValidating ? 'animate-spin text-[#059669]' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => setDarkMode((d) => !d)}
                title="Đổi giao diện Sáng/Tối"
                className="h-10 rounded-xl border border-[#E5E7EB] dark:border-[#334155] flex items-center justify-center text-[#6B7280] dark:text-[#CBD5E1] hover:bg-[#F3F4F6] dark:hover:bg-[#0F172A]"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="w-full h-10 rounded-xl border border-[#E5E7EB] dark:border-[#334155] text-xs font-semibold text-[#6B7280] dark:text-[#CBD5E1] hover:text-[#DC2626] flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              Đăng xuất
            </button>
          </div>
        </aside>

        {/* Main Content Area (Mobile Full-Width / Tablet & Desktop Remaining Space) */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Mobile Compact Sticky Header (< 768px) */}
          <header className="md:hidden sticky top-0 z-30 bg-[#F8F9FA]/95 dark:bg-[#0F172A]/95 backdrop-blur-sm border-b border-[#E5E7EB] dark:border-[#334155] px-4 py-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-base font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                {pageTitle}
              </h1>
              <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] truncate">
                Xin chào,{' '}
                <span className="font-semibold text-[#059669]">{data.me.display_name}</span>
                {isDelegatedAssigner && (
                  <span className="ml-1.5 text-[10px] font-semibold text-[#D97706]">
                    • Người giao việc
                  </span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  haptic(10);
                  setTab('audit');
                }}
                aria-label="Mở nhật ký Minh bạch"
                className={`w-10 h-10 rounded-xl border flex items-center justify-center ${
                  tab === 'audit'
                    ? 'border-[#059669] bg-[#ECFDF5] dark:bg-[#064E3B] text-[#059669]'
                    : 'border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] text-[#6B7280] dark:text-[#CBD5E1]'
                }`}
              >
                <Lock className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  haptic(10);
                  setNotifOpen(true);
                }}
                aria-label="Thông báo"
                className="relative w-10 h-10 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] flex items-center justify-center text-[#6B7280] dark:text-[#CBD5E1]"
              >
                <Bell className="w-4 h-4" />
                {unreadNotifs > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#DC2626] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                    {unreadNotifs > 9 ? '9+' : unreadNotifs}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  haptic(10);
                  void mutate();
                  void syncOfflineQueue();
                }}
                aria-label="Làm mới"
                className="w-10 h-10 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] flex items-center justify-center text-[#6B7280] dark:text-[#CBD5E1]"
              >
                <RefreshCw className={`w-4 h-4 ${isValidating ? 'animate-spin text-[#059669]' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => setDarkMode((d) => !d)}
                aria-label="Đổi giao diện sáng tối"
                className="w-10 h-10 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] flex items-center justify-center text-[#6B7280] dark:text-[#CBD5E1]"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                aria-label="Đăng xuất"
                className="w-10 h-10 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] flex items-center justify-center text-[#6B7280] dark:text-[#CBD5E1]"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Desktop & iPad Top Title Strip (>= 768px) */}
          <header className="hidden md:flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB] dark:border-[#334155] bg-white/60 dark:bg-[#0F172A]/80 backdrop-blur-sm sticky top-0 z-20">
            <div>
              <h1 className="text-xl font-bold tracking-tight">{pageTitle}</h1>
              <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
                Giờ máy chủ Việt Nam: {data.serverVnFormatted}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isValidating && (
                <span className="text-xs font-medium text-[#059669] flex items-center gap-1">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Đang đồng bộ...
                </span>
              )}
            </div>
          </header>

          {pullDist > 12 && (
            <div
              style={{ height: `${pullDist}px` }}
              className="md:hidden flex items-center justify-center text-xs font-medium text-[#059669] overflow-hidden"
            >
              {pullDist >= 56 ? 'Thả tay để làm mới...' : 'Kéo xuống để làm mới'}
            </div>
          )}

          <InstallBanner />

          {(offlineCount > 0 || offlineNotice) && (
            <div className="mx-4 md:mx-6 mt-3 rounded-2xl bg-[#FFFBEB] dark:bg-[#451A03] border border-[#FDE68A] dark:border-[#92400E] px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-[#B45309] dark:text-[#FCD34D] font-medium">
                <WifiOff className="w-4 h-4 shrink-0" />
                <span>
                  {offlineNotice || `Đang chờ mạng để đồng bộ ${offlineCount} ảnh xác thực`}
                </span>
              </div>
              {offlineCount > 0 && (
                <button
                  type="button"
                  onClick={() => void syncOfflineQueue()}
                  className="h-8 px-2.5 rounded-lg bg-[#D97706] text-white font-semibold shrink-0"
                >
                  Đồng bộ
                </button>
              )}
            </div>
          )}

          <main className="flex-1 px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
            {tab === 'chores' && (
              <ChoreBoard
                me={data.me}
                chores={data.chores}
                activeSessions={data.activeSessions}
                logs={data.logs}
                assignedChores={data.assignedChores}
                shiftSwaps={data.shiftSwaps}
                fundTransactions={data.fundTransactions}
                sharedPartyFund={data.sharedPartyFund}
                featureFlags={data.featureFlags}
                weeklyFundConfig={data.weeklyFundConfig}
                serverNowIso={data.serverNowIso}
                onStartCapture={(target) => setCaptureTarget(target)}
                onInspectPhoto={(log) => setInspectingLog(log)}
                onOpenWallet={() => setWalletOpen(true)}
                onOpenSwapSheet={(a) => setSwapAssignment(a)}
                onRefresh={refreshData}
              />
            )}

            {tab === 'history' && (
              <ActivityHistory
                logs={data.logs}
                logsNextCursor={data.logsNextCursor}
                auditLogs={data.auditLogs}
                auditNextCursor={data.auditNextCursor}
                chores={data.chores}
                members={data.members}
                subView="feed"
                onChangeSubView={(v) => setTab(v === 'audit' ? 'audit' : 'history')}
                featureFlags={data.featureFlags}
                isAdmin={isAdmin}
                onInspectPhoto={(log) => setInspectingLog(log)}
                onModerate={handleModerateLog}
                onReact={handleReactLog}
              />
            )}

            {tab === 'audit' && (
              <div className="space-y-3.5">
                <div className="md:hidden">
                  <ActivityHistory
                    logs={data.logs}
                    logsNextCursor={data.logsNextCursor}
                    auditLogs={data.auditLogs}
                    auditNextCursor={data.auditNextCursor}
                    chores={data.chores}
                    members={data.members}
                    subView="audit"
                    onChangeSubView={(v) => setTab(v === 'audit' ? 'audit' : 'history')}
                    featureFlags={data.featureFlags}
                    isAdmin={isAdmin}
                    onInspectPhoto={(log) => setInspectingLog(log)}
                    onModerate={handleModerateLog}
                    onReact={handleReactLog}
                  />
                </div>
                <div className="hidden md:block">
                  <AuditLogView
                    initialItems={data.auditLogs}
                    initialNextCursor={data.auditNextCursor}
                  />
                </div>
              </div>
            )}

            {tab === 'stats' && showStatsTab && (
              <AnalyticsView
                chores={data.chores}
                logs={data.logs}
                members={data.members}
                penalties={data.penalties}
                weeklySettlement={data.weeklySettlement}
                sharedPartyFund={data.sharedPartyFund}
                weeklyFundConfig={data.weeklyFundConfig}
                featureFlags={data.featureFlags}
                serverNowIso={data.serverNowIso}
                isAdmin={isAdmin}
                meId={data.me.id}
                onRefresh={refreshData}
              />
            )}

            {tab === 'assign' && isDelegatedAssigner && (
              <div className="max-w-3xl">
                <AssignTasksPanel
                  chores={data.chores}
                  members={data.members}
                  assignedChores={data.assignedChores}
                  currentVnDate={data.currentVnDate}
                  onRefresh={refreshData}
                />
              </div>
            )}

            {tab === 'admin' && isAdmin && (
              <AdminPanel
                chores={data.chores}
                logs={data.logs}
                members={data.members}
                assignedChores={data.assignedChores}
                fundTransactions={data.fundTransactions}
                weeklySettlement={data.weeklySettlement}
                sharedPartyFund={data.sharedPartyFund}
                featureFlags={data.featureFlags}
                weeklyFundConfig={data.weeklyFundConfig}
                retentionDays={data.retentionDays}
                lastCleanupAt={data.lastCleanupAt}
                currentVnDate={data.currentVnDate}
                onRefresh={refreshData}
                onModerate={handleModerateLog}
                onInspectPhoto={(log) => setInspectingLog(log)}
              />
            )}
          </main>
        </div>
      </div>

      {/* Mobile Fixed Bottom Tab Navigation (< 768px) */}
      <nav
        aria-label="Điều hướng di động"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-[#1E293B]/95 backdrop-blur-sm border-t border-[#E5E7EB] dark:border-[#334155] px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-around gap-1">
          <button
            type="button"
            onClick={() => setTab('chores')}
            className={`flex-1 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
              tab === 'chores' ? 'text-[#059669]' : 'text-[#6B7280] dark:text-[#94A3B8]'
            }`}
          >
            <CheckSquare className="w-5 h-5" strokeWidth={tab === 'chores' ? 2.25 : 1.75} />
            Việc nhà
          </button>

          <button
            type="button"
            onClick={() => setTab('history')}
            className={`flex-1 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
              tab === 'history' || tab === 'audit'
                ? 'text-[#059669]'
                : 'text-[#6B7280] dark:text-[#94A3B8]'
            }`}
          >
            <History
              className="w-5 h-5"
              strokeWidth={tab === 'history' || tab === 'audit' ? 2.25 : 1.75}
            />
            Lịch sử
          </button>

          {showStatsTab && (
            <button
              type="button"
              onClick={() => setTab('stats')}
              className={`flex-1 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
                tab === 'stats' ? 'text-[#059669]' : 'text-[#6B7280] dark:text-[#94A3B8]'
              }`}
            >
              <BarChart3 className="w-5 h-5" strokeWidth={tab === 'stats' ? 2.25 : 1.75} />
              Thống kê
            </button>
          )}

          {isDelegatedAssigner && (
            <button
              type="button"
              onClick={() => setTab('assign')}
              className={`flex-1 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
                tab === 'assign' ? 'text-[#059669]' : 'text-[#6B7280] dark:text-[#94A3B8]'
              }`}
            >
              <ClipboardList className="w-5 h-5" strokeWidth={tab === 'assign' ? 2.25 : 1.75} />
              Giao việc
            </button>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => setTab('admin')}
              className={`flex-1 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
                tab === 'admin' ? 'text-[#059669]' : 'text-[#6B7280] dark:text-[#94A3B8]'
              }`}
            >
              <Shield className="w-5 h-5" strokeWidth={tab === 'admin' ? 2.25 : 1.75} />
              Admin
            </button>
          )}
        </div>
      </nav>

      {/* Modals & Drawers */}
      <CameraCaptureSheet
        target={captureTarget}
        memberName={data.me.display_name}
        onClose={() => setCaptureTarget(null)}
        onCompleted={async (offlineSaved) => {
          if (offlineSaved) {
            const q = await listOfflineProofs();
            setOfflineCount(q.length);
            setOfflineNotice('Mất mạng — Ảnh đã lưu tạm và sẽ tự động tải lên khi có kết nối!');
            setTimeout(() => setOfflineNotice(null), 5000);
          } else {
            await mutate();
          }
        }}
      />

      <WeeklyWalletDrawer
        open={walletOpen}
        me={data.me}
        transactions={data.fundTransactions}
        onClose={() => setWalletOpen(false)}
      />

      <NotificationDrawer
        open={notifOpen}
        notifications={data.notifications}
        notifPermission={notifPermission}
        onRequestPermission={handleRequestNotifPermission}
        onMarkAllRead={handleMarkAllRead}
        onClose={() => setNotifOpen(false)}
      />

      <ShiftSwapSheet
        assignment={swapAssignment}
        members={data.members}
        me={data.me}
        onClose={() => setSwapAssignment(null)}
        onCreated={refreshData}
      />

      <PhotoViewerModal
        log={inspectingLog}
        allLogs={data.logs}
        onSelectLog={(nextLog) => setInspectingLog(nextLog)}
        isAdmin={isAdmin}
        onClose={() => setInspectingLog(null)}
        onModerate={handleModerateLog}
        onReact={handleReactLog}
      />
    </div>
  );
}
