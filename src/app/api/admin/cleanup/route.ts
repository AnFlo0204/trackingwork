import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { runRetentionCleanup } from '@/lib/cleanup';

export async function POST() {
  const me = await getAuthenticatedProfile();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await runRetentionCleanup(true, me.display_name);
  return NextResponse.json({
    ok: true,
    deletedLogs: result?.deletedLogs ?? 0,
    deletedFiles: result?.deletedFiles ?? 0,
  });
}
