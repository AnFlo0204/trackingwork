import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { runRetentionCleanup } from '@/lib/cleanup';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchAuthoritativeServerTime } from '@/lib/time';
import { DEFAULT_FEATURE_FLAGS, type ChoreLogItem, type FeatureFlags, type PenaltyItem, type ProfilePublic } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await getAuthenticatedProfile();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Trigger throttled 90-day auto-cleanup on app load (max once per 6h)
    await runRetentionCleanup(false);

    const supabase = getSupabaseAdmin();
    const [serverTime, choresRes, logsRes, profilesRes, settingsRes, penaltiesRes] = await Promise.all([
      fetchAuthoritativeServerTime(),
      supabase.from('chores').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('chore_logs').select('*').order('created_at', { ascending: false }).limit(300),
      supabase
        .from('profiles')
        .select('id, username, display_name, role, is_active, created_at')
        .order('created_at', { ascending: true }),
      supabase.from('app_settings').select('key, value'),
      supabase.from('penalties').select('*').order('created_at', { ascending: false }).limit(100),
    ]);

    let featureFlags: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS };
    let retentionDays = 90;
    let lastCleanupAt: string | null = null;

    for (const row of settingsRes.data || []) {
      if (row.key === 'feature_flags' && row.value) {
        featureFlags = {
          recurring_tasks: Boolean(row.value.recurring_tasks ?? true),
          gamification: Boolean(row.value.gamification ?? true),
          analytics: Boolean(row.value.analytics ?? true),
          penalty_fund: Boolean(row.value.penalty_fund ?? false),
        };
      } else if (row.key === 'retention_days' && typeof row.value?.days === 'number') {
        retentionDays = row.value.days;
      } else if (row.key === 'last_cleanup_at' && row.value?.timestamp) {
        lastCleanupAt = String(row.value.timestamp);
      }
    }

    const profileMap = new Map<string, ProfilePublic>();
    const members: ProfilePublic[] = (profilesRes.data || []).map((p) => {
      const item: ProfilePublic = {
        id: p.id,
        username: p.username,
        display_name: p.display_name || p.username,
        role: p.role === 'admin' ? 'admin' : 'member',
        is_active: Boolean(p.is_active),
        created_at: p.created_at,
      };
      profileMap.set(item.id, item);
      return item;
    });

    const choreMap = new Map<string, { title: string; icon: string }>();
    for (const c of choresRes.data || []) {
      choreMap.set(c.id, { title: c.title, icon: c.icon || 'sparkles' });
    }

    const logs: ChoreLogItem[] = (logsRes.data || []).map((l) => {
      const member = profileMap.get(l.profile_id);
      const chore = choreMap.get(l.chore_id);
      return {
        id: l.id,
        chore_id: l.chore_id,
        profile_id: l.profile_id,
        proof_url: l.proof_url,
        storage_path: l.storage_path || '',
        points_awarded: Number(l.points_awarded || 0),
        chore_title_snapshot: l.chore_title_snapshot || chore?.title || 'Việc nhà',
        server_timestamp: l.server_timestamp,
        created_at: l.created_at,
        member_name: member?.display_name || member?.username || 'Thành viên',
        member_username: member?.username || '',
        chore_title: chore?.title || l.chore_title_snapshot || 'Việc nhà',
        chore_icon: chore?.icon || 'sparkles',
      };
    });

    const penalties: PenaltyItem[] = (penaltiesRes.data || []).map((p) => {
      const member = profileMap.get(p.profile_id);
      const chore = p.chore_id ? choreMap.get(p.chore_id) : null;
      return {
        id: p.id,
        profile_id: p.profile_id,
        chore_id: p.chore_id,
        amount: Number(p.amount || 0),
        reason: p.reason,
        status: p.status === 'paid' ? 'paid' : 'unpaid',
        created_at: p.created_at,
        paid_at: p.paid_at,
        member_name: member?.display_name || member?.username || 'Thành viên',
        chore_title: chore?.title || null,
      };
    });

    return NextResponse.json({
      me,
      chores: choresRes.data || [],
      logs,
      members,
      penalties,
      featureFlags,
      retentionDays,
      lastCleanupAt,
      serverNowIso: serverTime.isoUtc,
      serverVnFormatted: serverTime.vnFormatted,
    });
  } catch (err) {
    console.error('Bootstrap error:', err);
    return NextResponse.json({ error: 'Không thể tải dữ liệu.' }, { status: 500 });
  }
}
