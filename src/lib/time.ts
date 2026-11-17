import { getSupabaseAdmin } from './supabaseAdmin';

export interface ServerTimeResult {
  vnFormatted: string;
  vnIsoWallClock: string;
  isoUtc: string;
}

export interface VnDateParts {
  yyyy: number;
  mm: number;
  dd: number;
  dayOfWeek: number; // 0=Sun..6=Sat
  hh: number;
  min: number;
  ss: number;
  dateStr: string; // YYYY-MM-DD
}

/**
 * Formats a timestamp string returned by `get_server_time()` (`SELECT NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh'`).
 */
export function parseVnWallClock(raw: string): ServerTimeResult {
  const match = raw.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})/);
  if (!match) {
    const now = new Date();
    return {
      vnFormatted: formatUtcMsToVn(now.getTime()),
      vnIsoWallClock: formatUtcMsToVnIso(now.getTime()),
      isoUtc: now.toISOString(),
    };
  }
  const [, yyyy, mm, dd, hh, min, ss] = match;
  const vnWallMsAsUtc = Date.UTC(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(min),
    Number(ss),
  );
  const utcMs = vnWallMsAsUtc - 7 * 60 * 60 * 1000;
  return {
    vnFormatted: `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`,
    vnIsoWallClock: `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`,
    isoUtc: new Date(utcMs).toISOString(),
  };
}

export async function fetchAuthoritativeServerTime(): Promise<ServerTimeResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('get_server_time');
  if (error || !data) {
    const now = new Date();
    return {
      vnFormatted: formatUtcMsToVn(now.getTime()),
      vnIsoWallClock: formatUtcMsToVnIso(now.getTime()),
      isoUtc: now.toISOString(),
    };
  }
  return parseVnWallClock(String(data));
}

export function getVnDateParts(utcMs: number): VnDateParts {
  const vn = new Date(utcMs + 7 * 60 * 60 * 1000);
  const yyyy = vn.getUTCFullYear();
  const mm = vn.getUTCMonth() + 1;
  const dd = vn.getUTCDate();
  const dayOfWeek = vn.getUTCDay();
  const hh = vn.getUTCHours();
  const min = vn.getUTCMinutes();
  const ss = vn.getUTCSeconds();
  const dateStr = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  return { yyyy, mm, dd, dayOfWeek, hh, min, ss, dateStr };
}

export function vnDateTimeToUtcMs(dateStr: string, hhmm = '23:59'): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (hhmm || '23:59').split(':').map(Number);
  const wallMs = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 59);
  return wallMs - 7 * 60 * 60 * 1000;
}

export function addDaysToVnDateStr(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1) + deltaDays * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function getDayOfWeekFromVnDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}

/**
 * Computes an idempotent weekly cycle key (e.g. `W_2026-11-16`) based on configurable reset_day & reset_hour in UTC+7.
 */
export function getCurrentWeeklyPeriodKey(serverNowMs: number, resetDay = 1, resetHour = 0): string {
  const parts = getVnDateParts(serverNowMs);
  let daysSinceReset = (parts.dayOfWeek - resetDay + 7) % 7;
  if (daysSinceReset === 0 && parts.hh < resetHour) {
    daysSinceReset = 7;
  }
  const resetDateStr = addDaysToVnDateStr(parts.dateStr, -daysSinceReset);
  return `W_${resetDateStr}`;
}

export function formatUtcMsToVn(utcMs: number): string {
  const vn = new Date(utcMs + 7 * 60 * 60 * 1000);
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = vn.getUTCFullYear();
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const min = String(vn.getUTCMinutes()).padStart(2, '0');
  const ss = String(vn.getUTCSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

export function formatUtcMsToVnIso(utcMs: number): string {
  const vn = new Date(utcMs + 7 * 60 * 60 * 1000);
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = vn.getUTCFullYear();
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const min = String(vn.getUTCMinutes()).padStart(2, '0');
  const ss = String(vn.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;
}

export function formatIsoToVn(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return formatUtcMsToVn(ms);
}

export function formatRelativeVi(targetIso: string, serverNowMs: number): string {
  const targetMs = Date.parse(targetIso);
  if (Number.isNaN(targetMs)) return '';
  const diffSec = Math.max(0, Math.floor((serverNowMs - targetMs) / 1000));
  if (diffSec < 60) return 'Vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} ngày trước`;
  return formatUtcMsToVn(targetMs).slice(0, 10);
}

export function getVnPeriodBounds(serverNowMs: number): { startOfDayUtcMs: number; startOfWeekUtcMs: number } {
  const vnMs = serverNowMs + 7 * 60 * 60 * 1000;
  const vnDate = new Date(vnMs);
  const startOfDayVnMs = Date.UTC(vnDate.getUTCFullYear(), vnDate.getUTCMonth(), vnDate.getUTCDate(), 0, 0, 0);
  const dayOfWeek = vnDate.getUTCDay();
  const diffFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const startOfWeekVnMs = startOfDayVnMs - diffFromMonday * 24 * 60 * 60 * 1000;
  return {
    startOfDayUtcMs: startOfDayVnMs - 7 * 60 * 60 * 1000,
    startOfWeekUtcMs: startOfWeekVnMs - 7 * 60 * 60 * 1000,
  };
}
