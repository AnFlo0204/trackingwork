import { NextResponse, type NextRequest } from 'next/server';

const BLOCKED_UA_REGEX =
  /(httrack|wget|curl\/|python-requests|python-urllib|aiohttp|httpx|go-http-client|scrapy|puppeteer|playwright|headlesschrome|phantomjs|selenium|webdriver|postmanruntime|insomnia|apache-httpclient|libwww-perl)/i;

const WINDOW_MS = 60_000;
const GENERAL_LIMIT_PER_MIN = 100;
const MUTATION_LIMIT_PER_MIN = 30;
const LOGIN_LIMIT_PER_MIN = 15;
const MAX_BUCKETS = 4000;

const ipWindowStore = new Map<string, number[]>();
const sessionMutationStore = new Map<string, number[]>();
const loginIpStore = new Map<string, number[]>();

function checkSlidingWindow(
  store: Map<string, number[]>,
  key: string,
  limit: number,
  now: number,
): { allowed: boolean; remaining: number; retryAfterSec: number } {
  if (store.size > MAX_BUCKETS) {
    store.clear();
  }

  const cutoff = now - WINDOW_MS;
  const timestamps = (store.get(key) || []).filter((t) => t > cutoff);

  if (timestamps.length >= limit) {
    store.set(key, timestamps);
    const oldest = timestamps[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  timestamps.push(now);
  store.set(key, timestamps);
  return {
    allowed: true,
    remaining: Math.max(0, limit - timestamps.length),
    retryAfterSec: 0,
  };
}

function getClientIp(req: NextRequest): string {
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (fwd) return fwd;
  return req.ip || 'unknown';
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // Allow Vercel internal cron triggers on /api/cron/settlement
  if (pathname.startsWith('/api/cron/')) {
    if (req.headers.get('x-vercel-cron') || req.headers.get('authorization')) {
      return NextResponse.next();
    }
  }

  const ua = (req.headers.get('user-agent') || '').trim();
  const accept = (req.headers.get('accept') || '').toLowerCase();
  const acceptLang = (req.headers.get('accept-language') || '').trim();
  const secChUa = (req.headers.get('sec-ch-ua') || '').toLowerCase();

  // 1. Anti-Scraping & Headless Browser Blocking
  if (!ua || BLOCKED_UA_REGEX.test(ua) || secChUa.includes('headlesschrome')) {
    return NextResponse.json(
      { error: 'Forbidden: Automated scraping or headless client blocked.' },
      { status: 403 },
    );
  }

  // Document navigation requests must carry genuine browser Accept-Language
  if (method === 'GET' && accept.includes('text/html') && !acceptLang) {
    return NextResponse.json(
      { error: 'Forbidden: Invalid browser fingerprint.' },
      { status: 403 },
    );
  }

  // 2. Sliding-Window Edge Rate Limiting (protect Vercel & Supabase free-tier quotas)
  const now = Date.now();
  const ip = getClientIp(req);

  const ipCheck = checkSlidingWindow(ipWindowStore, `ip:${ip}`, GENERAL_LIMIT_PER_MIN, now);
  if (!ipCheck.allowed) {
    return NextResponse.json(
      { error: 'Quá nhiều yêu cầu từ địa chỉ IP của bạn. Vui lòng thử lại sau.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(ipCheck.retryAfterSec),
          'X-RateLimit-Limit': String(GENERAL_LIMIT_PER_MIN),
          'X-RateLimit-Remaining': '0',
        },
      },
    );
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const loginCheck = checkSlidingWindow(loginIpStore, `login:${ip}`, LOGIN_LIMIT_PER_MIN, now);
    if (!loginCheck.allowed) {
      return NextResponse.json(
        { error: 'Thử đăng nhập quá nhanh. Vui lòng chờ 1 phút rồi thử lại.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(loginCheck.retryAfterSec),
          },
        },
      );
    }
  }

  const isMutatingApi =
    pathname.startsWith('/api/') &&
    pathname !== '/api/auth/login' &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (isMutatingApi) {
    const sessionCookie =
      req.cookies.get('__Host-trackingwork-session')?.value ||
      req.cookies.get('hct_session')?.value ||
      '';
    const sessionKey = sessionCookie ? `sess:${sessionCookie.slice(-24)}` : `anon:${ip}`;

    const mutCheck = checkSlidingWindow(
      sessionMutationStore,
      sessionKey,
      MUTATION_LIMIT_PER_MIN,
      now,
    );
    if (!mutCheck.allowed) {
      return NextResponse.json(
        { error: 'Thao tác quá nhanh (giới hạn 30 yêu cầu/phút). Vui lòng đợi một lát.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(mutCheck.retryAfterSec),
            'X-RateLimit-Limit': String(MUTATION_LIMIT_PER_MIN),
            'X-RateLimit-Remaining': '0',
          },
        },
      );
    }
  }

  const res = NextResponse.next();
  res.headers.set('X-RateLimit-Limit', String(GENERAL_LIMIT_PER_MIN));
  res.headers.set('X-RateLimit-Remaining', String(ipCheck.remaining));
  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icon-192.png|icon-512.png|apple-touch-icon.png).*)',
  ],
};
