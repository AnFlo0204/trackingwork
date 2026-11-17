import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Chỉ Admin mới có quyền hủy lượt xác thực.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const logId = String(body?.logId || '').trim();
    if (!logId) {
      return NextResponse.json({ error: 'Thiếu ID lượt hoàn thành.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: logRow, error: fetchErr } = await supabase
      .from('chore_logs')
      .select('id, storage_path, proof_url')
      .eq('id', logId)
      .maybeSingle();

    if (fetchErr || !logRow) {
      return NextResponse.json({ error: 'Không tìm thấy lượt hoàn thành.' }, { status: 404 });
    }

    let storagePath = logRow.storage_path || '';
    if (!storagePath && logRow.proof_url) {
      const marker = '/chore-proofs/';
      const idx = logRow.proof_url.indexOf(marker);
      if (idx >= 0) storagePath = logRow.proof_url.slice(idx + marker.length);
    }

    if (storagePath) {
      await supabase.storage.from('chore-proofs').remove([storagePath]);
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
