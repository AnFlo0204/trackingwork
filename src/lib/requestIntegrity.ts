import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { recordAuditLog } from './audit';
import type { AuthenticatedSession } from './auth';
import { getSupabaseAdmin } from './supabaseAdmin';

const MAX_TIMESTAMP_DRIFT_MS = 60_000; // 60 seconds
const MUTATION_RATE_LIMIT_PER_MIN = 30;
const MAX_PROOF_BYTES = 300 * 1024;

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function hmacSha256Hex(secret: string, message: string): string {
  return crypto.createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

async function computeCanonicalBodyHash(req: Request): Promise<{
  bodyHash: string;
  rawText: string;
  formData: FormData | null;
}> {
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('multipart/form-data')) {
    const fd = await req.formData();
    const map = new Map<string, FormDataEntryValue[]>();
    fd.forEach((value, key) => {
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
          const buf = Buffer.from(await val.arrayBuffer());
          lines.push(`${key}=blob:${sha256Hex(buf)}`);
        } else {
          lines.push(`${key}=str:${String(val)}`);
        }
      }
    }
    return {
      bodyHash: sha256Hex(lines.join('\n')),
      rawText: '',
      formData: fd,
    };
  }

  const rawText = await req.text();
  return {
    bodyHash: sha256Hex(rawText || ''),
    rawText,
    formData: null,
  };
}

export type VerifiedRequestResult =
  | {
      ok: true;
      rawText: string;
      formData: FormData | null;
      nonce: string;
    }
  | {
      ok: false;
      response: NextResponse;
    };

async function rejectAndAudit(
  actorName: string,
  refId: string,
  reason: string,
  method: string,
  path: string,
  status = 403,
): Promise<VerifiedRequestResult> {
  await recordAuditLog({
    actorName,
    actionType: 'HMAC_SPOOF_ATTEMPT',
    targetSummary: `Từ chối request giả mạo/không hợp lệ [${method} ${path}]: ${reason}`,
    refId,
  });
  return {
    ok: false,
    response: NextResponse.json({ error: `Yêu cầu bị từ chối: ${reason}` }, { status }),
  };
}

export async function verifySignedRequest(
  req: Request,
  session: AuthenticatedSession,
): Promise<VerifiedRequestResult> {
  const url = new URL(req.url);
  const path = `${url.pathname}${url.search}`;
  const method = req.method.toUpperCase();

  const tsHeader = (req.headers.get('x-request-timestamp') || '').trim();
  const nonceHeader = (req.headers.get('x-request-nonce') || '').trim();
  const sigHeader = (req.headers.get('x-signature') || '').trim();

  if (!tsHeader || !nonceHeader || !sigHeader) {
    return rejectAndAudit(
      session.profile.display_name,
      session.profile.id,
      'Thiếu chữ ký X-Signature, X-Request-Nonce hoặc X-Request-Timestamp',
      method,
      path,
    );
  }

  const tsMs = Number(tsHeader);
  const nowMs = Date.now();
  if (!Number.isFinite(tsMs) || Math.abs(nowMs - tsMs) > MAX_TIMESTAMP_DRIFT_MS) {
    return rejectAndAudit(
      session.profile.display_name,
      session.profile.id,
      'Timestamp request đã hết hạn (> 60s)',
      method,
      path,
    );
  }

  const supabase = getSupabaseAdmin();

  // Enforce 30 mutations/minute sliding window per session/profile globally
  const oneMinuteAgoIso = new Date(nowMs - 60_000).toISOString();
  const { count: recentCount } = await supabase
    .from('used_nonces')
    .select('nonce', { count: 'exact', head: true })
    .eq('profile_id', session.profile.id)
    .gte('created_at', oneMinuteAgoIso);

  if ((recentCount || 0) > MUTATION_RATE_LIMIT_PER_MIN + 2) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Thao tác quá nhanh (vượt giới hạn 30 yêu cầu/phút). Vui lòng thử lại sau ít giây.' },
        { status: 429 },
      ),
    };
  }

  // Consume single-use cryptographic nonce atomically
  const nowIso = new Date(nowMs).toISOString();
  const { data: consumedNonce } = await supabase
    .from('used_nonces')
    .update({ used_at: nowIso })
    .eq('nonce', nonceHeader)
    .eq('profile_id', session.profile.id)
    .is('used_at', null)
    .gte('expires_at', nowIso)
    .select('nonce')
    .maybeSingle();

  if (!consumedNonce) {
    return rejectAndAudit(
      session.profile.display_name,
      session.profile.id,
      'Nonce không tồn tại, đã sử dụng (replay) hoặc hết hạn (2 phút)',
      method,
      path,
    );
  }

  const { bodyHash, rawText, formData } = await computeCanonicalBodyHash(req);
  const expectedSig = hmacSha256Hex(
    session.signingKey,
    `${method}${path}${bodyHash}${tsHeader}${nonceHeader}`,
  );

  const providedBuf = Buffer.from(sigHeader.toLowerCase(), 'utf8');
  const expectedBuf = Buffer.from(expectedSig.toLowerCase(), 'utf8');
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return rejectAndAudit(
      session.profile.display_name,
      session.profile.id,
      'Chữ ký HMAC-SHA256 không khớp',
      method,
      path,
    );
  }

  return {
    ok: true,
    rawText,
    formData,
    nonce: nonceHeader,
  };
}

