'use client';

export const SECURITY_POLICY = Object.freeze({
  allowedHostsRaw: process.env.NEXT_PUBLIC_ALLOWED_HOST || 'trackingwork-alpha.vercel.app',
  isDev: process.env.NODE_ENV === 'development',
  devtoolsDeltaPx: 160,
  watermarkTag: 'TWST1',
});

export function isAuthorizedRuntimeOrigin(): boolean {
  if (typeof window === 'undefined') return true;
  if (window.location.protocol === 'file:') return false;

  const host = (window.location.hostname || '').toLowerCase().trim();
  if (!host) return false;

  if (SECURITY_POLICY.isDev && (host === 'localhost' || host === '127.0.0.1')) {
    return true;
  }

  const allowed = SECURITY_POLICY.allowedHostsRaw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(host);
}

export function triggerDomSelfDestruct(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  try {
    document.title = 'Unauthorized Clone Blocked';
    if (document.body) {
      document.body.innerHTML = '';
      document.body.style.cssText = 'display:none!important;background:#000!important;';
    }
    Array.from(document.styleSheets).forEach((sheet) => {
      try {
        sheet.disabled = true;
      } catch {
        // ignore cross-origin stylesheet
      }
    });
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((el) => el.remove());
    const abortedFetch = () => Promise.reject(new DOMException('Aborted', 'AbortError'));
    Object.defineProperty(window, 'fetch', {
      value: abortedFetch,
      writable: false,
      configurable: false,
    });
  } catch {
    // hard stop
  }
}
