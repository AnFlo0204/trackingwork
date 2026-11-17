import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAuthenticatedProfile } from '@/lib/auth';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';

const MAX_MEMBERS = 10;

export async function POST(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const username = String(body?.username || '').trim();
    const displayName = String(body?.display_name || username).trim();
    const pin = String(body?.pin || '').trim();

    if (!username || username.length < 2) {
      return NextResponse.json({ error: 'Tên đăng nhập phải có ít nhất 2 ký tự.' }, { status: 400 });
    }
    if (!/^\d{6}$/.test(pin)) {
      return NextResponse.json({ error: 'Mã PIN thành viên phải gồm đúng 6 chữ số.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: existingProfiles } = await supabase
      .from('profiles')
      .select('id, username, role');

    const memberCount = (existingProfiles || []).filter((p) => p.role === 'member').length;
    if (memberCount >= MAX_MEMBERS) {
      return NextResponse.json(
        { error: `Đã đạt giới hạn tối đa ${MAX_MEMBERS} thành viên.` },
        { status: 400 },
      );
    }

    const dup = (existingProfiles || []).some(
      (p) => p.username.toLowerCase() === username.toLowerCase(),
    );
    if (dup) {
      return NextResponse.json({ error: 'Tên đăng nhập này đã tồn tại.' }, { status: 409 });
    }

    const passwordHash = bcrypt.hashSync(pin, 10);
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        username,
        display_name: displayName || username,
        role: 'member',
        pin: null,
        password_hash: passwordHash,
        is_active: true,
      })
      .select('id, username, display_name, role, is_active, created_at')
      .single();

    if (error) {
      return NextResponse.json({ error: 'Không thể tạo thành viên.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ member: data });
  } catch (err) {
    console.error('Create member error:', err);
    return NextResponse.json({ error: 'Lỗi tạo thành viên.' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const id = String(body?.id || '').trim();
    if (!id) {
      return NextResponse.json({ error: 'Thiếu ID thành viên.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: target } = await supabase
      .from('profiles')
      .select('id, role, username')
      .eq('id', id)
      .maybeSingle();

    if (!target) {
      return NextResponse.json({ error: 'Không tìm thấy thành viên.' }, { status: 404 });
    }
    if (target.role === 'admin') {
      return NextResponse.json({ error: 'Không thể chỉnh sửa trạng thái hoặc PIN tài khoản Admin tại đây.' }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.display_name === 'string' && body.display_name.trim()) {
      updates.display_name = body.display_name.trim();
    }
    if (typeof body.is_active === 'boolean') {
      updates.is_active = body.is_active;
    }
    if (typeof body.pin === 'string' && body.pin.trim() !== '') {
      const pin = body.pin.trim();
      if (!/^\d{6}$/.test(pin)) {
        return NextResponse.json({ error: 'Mã PIN mới phải gồm đúng 6 chữ số.' }, { status: 400 });
      }
      updates.password_hash = bcrypt.hashSync(pin, 10);
    }

    const { error } = await supabase.from('profiles').update(updates).eq('id', id);
    if (error) {
      return NextResponse.json({ error: 'Không thể cập nhật thành viên.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Update member error:', err);
    return NextResponse.json({ error: 'Lỗi cập nhật thành viên.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Thiếu ID thành viên.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: target } = await supabase.from('profiles').select('id, role').eq('id', id).maybeSingle();
    if (!target || target.role === 'admin') {
      return NextResponse.json({ error: 'Không thể xóa tài khoản Admin.' }, { status: 400 });
    }

    const { data: logs } = await supabase.from('chore_logs').select('storage_path').eq('profile_id', id);
    const paths = (logs || []).map((l) => l.storage_path).filter(Boolean);
    if (paths.length > 0) {
      await supabase.storage.from('chore-proofs').remove(paths);
    }

    const { error } = await supabase.from('profiles').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ error: 'Không thể xóa thành viên.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Delete member error:', err);
    return NextResponse.json({ error: 'Lỗi xóa thành viên.' }, { status: 500 });
  }
}