export function extractAndVerifyProofBinary(
  buffer: Buffer,
  claimedMime: string,
  expected: {
    userId: string;
    choreId: string;
    signingKey: string;
  },
): { ok: true; serverTimestamp: string } | { ok: false; reason: string } {
  if (buffer.length === 0 || buffer.length > MAX_PROOF_BYTES) {
    return { ok: false, reason: 'Dung lượng ảnh không hợp lệ (tối đa 300KB)' };
  }

  let embeddedText = '';
  let strippedBuffer: Buffer | null = null;

  if (claimedMime === 'image/webp') {
    if (
      buffer.length < 24 ||
      buffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
      buffer.subarray(8, 12).toString('ascii') !== 'WEBP'
    ) {
      return { ok: false, reason: 'Magic bytes WebP (RIFF/WEBP) không hợp lệ' };
    }

    const riffDeclaredSize = buffer.readUInt32LE(4);
    if (riffDeclaredSize !== buffer.length - 8) {
      return { ok: false, reason: 'Cấu trúc RIFF WebP bị chỉnh sửa' };
    }

    let offset = 12;
    let foundStart = -1;
    let foundEnd = -1;
    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.subarray(offset, offset + 4).toString('ascii');
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const paddedSize = chunkSize + (chunkSize % 2);
      const chunkEnd = offset + 8 + paddedSize;
      if (chunkEnd > buffer.length) {
        return { ok: false, reason: 'Chunk RIFF WebP bị hỏng' };
      }
      if (chunkId === 'TWST') {
        embeddedText = buffer.subarray(offset + 8, offset + 8 + chunkSize).toString('utf8');
        foundStart = offset;
        foundEnd = chunkEnd;
        break;
      }
      offset = chunkEnd;
    }

    if (foundStart < 0) {
      return { ok: false, reason: 'Thiếu chữ ký nhúng từ Canvas xác thực WebP' };
    }

    strippedBuffer = Buffer.concat([buffer.subarray(0, foundStart), buffer.subarray(foundEnd)]);
    strippedBuffer.writeUInt32LE(strippedBuffer.length - 8, 4);
  } else if (claimedMime === 'image/jpeg') {
    if (buffer.length < 16 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      return { ok: false, reason: 'Magic bytes JPEG (FF D8 FF) không hợp lệ' };
    }

    if (buffer[2] === 0xff && buffer[3] === 0xfe) {
      const segLen = buffer.readUInt16BE(4);
      const segEnd = 4 + segLen;
      if (segLen >= 2 && segEnd <= buffer.length) {
        embeddedText = buffer.subarray(6, segEnd).toString('utf8');
        strippedBuffer = Buffer.concat([buffer.subarray(0, 2), buffer.subarray(segEnd)]);
      }
    }

    if (!strippedBuffer || !embeddedText) {
      return { ok: false, reason: 'Thiếu chữ ký nhúng từ Canvas xác thực JPEG' };
    }
  } else {
    return { ok: false, reason: 'Định dạng MIME không được hỗ trợ' };
  }

  // Format: TWST1|<userId>|<choreId>|<nonce>|<serverTimestamp>|<hmacTag>
  const parts = embeddedText.split('|');
  if (parts.length !== 6 || parts[0] !== 'TWST1') {
    return { ok: false, reason: 'Định dạng chữ ký nhúng không hợp lệ' };
  }

  const [, userId, choreId, nonce, serverTimestamp, hmacTag] = parts;
  if (userId !== expected.userId || choreId !== expected.choreId || !nonce || !serverTimestamp) {
    return { ok: false, reason: 'Chữ ký ảnh không khớp thành viên hoặc đầu việc hiện tại' };
  }

  const pixelBlobHash = sha256Hex(strippedBuffer);
  const expectedTag = hmacSha256Hex(
    expected.signingKey,
    `${userId}|${choreId}|${nonce}|${serverTimestamp}|${pixelBlobHash}`,
  );

  const tagBuf = Buffer.from(hmacTag.toLowerCase(), 'utf8');
  const expBuf = Buffer.from(expectedTag.toLowerCase(), 'utf8');
  if (tagBuf.length !== expBuf.length || !crypto.timingSafeEqual(tagBuf, expBuf)) {
    return { ok: false, reason: 'Chữ ký mật mã trong ảnh (Canvas stego/HMAC) đã bị giả mạo' };
  }

  return { ok: true, serverTimestamp };
}
