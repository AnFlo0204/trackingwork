import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchAuthoritativeServerTime } from '@/lib/time';

export async function POST(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me) {
    return NextResponse.json({ error: 'Phiên đăng nhập hết hạn.' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const choreId = String(formData.get('choreId') || '').trim();
    const photo = formData.get('photo');

    if (!choreId || !(photo instanceof Blob)) {
      return NextResponse.json({ error: 'Thiếu thông tin công việc hoặc ảnh xác thực.' }, { status: 400 });
    }

    if (photo.size === 0 || photo.size > 300 * 1024) {
      return NextResponse.json(
        { error: 'Dung lượng ảnh không hợp lệ (tối đa ~180KB sau khi nén).' },
        { status: 400 },
      );
    }

    const allowedTypes = ['image/webp', 'image/jpeg', 'image/png'];
    const mimeType = allowedTypes.includes(photo.type) ? photo.type : 'image/webp';
    const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp';

    const supabase = getSupabaseAdmin();
    const [serverTime, choreRes, settingsRes, latestLogRes] = await Promise.all([
      fetchAuthoritativeServerTime(),
      supabase.from('chores').select('*').eq('id', choreId).eq('is_active', true).maybeSingle(),
      supabase.from('app_settings').select('value').eq('key', 'feature_flags').maybeSingle(),
      supabase
        .from('chore_logs')
        .select('id, server_timestamp')
        .eq('chore_id', choreId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const chore = choreRes.data;
    if (!chore) {
      return NextResponse.json({ error: 'Công việc không tồn tại hoặc đã bị ẩn.' }, { status: 404 });
    }

    // Server-side cooldown check against authoritative server time
    const serverNowMs = Date.parse(serverTime.isoUtc);
    const cooldownMs = Math.max(0, Number(chore.cooldown_minutes || 0)) * 60_000;
    if (latestLogRes.data && cooldownMs > 0) {
      const lastMs = Date.parse(latestLogRes.data.server_timestamp);
      const elapsed = serverNowMs - lastMs;
      if (elapsed >= 0 && elapsed < cooldownMs) {
        const remainMin = Math.ceil((cooldownMs - elapsed) / 60_000);
        return NextResponse.json(
          { error: `Việc này vừa được hoàn thành. Vui lòng đợi thêm ${remainMin} phút.` },
          { status: 429 },
        );
      }
    }

    const buffer = Buffer.from(await photo.arrayBuffer());
    const storagePath = `${chore.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from('chore-proofs')
      .upload(storagePath, buffer, {
        contentType: mimeType,
        cacheControl: '31536000',
        upsert: false,
      });

    if (uploadErr) {
      console.error('Upload error:', uploadErr);
      return NextResponse.json({ error: 'Không thể tải ảnh lên máy chủ.' }, { status: 500 });
    }

    const { data: publicUrlData } = supabase.storage.from('chore-proofs').getPublicUrl(storagePath);
    const gamificationOn = Boolean(settingsRes.data?.value?.gamification ?? true);
    const pointsAwarded = gamificationOn ? Number(chore.points || 0) : 0;

    const { data: insertedLog, error: insertErr } = await supabase
      .from('chore_logs')
      .insert({
        chore_id: chore.id,
        profile_id: me.id,
        proof_url: publicUrlData.publicUrl,
        storage_path: storagePath,
        points_awarded: pointsAwarded,
        chore_title_snapshot: chore.title,
        server_timestamp: serverTime.isoUtc,
      })
      .select()
      .single();

    if (insertErr) {
      await supabase.storage.from('chore-proofs').remove([storagePath]);
      console.error('Insert log error:', insertErr);
      return NextResponse.json({ error: 'Không thể lưu lịch sử hoàn thành.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ log: insertedLog });
  } catch (err) {
    console.error('Complete chore error:', err);
    return NextResponse.json({ error: 'Lỗi xử lý hoàn thành việc.' }, { status: 500 });
  }
}
