import { NextResponse } from 'next/server';
import { addToSharedPartyFund } from '@/lib/allowanceEngine';
import { recordAuditLog } from '@/lib/audit';
import { getAuthenticatedProfile } from '@/lib/auth';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchAuthoritativeServerTime, formatIsoToVn } from '@/lib/time';

function extractPath(url: string | null | undefined): string {
  if (!url) return '';
  const marker = '/chore-proofs/';
  const idx = url.indexOf(marker);
  return idx >= 0 ? url.slice(idx + marker.length) : '';
}

export async function POST(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Chỉ Admin mới có quyền duyệt hủy lượt.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const logId = String(body?.logId || '').trim();
    const action = body?.action === 'rework_half_penalty' ? 'rework_half_penalty' : 'reject';

    if (!logId) {
      return NextResponse.json({ error: 'Thiếu ID lượt hoàn thành.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: logRow, error: fetchErr } = await supabase
      .from('chore_logs')
      .select(
        'id, chore_id, profile_id, assigned_chore_id, cycle_key, storage_path, proof_url, before_storage_path, before_proof_url, thumb_storage_path, chore_title_snapshot, server_timestamp',
      )
      .eq('id', logId)
      .maybeSingle();

    if (fetchErr || !logRow) {
      return NextResponse.json({ error: 'Không tìm thấy lượt hoàn thành.' }, { status: 404 });
    }

    const { data: authorProfile } = await supabase
      .from('profiles')
      .select('display_name, username')
      .eq('id', logRow.profile_id)
      .maybeSingle();
    const authorName = authorProfile?.display_name || authorProfile?.username || 'Thành viên';
    const choreTitle = logRow.chore_title_snapshot || 'Việc nhà';

    if (action === 'rework_half_penalty') {
      const [choreRes, assignRes, profileRes, serverTime] = await Promise.all([
        supabase.from('chores').select('title, penalty_amount').eq('id', logRow.chore_id).maybeSingle(),
        logRow.assigned_chore_id
          ? supabase
              .from('assigned_chores')
              .select('penalty_amount')
              .eq('id', logRow.assigned_chore_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from('profiles')
          .select('id, current_balance')
          .eq('id', logRow.profile_id)
          .maybeSingle(),
        fetchAuthoritativeServerTime(),
      ]);

      const basePenalty = Number(
        assignRes.data?.penalty_amount ?? choreRes.data?.penalty_amount ?? 20000,
      );
      const halfPenalty = Math.max(5000, Math.round(basePenalty / 2));

      if (profileRes.data) {
        const nextBal = Number(profileRes.data.current_balance || 0) - halfPenalty;
        await Promise.all([
          supabase
            .from('profiles')
            .update({ current_balance: nextBal, updated_at: serverTime.isoUtc })
            .eq('id', profileRes.data.id),
          supabase.from('fund_transactions').insert({
            profile_id: profileRes.data.id,
            assigned_chore_id: logRow.assigned_chore_id,
            chore_id: logRow.chore_id,
            tx_type: 'penalty',
            category: 'penalty',
            amount: -halfPenalty,
            balance_after: nextBal,
            cycle_key: logRow.cycle_key,
            description: `Làm ẩu (Phạt 50% & làm lại): ${choreTitle}`,
            created_by: me.id,
            server_timestamp: serverTime.isoUtc,
          }),
          supabase.from('notifications').insert({
            profile_id: profileRes.data.id,
            kind: 'quality_alert',
            title: `Yêu cầu làm lại: ${choreTitle}`,
            body: `Admin đánh giá làm chưa đạt chuẩn, trừ 50% phạt (-${halfPenalty.toLocaleString('vi-VN')}đ) và mở lại lượt làm.`,
          }),
          addToSharedPartyFund(halfPenalty),
        ]);
      }

      await recordAuditLog({
        actorName: me.display_name,
        actionType: 'REWORK_HALF_PENALTY',
        targetSummary: `Phạt 50% (-${halfPenalty.toLocaleString('vi-VN')}đ) & yêu cầu làm lại "${choreTitle}" của ${authorName}`,
        refId: logRow.id,
      });
    } else {
      await recordAuditLog({
        actorName: me.display_name,
        actionType: 'REJECT_PROOF',
        targetSummary: `Từ chối / Xóa ảnh "${choreTitle}" của ${authorName} (lúc ${formatIsoToVn(logRow.server_timestamp)})`,
        refId: logRow.id,
      });
    }

    const toRemove: string[] = [];
    const afterPath = logRow.storage_path || extractPath(logRow.proof_url);
    const beforePath = logRow.before_storage_path || extractPath(logRow.before_proof_url);
    if (afterPath) toRemove.push(afterPath);
    if (beforePath) toRemove.push(beforePath);
    if (logRow.thumb_storage_path) toRemove.push(logRow.thumb_storage_path);

    if (toRemove.length > 0) {
      await supabase.storage.from('chore-proofs').remove(toRemove);
    }

    const { error: delErr } = await supabase.from('chore_logs').delete().eq('id', logId);
    if (delErr) {
      return NextResponse.json({ error: 'Không thể xóa lượt hoàn thành.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Moderate error:', err);
    return NextResponse.json({ error: 'Lỗi duyệt hủy lượt.' }, { status: 500 });
  }
}
