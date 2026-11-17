import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import type { ChoreLogItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || 20)));

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('chore_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const [logsRes, profilesRes, choresRes] = await Promise.all([
    query,
    supabase.from('profiles').select('id, username, display_name'),
    supabase.from('chores').select('id, title, icon'),
  ]);

  const rawRows = logsRes.data || [];
  const hasMore = rawRows.length > limit;
  const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
  const nextCursor = hasMore ? pageRows[pageRows.length - 1]?.created_at ?? null : null;

  const logIds = pageRows.map((l) => l.id);
  const { data: reactionsData } =
    logIds.length > 0
      ? await supabase.from('chore_log_reactions').select('*').in('log_id', logIds)
      : { data: [] };

  const profileMap = new Map<string, { username: string; display_name: string }>();
  for (const p of profilesRes.data || []) {
    profileMap.set(p.id, { username: p.username, display_name: p.display_name || p.username });
  }
  const choreMap = new Map<string, { title: string; icon: string }>();
  for (const c of choresRes.data || []) {
    choreMap.set(c.id, { title: c.title, icon: c.icon || 'sparkles' });
  }

  const reactionStats = new Map<string, { ok: number; sloppy: number; mine: 'ok' | 'sloppy' | null }>();
  for (const r of reactionsData || []) {
    const prev = reactionStats.get(r.log_id) || { ok: 0, sloppy: 0, mine: null };
    if (r.reaction === 'ok') prev.ok += 1;
    if (r.reaction === 'sloppy') prev.sloppy += 1;
    if (r.profile_id === me.id) prev.mine = r.reaction === 'sloppy' ? 'sloppy' : 'ok';
    reactionStats.set(r.log_id, prev);
  }

  const items: ChoreLogItem[] = pageRows.map((l) => {
    const member = profileMap.get(l.profile_id);
    const chore = choreMap.get(l.chore_id);
    const rStats = reactionStats.get(l.id) || { ok: 0, sloppy: 0, mine: null };
    return {
      id: l.id,
      chore_id: l.chore_id,
      profile_id: l.profile_id,
      assigned_chore_id: l.assigned_chore_id || null,
      cycle_key: l.cycle_key || null,
      proof_url: l.proof_url,
      thumb_url: l.thumb_url || null,
      storage_path: l.storage_path || '',
      before_proof_url: l.before_proof_url || null,
      before_storage_path: l.before_storage_path || null,
      started_at: l.started_at || null,
      points_awarded: Number(l.points_awarded || 0),
      chore_title_snapshot: l.chore_title_snapshot || chore?.title || 'Việc nhà',
      quality_status: l.quality_status || 'none',
      ok_count: rStats.ok,
      sloppy_count: rStats.sloppy,
      my_reaction: rStats.mine,
      bonus_awarded: Number(l.bonus_awarded || 0),
      bonus_by: l.bonus_by || null,
      bonus_note: l.bonus_note || null,
      server_timestamp: l.server_timestamp,
      created_at: l.created_at,
      member_name: member?.display_name || member?.username || 'Thành viên',
      member_username: member?.username || '',
      chore_title: chore?.title || l.chore_title_snapshot || 'Việc nhà',
      chore_icon: chore?.icon || 'sparkles',
    };
  });

  return NextResponse.json({ items, nextCursor });
}
