import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const actionType = searchParams.get('action');
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || 20)));

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('audit_logs')
    .select('id, actor_name, action_type, target_summary, created_at')
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }
  if (actionType && actionType !== 'ALL') {
    query = query.eq('action_type', actionType);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'Không thể tải nhật ký minh bạch.' }, { status: 500 });
  }

  const rawRows = data || [];
  const hasMore = rawRows.length > limit;
  const items = hasMore ? rawRows.slice(0, limit) : rawRows;
  const nextCursor = hasMore ? items[items.length - 1]?.created_at ?? null : null;

  return NextResponse.json({ items, nextCursor });
}
