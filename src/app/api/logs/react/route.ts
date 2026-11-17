import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const logId = String(body?.logId || '').trim();
    const reaction = body?.reaction === 'sloppy' ? 'sloppy' : 'ok';
    const reason = String(body?.reason || '').trim().slice(0, 120);

    if (!logId) {
      return NextResponse.json({ error: 'Thiếu ID lượt hoàn thành.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: logRow } = await supabase
      .from('chore_logs')
      .select('id, chore_title_snapshot, profile_id')
      .eq('id', logId)
      .maybeSingle();

    if (!logRow) {
      return NextResponse.json({ error: 'Không tìm thấy lượt hoàn thành.' }, { status: 404 });
    }

    await supabase.from('chore_log_reactions').upsert(
      {
        log_id: logId,
        profile_id: me.id,
        reaction,
        reason: reason || null,
      },
      { onConflict: 'log_id,profile_id' },
    );

    const { data: allReacts } = await supabase
      .from('chore_log_reactions')
      .select('reaction')
      .eq('log_id', logId);

    const hasSloppy = (allReacts || []).some((r) => r.reaction === 'sloppy');
    const hasOk = (allReacts || []).some((r) => r.reaction === 'ok');
    const nextQualityStatus = hasSloppy ? 'flagged' : hasOk ? 'ok' : 'none';

    await supabase
      .from('chore_logs')
      .update({
        quality_status: nextQualityStatus,
        flagged_by: hasSloppy ? me.id : null,
        flag_reason: hasSloppy ? reason || 'Báo làm ẩu' : null,
      })
      .eq('id', logId);

    if (reaction === 'sloppy') {
      const { data: admins } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin')
        .eq('is_active', true);

      if (admins && admins.length > 0) {
        await supabase.from('notifications').insert(
          admins.map((a) => ({
            profile_id: a.id,
            kind: 'quality_alert',
            title: `Báo làm ẩu: ${logRow.chore_title_snapshot || 'Việc nhà'}`,
            body: `${me.display_name} đã báo cáo lượt làm chưa đạt chuẩn${reason ? `: "${reason}"` : '.'}`,
          })),
        );
      }
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ ok: true, quality_status: nextQualityStatus });
  } catch (err) {
    console.error('React error:', err);
    return NextResponse.json({ error: 'Không thể gửi đánh giá.' }, { status: 500 });
  }
}
