'use client';

const SIGNING_CONFIG = Object.freeze({
  nonceEndpoint: '/api/security/nonce',
  maxDriftMs: 60_000,
});

// Purely volatile in-memory state — NEVER persisted to localStorage or sessionStorage
let memorySigningKey: string | null = null;
let serverClockOffsetMs = 0;

export function setInMemorySigningKey(key: string | null, serverNowMs?: number): void {
  memorySigningKey = key && key.length >= 32 ? key : null;
  if (typeof serverNowMs === 'number' && Number.isFinite(serverNowMs)) {
    serverClockOffsetMs = serverNowMs - Date.now();
  }
}

export function getInMemorySigningKey(): string | null {
  return memorySigningKey;
}

export function getEstimatedServerNowMs(): number {
  return Date.now() + serverClockOffsetMs;
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export async function sha256HexClient(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  let view: Uint8Array;
  if (typeof data === 'string') {
    view = new TextEncoder().encode(data);
  } else if (data instanceof Uint8Array) {
    view = data;
  } else {
    view = new Uint8Array(data);
  }
  const digest = await crypto.subtle.digest('SHA-256', view as unknown as BufferSource);
  return bufferToHex(digest);
}

export async function hmacSha256HexClient(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bufferToHex(sig);
}

async function computeBodyHashClient(body: BodyInit | null | undefined): Promise<string> {
  if (!body) {
    return sha256HexClient('');
  }
  if (typeof body === 'string') {
    return sha256HexClient(body);
  }
  if (body instanceof FormData) {
    const map = new Map<string, FormDataEntryValue[]>();
    body.forEach((value, key) => {
      const list = map.get(key) || [];
      list.push(value);
      map.set(key, list);
    });
    const sortedKeys = Array.from(map.keys()).sort();
    const lines: string[] = [];
    for (const key of sortedKeys) {
      const values = map.get(key) || [];
      for (const val of values) {
        if (val instanceof Blob) {
          const buf = await val.arrayBuffer();
          const h = await sha256HexClient(buf);
          lines.push(`${key}=blob:${h}`);
        } else {
          lines.push(`${key}=str:${String(val)}`);
        }
      }
    }
    return sha256HexClient(lines.join('\n'));
  }
  return sha256HexClient('');
}

async function acquireNonce(method: string, path: string): Promise<{ nonce: string; serverNowMs: number }> {
  const res = await fetch(
    `${SIGNING_CONFIG.nonceEndpoint}?m=${encodeURIComponent(method)}&p=${encodeURIComponent(path)}`,
    { method: 'GET', cache: 'no-store' },
  );
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Không thể cấp mã nonce bảo mật (${res.status}).`);
  }
  const data = (await res.json()) as {
    nonce: string;
    serverNowMs: number;
    signingKey?: string;
  };
  if (data.signingKey) {
    setInMemorySigningKey(data.signingKey, data.serverNowMs);
  }
  if (!data.nonce) {
    throw new Error('Máy chủ không cấp được nonce bảo mật.');
  }
  return { nonce: data.nonce, serverNowMs: data.serverNowMs };
}

export async function signedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://localhost';
  const parsedUrl = new URL(input, origin);
  const canonicalPath = `${parsedUrl.pathname}${parsedUrl.search}`;

  const { nonce, serverNowMs } = await acquireNonce(method, canonicalPath);
  const key = getInMemorySigningKey();
  if (!key) {
    throw new Error('Phiên bảo mật chưa sẵn sàng. Vui lòng đăng nhập lại.');
  }

  const timestamp = String(serverNowMs || getEstimatedServerNowMs());
  const bodyHash = await computeBodyHashClient(init.body);
  const signature = await hmacSha256HexClient(
    key,
    `${method}${canonicalPath}${bodyHash}${timestamp}${nonce}`,
  );

  const headers = new Headers(init.headers);
  headers.set('X-Request-Timestamp', timestamp);
  headers.set('X-Request-Nonce', nonce);
  headers.set('X-Signature', signature);

  return fetch(input, {
    ...init,
    method,
    headers,
    cache: 'no-store',
  });
}
