import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const username = String(body?.username ?? '').trim();
    const secret = String(body?.secret ?? '');

    if (!username || !secret) {
      return NextResponse.json(
        { error: 'Vui lòng nhập tên đăng nhập và mật khẩu / mã PIN.' },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, role, password_hash, is_active, created_at');

    if (error || !profiles) {
      return NextResponse.json({ error: 'Không thể kết nối máy chủ xác thực.' }, { status: 500 });
    }

    const matched = profiles.find(
      (p) => p.username.toLowerCase() === username.toLowerCase(),
    );

    if (!matched || !matched.password_hash) {
      return NextResponse.json(
        { error: 'Tên đăng nhập hoặc mật khẩu / mã PIN không đúng.' },
        { status: 401 },
      );
    }

    const valid = bcrypt.compareSync(secret, matched.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: 'Tên đăng nhập hoặc mật khẩu / mã PIN không đúng.' },
        { status: 401 },
      );
    }

    if (!matched.is_active) {
      return NextResponse.json(
        { error: 'Tài khoản này đang bị tạm khóa. Liên hệ Admin để mở lại.' },
        { status: 403 },
      );
    }

    const role = matched.role === 'admin' ? 'admin' : 'member';
    const token = createSessionToken(matched.id, role);
    const res = NextResponse.json({
      user: {
        id: matched.id,
        username: matched.username,
        display_name: matched.display_name || matched.username,
        role,
        is_active: true,
        created_at: matched.created_at,
      },
    });
    res.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
    return res;
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Lỗi đăng nhập.' }, { status: 500 });
  }
}
