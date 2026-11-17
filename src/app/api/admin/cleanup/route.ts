import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth';
import { runRetentionCleanup } from '@/lib/cleanup';
import { verifySignedRequest } from '@/lib/requestIntegrity';

export async function POST(req: Request) {
  const session = await getAuthenticatedSession();
  const me = session?.profile;
  if (!session || !me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const verified = await verifySignedRequest(req, session);
  if (!verified.ok) return verified.response;

  const result = await runRetentionCleanup(true, me.display_name);
  return NextResponse.json({
    ok: true,
    deletedLogs: result?.deletedLogs ?? 0,
    deletedFiles: result?.deletedFiles ?? 0,
  });
}
