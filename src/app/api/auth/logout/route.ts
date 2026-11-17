import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  const clearOpts = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  };
  res.cookies.set(SESSION_COOKIE_NAME, '', clearOpts);
  if (SESSION_COOKIE_NAME !== 'hct_session') {
    res.cookies.set('hct_session', '', clearOpts);
  }
  return res;
}
