import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { fetchAuthoritativeServerTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await getAuthenticatedProfile();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serverTime = await fetchAuthoritativeServerTime();
  return NextResponse.json(serverTime);
}
