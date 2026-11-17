'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  CheckSquare,
  History,
  LogOut,
  Moon,
  RefreshCw,
  Shield,
  Sun,
} from 'lucide-react';
import { getSupabaseBrowser } from '@/lib/supabaseClient';
import type { BootstrapPayload, Chore, ChoreLogItem, ProfilePublic } from '@/lib/types';
import { LoginScreen } from './LoginScreen';
import { ChoreBoard } from './ChoreBoard';
import { ActivityHistory } from './ActivityHistory';
import { AnalyticsView } from './AnalyticsView';
import { AdminPanel } from './AdminPanel';
import { CameraCaptureSheet } from './CameraCaptureSheet';
import { PhotoViewerModal } from './PhotoViewerModal';

type TabKey = 'chores' | 'history' | 'stats' | 'admin';

export function HouseholdApp({ initialAuthed }: { initialAuthed: boolean }) {
  const [darkMode, setDarkMode] = useState(false);
  const [authed, setAuthed] = useState(initialAuthed);
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(initialAuthed);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>('chores');

  const [capturingChore, setCapturingChore] = useState<Chore | null>(null);
  const [inspectingLog, setInspectingLog] = useState<ChoreLogItem | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('hct_dark');
    if (saved === '1') setDarkMode(true);
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

  useEffect(() => {
    if (authed) {
      void loadBootstrap(false);
    }
  }, [authed, loadBootstrap]);

  // Real-time sync across all 10 phones via Supabase sync_signals + focus refresh
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
      }
    }
    window.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleVisible);

    return () => {
      if (channel && supabase) {
        void supabase.removeChannel(channel);
      }
      window.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleVisible);
    };
  }, [authed, loadBootstrap]);

  async function handleLoginSuccess(_user: ProfilePublic) {
    setAuthed(true);
    setTab('chores');
    await loadBootstrap(false);
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAuthed(false);
    setData(null);
  }

  async function handleModerateLog(log: ChoreLogItem) {
    const res = await fetch('/api/admin/moderate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logId: log.id }),
    });
    if (res.ok) {
      await loadBootstrap(true);
    }
  }

  // Determine visible tabs dynamically based on Admin Feature Flags + Role
  const showStatsTab = Boolean(
    data &&
      (data.featureFlags.gamification ||
        data.featureFlags.analytics ||
        data.featureFlags.penalty_fund),
  );
  const isAdmin = data?.me.role === 'admin';

  useEffect(() => {
    if (tab === 'stats' && !showStatsTab) setTab('chores');
    if (tab === 'admin' && !isAdmin) setTab('chores');
  }, [tab, showStatsTab, isAdmin]);

  return (
    <div className="min-h-screen w-full flex justify-center bg-[#E5E7EB] dark:bg-[#090D16]">
      {/* Strictly 430px centered mobile app frame */}
      <div className="w-full max-w-[430px] min-h-screen bg-[#F8F9FA] dark:bg-[#0F172A] sm:border-x sm:border-[#D1D5DB] dark:sm:border-[#1E293B] sm:shadow-xl flex flex-col relative">
        {!authed ? (
          <LoginScreen
            onSuccess={handleLoginSuccess}
            darkMode={darkMode}
            onToggleDark={() => setDarkMode((d) => !d)}
          />
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
                        : 'Quản trị hệ thống'}
                </h1>
                <p className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] truncate">
                  Xin chào, <span className="font-semibold text-[#059669]">{data.me.display_name}</span>
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void loadBootstrap(true)}
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

            {/* Main Scroll Content */}
            <main className="flex-1 px-4 py-4 pb-24">
              {tab === 'chores' && (
                <ChoreBoard
                  chores={data.chores}
                  logs={data.logs}
                  featureFlags={data.featureFlags}
                  serverNowIso={data.serverNowIso}
                  onStartComplete={(chore) => setCapturingChore(chore)}
                  onInspectPhoto={(log) => setInspectingLog(log)}
                />
              )}

              {tab === 'history' && (
                <ActivityHistory
                  logs={data.logs}
                  featureFlags={data.featureFlags}
                  isAdmin={isAdmin}
                  onInspectPhoto={(log) => setInspectingLog(log)}
                  onModerate={handleModerateLog}
                />
              )}

              {tab === 'stats' && showStatsTab && (
                <AnalyticsView
                  chores={data.chores}
                  logs={data.logs}
                  members={data.members}
                  penalties={data.penalties}
                  featureFlags={data.featureFlags}
                  serverNowIso={data.serverNowIso}
                  isAdmin={isAdmin}
                  meId={data.me.id}
                  onRefresh={() => loadBootstrap(true)}
                />
              )}

              {tab === 'admin' && isAdmin && (
                <AdminPanel
                  chores={data.chores}
                  logs={data.logs}
                  members={data.members}
                  featureFlags={data.featureFlags}
                  retentionDays={data.retentionDays}
                  lastCleanupAt={data.lastCleanupAt}
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
              chore={capturingChore}
              memberName={data.me.display_name}
              onClose={() => setCapturingChore(null)}
              onCompleted={() => loadBootstrap(true)}
            />

            {/* Full-screen Pinch-to-Zoom Proof Viewer */}
            <PhotoViewerModal
              log={inspectingLog}
              isAdmin={isAdmin}
              onClose={() => setInspectingLog(null)}
              onModerate={handleModerateLog}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
