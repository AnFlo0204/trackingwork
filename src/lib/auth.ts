import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { getSupabaseAdmin } from './supabaseAdmin';
import type { ProfilePublic } from './types';

export const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === 'production' ? '__Host-trackingwork-session' : 'hct_session';
const LEGACY_COOKIE_NAME = 'hct_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSessionSecret(): string {
  const explicit = process.env.APP_SESSION_SECRET;
  if (explicit && explicit.length >= 16) return explicit;
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-fallback-secret-change-in-prod';
  return crypto.createHash('sha256').update(fallback).digest('hex');
}

function getEncryptionKey(): Buffer {
  return crypto.createHash('sha256').update(`aes-gcm:${getSessionSecret()}`).digest();
}

export interface SessionPayload {
  uid: string;
  role: 'admin' | 'member';
  sid: string;
  exp: number;
}

export interface AuthenticatedSession {
  profile: ProfilePublic;
  sid: string;
  signingKey: string;
}

export function deriveSessionSigningKey(sid: string, uid: string): string {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(`request-sign:${uid}:${sid}`)
    .digest('hex');
}

export function createSessionToken(uid: string, role: 'admin' | 'member'): { token: string; sid: string; signingKey: string } {
  const sid = crypto.randomBytes(16).toString('hex');
  const payload: SessionPayload = {
    uid,
    role,
    sid,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope = `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(envelope).digest('base64url');

  return {
    token: `${envelope}.${sig}`,
    sid,
    signingKey: deriveSessionSigningKey(sid, uid),
  };
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;

  const [ivB64, tagB64, ctB64, sig] = parts;
  if (!ivB64 || !tagB64 || !ctB64 || !sig) return null;

  const envelope = `${ivB64}.${tagB64}.${ctB64}`;
  const expectedSig = crypto.createHmac('sha256', getSessionSecret()).update(envelope).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const ciphertext = Buffer.from(ctB64, 'base64url');

    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString('utf8')) as SessionPayload;

    if (!parsed.uid || !parsed.sid || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function getAuthenticatedSession(): Promise<AuthenticatedSession | null> {
  const cookieStore = cookies();
  const rawToken =
    cookieStore.get(SESSION_COOKIE_NAME)?.value || cookieStore.get(LEGACY_COOKIE_NAME)?.value;
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
    profile: {
      id: data.id,
      username: data.username,
      display_name: data.display_name || data.username,
      role,
      is_active: Boolean(data.is_active),
      can_assign_tasks: role === 'admin' ? true : Boolean(data.can_assign_tasks),
      weekly_allowance: Number(data.weekly_allowance || 0),
      current_balance: Number(data.current_balance || 0),
      created_at: data.created_at,
    },
    sid: verified.sid,
    signingKey: deriveSessionSigningKey(verified.sid, data.id),
  };
}

export async function getAuthenticatedProfile(): Promise<ProfilePublic | null> {
  const sess = await getAuthenticatedSession();
  return sess ? sess.profile : null;
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
