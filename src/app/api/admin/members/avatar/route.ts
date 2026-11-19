import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { recordAuditLog } from '@/lib/audit';
import { getAuthenticatedSession } from '@/lib/auth';
import { verifySignedRequest } from '@/lib/requestIntegrity';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';

const MAX_AVATAR_BYTES = 80 * 1024;
const ALLOWED_MIMES = new Set(['image/webp', 'image/jpeg', 'image/png']);

function extractAvatarStoragePath(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = '/storage/v1/object/public/avatars/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length).split('?')[0]);
}

export async function POST(req: Request) {
  const session = await getAuthenticatedSession();
  const me = session?.profile;
  if (!session || !me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const verified = await verifySignedRequest(req, session);
  if (!verified.ok) return verified.response;

  try {
    const formData = verified.formData;
    if (!formData) {
      return NextResponse.json({ error: 'Dữ liệu FormData không hợp lệ.' }, { status: 400 });
    }

    const memberId = String(formData.get('memberId') || '').trim();
    const avatar = formData.get('avatar');
    if (!memberId || !(avatar instanceof Blob)) {
      return NextResponse.json({ error: 'Thiếu ID thành viên hoặc ảnh đại diện.' }, { status: 400 });
    }
    if (avatar.size === 0 || avatar.size > MAX_AVATAR_BYTES) {
      return NextResponse.json({ error: 'Ảnh đại diện vượt quá giới hạn dung lượng.' }, { status: 400 });
    }
    if (!ALLOWED_MIMES.has(avatar.type)) {
      return NextResponse.json({ error: 'Chỉ hỗ trợ WebP, JPEG hoặc PNG.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: target } = await supabase
      .from('profiles')
      .select('id, display_name, username, avatar_url')
      .eq('id', memberId)
      .maybeSingle();

    if (!target) {
      return NextResponse.json({ error: 'Không tìm thấy thành viên.' }, { status: 404 });
    }

    const ext = avatar.type === 'image/png' ? 'png' : avatar.type === 'image/jpeg' ? 'jpg' : 'webp';
    const path = `${memberId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const buffer = Buffer.from(await avatar.arrayBuffer());

    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .upload(path, buffer, {
        contentType: avatar.type,
        cacheControl: '31536000',
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json({ error: 'Không thể tải ảnh đại diện lên kho lưu trữ.' }, { status: 500 });
    }

    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
    const avatarUrl = pub.publicUrl;

    const { error: updErr } = await supabase
      .from('profiles')
      .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
      .eq('id', memberId);

    if (updErr) {
      await supabase.storage.from('avatars').remove([path]);
      return NextResponse.json({ error: 'Không thể lưu ảnh đại diện.' }, { status: 500 });
    }

    const oldPath = extractAvatarStoragePath(target.avatar_url);
    if (oldPath) {
      await supabase.storage.from('avatars').remove([oldPath]).catch(() => undefined);
    }

    await recordAuditLog({
      actorName: me.display_name,
      actionType: 'UPDATE_AVATAR',
      targetSummary: `Cập nhật avatar cho "${target.display_name || target.username}"`,
      refId: memberId,
    });

    await bumpSyncSignal('all');
    return NextResponse.json({ avatar_url: avatarUrl });
  } catch (err) {
    console.error('Upload avatar error:', err);
    return NextResponse.json({ error: 'Lỗi tải ảnh đại diện.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await getAuthenticatedSession();
  const me = session?.profile;
  if (!session || !me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const verified = await verifySignedRequest(req, session);
  if (!verified.ok) return verified.response;

  const { searchParams } = new URL(req.url);
  const memberId = String(searchParams.get('memberId') || '').trim();
  if (!memberId) {
    return NextResponse.json({ error: 'Thiếu memberId.' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: target } = await supabase
    .from('profiles')
    .select('id, display_name, username, avatar_url')
    .eq('id', memberId)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ error: 'Không tìm thấy thành viên.' }, { status: 404 });
  }

  const oldPath = extractAvatarStoragePath(target.avatar_url);
  if (oldPath) {
    await supabase.storage.from('avatars').remove([oldPath]).catch(() => undefined);
  }

  await supabase
    .from('profiles')
    .update({ avatar_url: null, updated_at: new Date().toISOString() })
    .eq('id', memberId);

  await recordAuditLog({
    actorName: me.display_name,
    actionType: 'UPDATE_AVATAR',
    targetSummary: `Gỡ avatar của "${target.display_name || target.username}"`,
    refId: memberId,
  });

  await bumpSyncSignal('all');
  return NextResponse.json({ ok: true });
}
