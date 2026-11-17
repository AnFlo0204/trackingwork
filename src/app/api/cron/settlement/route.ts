import { NextResponse } from 'next/server';
import { runWeeklySettlementAndDeductions } from '@/lib/allowanceEngine';
import { fetchAuthoritativeServerTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const serverTime = await fetchAuthoritativeServerTime();
  const serverNowMs = Date.parse(serverTime.isoUtc) || Date.now();
  await runWeeklySettlementAndDeductions(serverNowMs);

  return NextResponse.json({ ok: true, settledAt: serverTime.vnFormatted });
}
