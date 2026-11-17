'use client';

import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import {
  BarChart3,
  Bell,
  CheckSquare,
  ClipboardList,
  History,
  LogOut,
  Moon,
  RefreshCw,
  Shield,
  Sun,
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
import { LoginScreen } from './LoginScreen';
import { InstallBanner } from './InstallBanner';
import { ChoreBoard } from './ChoreBoard';
import { ActivityHistory } from './ActivityHistory';
import { AnalyticsView } from './AnalyticsView';
import { AdminPanel } from './AdminPanel';
import { AssignTasksPanel } from './AssignTasksPanel';
import { CameraCaptureSheet, type CaptureTarget } from './CameraCaptureSheet';
import { PhotoViewerModal } from './PhotoViewerModal';
import { WeeklyWalletDrawer } from './WeeklyWalletDrawer';
import { NotificationDrawer } from './NotificationDrawer';
import { ShiftSwapSheet } from './ShiftSwapSheet';

type TabKey = 'chores' | 'history' | 'stats' | 'assign' | 'admin';

export function HouseholdApp({ initialAuthed }: { initialAuthed: boolean }) {
  const [darkMode, setDarkMode] = useState(false);
  const [authed, setAuthed] = useState(initialAuthed);
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(initialAuthed);
  const [refreshing, setRefreshing] = useState(false);
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

  const loadBootstrap = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    try {
      const res = await fetch('/api/bootstrap', { cache: 'no-store' });
      if (res.status === 401) {
        setAuthed(false);
        setData(null);
        return;
      }
      if (res.ok) {
        const json = (await res.json()) as BootstrapPayload;
        setData(json);
        setAuthed(true);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const syncOfflineQueue = useCallback(async () => {
    const queued = await listOfflineProofs();
    setOfflineCount(queued.length);
    if (queued.length > 0 && navigator.onLine) {
      const res = await flushOfflineProofQueue();
      setOfflineCount(res.remaining);
      if (res.synced > 0) {
        setOfflineNotice(`Đã tự động đồng bộ ${res.synced} ảnh từ hàng đợi ngoại tuyến.`);
        setTimeout(() => setOfflineNotice(null), 4000);
        await loadBootstrap(true);
      }
    }
  }, [loadBootstrap]);

  useEffect(() => {
    if (authed) {
      void loadBootstrap(false);
      void syncOfflineQueue();
    }
  }, [authed, loadBootstrap, syncOfflineQueue]);

  useEffect(() => {
    if (!authed) return;
    const supabase = getSupabaseBrowser();
    const channel = supabase
      ?.channel('household-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sync_signals' },
        () => {
          void loadBootstrap(true);
        },
      )
      .subscribe();

    function handleVisible() {
      if (document.visibilityState === 'visible') {
        void loadBootstrap(true);
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
  }, [authed, loadBootstrap, syncOfflineQueue]);

  // Smart 30-min & 5-min deadline push reminders via Service Worker Notification API
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
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    await loadBootstrap(true);
  }

  async function handleLoginSuccess(_user: ProfilePublic) {
    setAuthed(true);
    setTab('chores');
    await loadBootstrap(false);
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().then(setNotifPermission).catch(() => undefined);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAuthed(false);
    setData(null);
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
      await loadBootstrap(true);
    }
  }

  async function handleReactLog(log: ChoreLogItem, reaction: 'ok' | 'sloppy') {
    const res = await fetch('/api/logs/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logId: log.id, reaction }),
    });
    if (res.ok) {
      await loadBootstrap(true);
    }
  }

  // Pull-to-refresh handlers
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
      void loadBootstrap(true);
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

  return (
    <div className="min-h-screen w-full flex justify-center bg-[#E5E7EB] dark:bg-[#090D16]">
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="w-full max-w-[430px] min-h-screen bg-[#F8F9FA] dark:bg-[#0F172A] sm:border-x sm:border-[#D1D5DB] dark:sm:border-[#1E293B] sm:shadow-xl flex flex-col relative"
      >
        {!authed ? (
          <>
            <InstallBanner />
            <LoginScreen
              onSuccess={handleLoginSuccess}
              darkMode={darkMode}
              onToggleDark={() => setDarkMode((d) => !d)}
            />
          </>
        ) : loading && !data ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-3">
            <div className="w-8 h-8 border-2 border-[#059669] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-[#6B7280] dark:text-[#94A3B8]">Đang tải dữ liệu việc nhà...</p>
          </div>
        ) : data ? (
          <>
            {/* Top Sticky App Bar */}
            <header className="sticky top-0 z-30 bg-[#F8F9FA]/95 dark:bg-[#0F172A]/95 backdrop-blur-sm border-b border-[#E5E7EB] dark:border-[#334155] px-4 py-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-base font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                  {tab === 'chores'
                    ? 'Bảng việc nhà'
                    : tab === 'history'
                      ? 'Nhật ký hoạt động'
                      : tab === 'stats'
                        ? 'Thống kê & Xếp hạng'
                        : tab === 'assign'
                          ? 'Giao việc thành viên'
                          : 'Quản trị hệ thống'}
                </h1>
                <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] truncate">
                  Xin chào, <span className="font-semibold text-[#059669]">{data.me.display_name}</span>
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
                    void loadBootstrap(true);
                    void syncOfflineQueue();
                  }}
                  aria-label="Làm mới"
                  className="w-10 h-10 rounded-xl border border-[#E5E7EB] dark:border-[#334155] bg-white dark:bg-[#1E293B] flex items-center justify-center text-[#6B7280] dark:text-[#CBD5E1]"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-[#059669]' : ''}`} />
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

            {/* Pull-to-refresh indicator */}
            {pullDist > 12 && (
              <div
                style={{ height: `${pullDist}px` }}
                className="flex items-center justify-center text-xs font-medium text-[#059669] overflow-hidden"
              >
                {pullDist >= 56 ? 'Thả tay để làm mới...' : 'Kéo xuống để làm mới'}
              </div>
            )}

            {/* PWA Install Prompt Banner */}
            <InstallBanner />

            {/* Offline Sync Queue Banner */}
            {(offlineCount > 0 || offlineNotice) && (
              <div className="mx-4 mt-3 rounded-2xl bg-[#FFFBEB] dark:bg-[#451A03] border border-[#FDE68A] dark:border-[#92400E] px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
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

            {/* Main Scroll Content */}
            <main className="flex-1 px-4 py-4 pb-24">
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
                  onRefresh={() => loadBootstrap(true)}
                />
              )}

              {tab === 'history' && (
                <ActivityHistory
                  logs={data.logs}
                  featureFlags={data.featureFlags}
                  isAdmin={isAdmin}
                  onInspectPhoto={(log) => setInspectingLog(log)}
                  onModerate={handleModerateLog}
                  onReact={handleReactLog}
                />
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
                  onRefresh={() => loadBootstrap(true)}
                />
              )}

              {tab === 'assign' && isDelegatedAssigner && (
                <AssignTasksPanel
                  chores={data.chores}
                  members={data.members}
                  assignedChores={data.assignedChores}
                  currentVnDate={data.currentVnDate}
                  onRefresh={() => loadBootstrap(true)}
                />
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
                  onRefresh={() => loadBootstrap(true)}
                  onModerate={handleModerateLog}
                  onInspectPhoto={(log) => setInspectingLog(log)}
                />
              )}
            </main>

            {/* Fixed Bottom Tab Navigation (max 4 icons) */}
            <nav
              aria-label="Điều hướng chính"
              className="fixed bottom-0 w-full max-w-[430px] z-30 bg-white/95 dark:bg-[#1E293B]/95 backdrop-blur-sm border-t border-[#E5E7EB] dark:border-[#334155] px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
            >
              <div className="flex items-center justify-around gap-1">
                <button
                  type="button"
                  onClick={() => setTab('chores')}
                  className={`flex-1 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
                    tab === 'chores'
                      ? 'text-[#059669]'
                      : 'text-[#6B7280] dark:text-[#94A3B8]'
                  }`}
                >
                  <CheckSquare className="w-5 h-5" strokeWidth={tab === 'chores' ? 2.25 : 1.75} />
                  Việc nhà
                </button>

                <button
                  type="button"
                  onClick={() => setTab('history')}
                  className={`flex-1 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
                    tab === 'history'
                      ? 'text-[#059669]'
                      : 'text-[#6B7280] dark:text-[#94A3B8]'
                  }`}
                >
                  <History className="w-5 h-5" strokeWidth={tab === 'history' ? 2.25 : 1.75} />
                  Lịch sử
                </button>

                {showStatsTab && (
                  <button
                    type="button"
                    onClick={() => setTab('stats')}
                    className={`flex-1 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
                      tab === 'stats'
                        ? 'text-[#059669]'
                        : 'text-[#6B7280] dark:text-[#94A3B8]'
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
                      tab === 'assign'
                        ? 'text-[#059669]'
                        : 'text-[#6B7280] dark:text-[#94A3B8]'
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
                      tab === 'admin'
                        ? 'text-[#059669]'
                        : 'text-[#6B7280] dark:text-[#94A3B8]'
                    }`}
                  >
                    <Shield className="w-5 h-5" strokeWidth={tab === 'admin' ? 2.25 : 1.75} />
                    Admin
                  </button>
                )}
              </div>
            </nav>

            {/* Camera Verification Bottom Sheet */}
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
                  await loadBootstrap(true);
                }
              }}
            />

            {/* Weekly Wallet Transaction History Drawer */}
            <WeeklyWalletDrawer
              open={walletOpen}
              me={data.me}
              transactions={data.fundTransactions}
              onClose={() => setWalletOpen(false)}
            />

            {/* Notification Center Drawer */}
            <NotificationDrawer
              open={notifOpen}
              notifications={data.notifications}
              notifPermission={notifPermission}
              onRequestPermission={handleRequestNotifPermission}
              onMarkAllRead={handleMarkAllRead}
              onClose={() => setNotifOpen(false)}
            />

            {/* Shift Swap & Bounty Sheet */}
            <ShiftSwapSheet
              assignment={swapAssignment}
              members={data.members}
              me={data.me}
              onClose={() => setSwapAssignment(null)}
              onCreated={() => loadBootstrap(true)}
            />

            {/* Full-screen Pinch-to-Zoom Proof Viewer */}
            <PhotoViewerModal
              log={inspectingLog}
              isAdmin={isAdmin}
              onClose={() => setInspectingLog(null)}
              onModerate={handleModerateLog}
              onReact={handleReactLog}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
