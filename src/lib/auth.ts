import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { getSupabaseAdmin } from './supabaseAdmin';
import type { ProfilePublic } from './types';

export const SESSION_COOKIE_NAME = 'hct_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSessionSecret(): string {
  const explicit = process.env.APP_SESSION_SECRET;
  if (explicit && explicit.length >= 16) return explicit;
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-fallback-secret-change-in-prod';
  return crypto.createHash('sha256').update(fallback).digest('hex');
}

interface SessionPayload {
  uid: string;
  role: 'admin' | 'member';
  exp: number;
}

export function createSessionToken(uid: string, role: 'admin' | 'member'): string {
  const payload: SessionPayload = {
    uid,
    role,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.uid || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function getAuthenticatedProfile(): Promise<ProfilePublic | null> {
  const cookieStore = cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const verified = verifySessionToken(rawToken);
  if (!verified) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, username, display_name, role, is_active, can_assign_tasks, weekly_allowance, current_balance, created_at',
    )
    .eq('id', verified.uid)
    .maybeSingle();

  if (error || !data || !data.is_active) return null;
  const role = data.role === 'admin' ? 'admin' : 'member';
  return {
    id: data.id,
    username: data.username,
    display_name: data.display_name || data.username,
    role,
    is_active: Boolean(data.is_active),
    can_assign_tasks: role === 'admin' ? true : Boolean(data.can_assign_tasks),
    weekly_allowance: Number(data.weekly_allowance || 0),
    current_balance: Number(data.current_balance || 0),
    created_at: data.created_at,
  };
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
