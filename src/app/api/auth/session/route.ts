import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Lightweight same-origin session probe.
 * Enables seamless restoration when SameSite=Strict hides cookies on cross-site top-level navigation.
 */
export async function GET() {
  const session = await getAuthenticatedSession();
  return NextResponse.json(
    {
      authed: Boolean(session),
      rememberMe: session?.rememberMe ?? false,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
