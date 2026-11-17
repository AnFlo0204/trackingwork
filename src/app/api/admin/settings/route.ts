import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Chỉ Admin mới có quyền thay đổi cấu hình.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const supabase = getSupabaseAdmin();

    if (body?.featureFlags && typeof body.featureFlags === 'object') {
      const ff = body.featureFlags;
      const sanitized = {
        recurring_tasks: Boolean(ff.recurring_tasks),
        gamification: Boolean(ff.gamification),
        analytics: Boolean(ff.analytics),
        penalty_fund: Boolean(ff.penalty_fund),
      };
      const { error } = await supabase
        .from('app_settings')
        .upsert({ key: 'feature_flags', value: sanitized }, { onConflict: 'key' });
      if (error) {
        return NextResponse.json({ error: 'Không thể lưu công tắc tính năng.' }, { status: 500 });
      }
    }

    if (typeof body?.retentionDays !== 'undefined') {
      const days = Math.floor(Number(body.retentionDays));
      if (!Number.isFinite(days) || days < 1 || days > 3650) {
        return NextResponse.json({ error: 'Chu kỳ lưu trữ phải từ 1 đến 3650 ngày.' }, { status: 400 });
      }
      const { error } = await supabase
        .from('app_settings')
        .upsert({ key: 'retention_days', value: { days } }, { onConflict: 'key' });
      if (error) {
        return NextResponse.json({ error: 'Không thể lưu chu kỳ lưu trữ.' }, { status: 500 });
      }
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Admin settings error:', err);
    return NextResponse.json({ error: 'Lỗi cập nhật cấu hình.' }, { status: 500 });
  }
}
