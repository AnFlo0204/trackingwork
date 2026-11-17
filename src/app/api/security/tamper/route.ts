import { NextResponse } from 'next/server';
import { recordAuditLog } from '@/lib/audit';
import { getAuthenticatedProfile } from '@/lib/auth';

const reportedRecently = new Map<string, number>();

export async function POST(req: Request) {
  try {
    const me = await getAuthenticatedProfile();
    const body = await req.json().catch(() => ({}));
    const signal = String(body?.signal || 'devtools_open').slice(0, 100);

    const key = me ? me.id : req.headers.get('x-forwarded-for') || 'anon';
    const now = Date.now();
    const last = reportedRecently.get(key) || 0;
    if (now - last < 5 * 60_000) {
      return NextResponse.json({ ok: true, deduped: true });
    }
    if (reportedRecently.size > 1000) {
      reportedRecently.clear();
    }
    reportedRecently.set(key, now);

    await recordAuditLog({
      actorName: me ? me.display_name : 'Khách (Chưa đăng nhập)',
      actionType: 'DEVTOOLS_TAMPER_ATTEMPT',
      targetSummary: `Phát hiện dấu hiệu mở DevTools / can thiệp DOM (${signal})`,
      refId: me?.id ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
