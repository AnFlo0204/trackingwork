import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { recordAuditLog } from '@/lib/audit';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/auth';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const username = String(body?.username ?? '').trim();
    const secret = String(body?.secret ?? '');
    const rememberMe = body?.rememberMe !== false;

    if (!username || !secret) {
      return NextResponse.json(
        { error: 'Vui lòng nhập tên đăng nhập và mật khẩu / mã PIN.' },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select(
        'id, username, display_name, role, avatar_url, pin, password_hash, is_active, can_assign_tasks, weekly_allowance, current_balance, failed_attempts, locked_until, created_at',
      );

    if (error || !profiles) {
      return NextResponse.json({ error: 'Không thể kết nối máy chủ xác thực.' }, { status: 500 });
    }

    const matched = profiles.find(
      (p) => p.username.toLowerCase() === username.toLowerCase(),
    );

    if (!matched) {
      return NextResponse.json(
        { error: 'Tên đăng nhập hoặc mật khẩu / mã PIN không đúng.' },
        { status: 401 },
      );
    }

    // Check brute-force lockout
    const nowMs = Date.now();
    if (matched.locked_until) {
      const lockUntilMs = Date.parse(matched.locked_until);
      if (!Number.isNaN(lockUntilMs) && lockUntilMs > nowMs) {
        const remainMin = Math.ceil((lockUntilMs - nowMs) / 60_000);
        return NextResponse.json(
          {
            error: `Tài khoản tạm khóa do nhập sai quá 5 lần. Vui lòng thử lại sau ${remainMin} phút.`,
          },
          { status: 429 },
        );
      }
    }

    // Safe one-time migration if a legacy row still has plaintext `pin` and no `password_hash`
    let passwordHash = matched.password_hash || '';
    if (!passwordHash && matched.pin) {
      passwordHash = bcrypt.hashSync(String(matched.pin).trim(), 10);
      await supabase
        .from('profiles')
        .update({ password_hash: passwordHash, pin: null })
        .eq('id', matched.id);
    }

    const valid = Boolean(passwordHash) && bcrypt.compareSync(secret, passwordHash);
    if (!valid) {
      const prevFails =
        matched.locked_until && Date.parse(matched.locked_until) <= nowMs
          ? 0
          : Number(matched.failed_attempts || 0);
      const nextFails = prevFails + 1;
      const shouldLock = nextFails >= MAX_FAILED_ATTEMPTS;

      await supabase
        .from('profiles')
        .update({
          failed_attempts: nextFails,
          locked_until: shouldLock ? new Date(nowMs + LOCK_DURATION_MS).toISOString() : null,
        })
        .eq('id', matched.id);

      if (shouldLock) {
        await recordAuditLog({
          actorName: matched.display_name || matched.username,
          actionType: 'AUTH_BRUTE_FORCE_LOCK',
          targetSummary: `Khóa tài khoản "@${matched.username}" 15 phút sau 5 lần nhập sai PIN/mật khẩu`,
          refId: matched.id,
        });
        return NextResponse.json(
          {
            error: 'Bạn đã nhập sai 5 lần liên tiếp. Tài khoản bị khóa trong 15 phút.',
          },
          { status: 429 },
        );
      }

      return NextResponse.json(
        {
          error: `Sai mật khẩu / mã PIN (Còn ${MAX_FAILED_ATTEMPTS - nextFails} lần thử).`,
        },
        { status: 401 },
      );
    }

    if (!matched.is_active) {
      return NextResponse.json(
        { error: 'Tài khoản này đang bị tạm khóa. Liên hệ Admin để mở lại.' },
        { status: 403 },
      );
    }

    // Reset failed attempts on successful login
    if (Number(matched.failed_attempts || 0) > 0 || matched.locked_until) {
      await supabase
        .from('profiles')
        .update({ failed_attempts: 0, locked_until: null })
        .eq('id', matched.id);
    }

    const role = matched.role === 'admin' ? 'admin' : 'member';
    const { token, signingKey } = createSessionToken(matched.id, role, { rememberMe });
    const res = NextResponse.json({
      signingKey,
      rememberMe,
      serverNowMs: Date.now(),
      user: {
        id: matched.id,
        username: matched.username,
        display_name: matched.display_name || matched.username,
        role,
        avatar_url: matched.avatar_url || null,
        is_active: true,
        can_assign_tasks: role === 'admin' ? true : Boolean(matched.can_assign_tasks),
        weekly_allowance: Number(matched.weekly_allowance || 0),
        current_balance: Number(matched.current_balance || 0),
        created_at: matched.created_at,
      },
    });
    res.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions(rememberMe));
    return res;
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Lỗi đăng nhập.' }, { status: 500 });
  }
}
