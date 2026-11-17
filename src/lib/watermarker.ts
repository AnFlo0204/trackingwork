'use client';

import {
  getInMemorySigningKey,
  hmacSha256HexClient,
  sha256HexClient,
} from './requestSigner';

export interface WatermarkedPhotoResult {
  blob: Blob;
  thumbBlob: Blob | null;
  previewUrl: string;
  sizeBytes: number;
  mimeType: 'image/webp' | 'image/jpeg';
}

const MAX_BYTES = 180 * 1024 - 512; // <= 180KB with headroom for stego signature chunk

async function loadImageSource(
  fileOrBlob: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(fileOrBlob);
      return {
        source: bmp,
        width: bmp.width,
        height: bmp.height,
        cleanup: () => bmp.close(),
      };
    } catch {
      // Fall back to HTMLImageElement
    }
  }

  const objectUrl = URL.createObjectURL(fileOrBlob);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Không thể đọc ảnh từ camera'));
    el.src = objectUrl;
  });
  return {
    source: img,
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
    cleanup: () => URL.revokeObjectURL(objectUrl),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

function drawTelemetryBar(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  memberName: string,
  choreTitle: string,
  serverTimeFormatted: string,
  phase: 'before' | 'after' | 'single',
) {
  const barHeight = Math.max(66, Math.round(height * 0.12));
  const yStart = height - barHeight;

  ctx.fillStyle = 'rgba(17, 24, 39, 0.88)';
  ctx.fillRect(0, yStart, width, barHeight);

  ctx.fillStyle = phase === 'before' ? '#D97706' : '#059669';
  ctx.fillRect(0, yStart, width, Math.max(3, Math.round(barHeight * 0.05)));

  const padX = Math.max(14, Math.round(width * 0.025));
  const fontPrimary = Math.max(12, Math.min(20, Math.round(barHeight * 0.25)));
  const fontSecondary = Math.max(11, Math.min(18, Math.round(barHeight * 0.22)));

  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#F9FAFB';
  ctx.font = `600 ${fontPrimary}px Inter, system-ui, -apple-system, sans-serif`;
  const line1 = `NGƯỜI LÀM: ${memberName} | VIỆC: ${choreTitle}`;
  ctx.fillText(line1, padX, yStart + barHeight * 0.34, width - padX * 2);

  ctx.fillStyle = phase === 'before' ? '#FBBF24' : '#34D399';
  ctx.font = `500 ${fontSecondary}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const prefix =
    phase === 'before'
      ? 'TRƯỚC KHI LÀM'
      : phase === 'after'
        ? 'SAU KHI LÀM'
        : 'THỜI GIAN THỰC';
  const line2 = `${prefix}: ${serverTimeFormatted} (Verified)`;
  ctx.fillText(line2, padX, yStart + barHeight * 0.72, width - padX * 2);
}

/**
 * Embeds an invisible LSB pixel steganography watermark `[userId|choreId|nonce|serverTimestamp]`
 * into RGB channels of canvas pixels without visible artifacts.
 */
function embedLsbPixelSteganography(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  signaturePayload: string,
): void {
  const utf8 = new TextEncoder().encode(`TW01|${signaturePayload}`);
  const headerAndPayload = new Uint8Array(2 + utf8.length);
  headerAndPayload[0] = (utf8.length >> 8) & 0xff;
  headerAndPayload[1] = utf8.length & 0xff;
  headerAndPayload.set(utf8, 2);

  const totalBits = headerAndPayload.length * 8;
  const maxAvailableBits = width * height * 3;
  if (totalBits > maxAvailableBits) return;

  const rowsNeeded = Math.min(height, Math.ceil(totalBits / (width * 3)) + 1);
  const imgData = ctx.getImageData(0, 0, width, rowsNeeded);
  const data = imgData.data;

  let bitIdx = 0;
  for (let i = 0; i < data.length && bitIdx < totalBits; i += 4) {
    for (let ch = 0; ch < 3 && bitIdx < totalBits; ch += 1) {
      const bytePos = bitIdx >> 3;
      const bitPos = 7 - (bitIdx & 7);
      const bit = (headerAndPayload[bytePos] >> bitPos) & 1;
      data[i + ch] = (data[i + ch] & 0xfe) | bit;
      bitIdx += 1;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

/**
 * Embeds a verifiable container signature chunk into WebP (RIFF TWST) or JPEG (COM FF FE)
 * bound cryptographically to the pixel container bytes + sessionSigningKey.
 */
async function attachContainerSignature(
  blob: Blob,
  mime: 'image/webp' | 'image/jpeg',
  meta: {
    userId: string;
    choreId: string;
    nonce: string;
    serverTimestamp: string;
  },
): Promise<Blob> {
  const signingKey = getInMemorySigningKey();
  if (!signingKey) {
    throw new Error('Không tìm thấy khóa ký phiên để xác thực ảnh.');
  }

  const rawBytes = new Uint8Array(await blob.arrayBuffer());
  const pixelBlobHash = await sha256HexClient(rawBytes);
  const baseStr = `${meta.userId}|${meta.choreId}|${meta.nonce}|${meta.serverTimestamp}`;
  const hmacTag = await hmacSha256HexClient(signingKey, `${baseStr}|${pixelBlobHash}`);
  const payloadStr = `TWST1|${baseStr}|${hmacTag}`;
  const payloadBytes = new TextEncoder().encode(payloadStr);

  if (mime === 'image/webp') {
    const pad = payloadBytes.length % 2;
    const chunkTotal = 8 + payloadBytes.length + pad;
    const out = new Uint8Array(rawBytes.length + chunkTotal);
    out.set(rawBytes, 0);

    // Update RIFF chunk size (bytes 4..7 little-endian)
    const totalMinusHeader = out.length - 8;
    out[4] = totalMinusHeader & 0xff;
    out[5] = (totalMinusHeader >> 8) & 0xff;
    out[6] = (totalMinusHeader >> 16) & 0xff;
    out[7] = (totalMinusHeader >> 24) & 0xff;

    let p = rawBytes.length;
    out[p++] = 84; // 'T'
    out[p++] = 87; // 'W'
    out[p++] = 83; // 'S'
    out[p++] = 84; // 'T'
    out[p++] = payloadBytes.length & 0xff;
    out[p++] = (payloadBytes.length >> 8) & 0xff;
    out[p++] = (payloadBytes.length >> 16) & 0xff;
    out[p++] = (payloadBytes.length >> 24) & 0xff;
    out.set(payloadBytes, p);
    if (pad) {
      out[p + payloadBytes.length] = 0;
    }

    return new Blob([out], { type: 'image/webp' });
  }

  // JPEG: insert COM segment (0xFF 0xFE) immediately after SOI (0xFF 0xD8)
  const segLen = payloadBytes.length + 2;
  const out = new Uint8Array(rawBytes.length + 4 + payloadBytes.length);
  out[0] = rawBytes[0]; // 0xFF
  out[1] = rawBytes[1]; // 0xD8
  out[2] = 0xff;
  out[3] = 0xfe;
  out[4] = (segLen >> 8) & 0xff;
  out[5] = segLen & 0xff;
  out.set(payloadBytes, 6);
  out.set(rawBytes.subarray(2), 6 + payloadBytes.length);

  return new Blob([out], { type: 'image/jpeg' });
}

async function createLowResThumb(
  source: CanvasImageSource,
  origW: number,
  origH: number,
  preferredMime: 'image/webp' | 'image/jpeg',
): Promise<Blob | null> {
  const scale = Math.min(1, 200 / Math.max(origW, origH));
  const w = Math.max(80, Math.round(origW * scale));
  const h = Math.max(60, Math.round(origH * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  let thumb = await canvasToBlob(c, preferredMime, 0.6);
  if (!thumb || (preferredMime === 'image/webp' && thumb.type !== 'image/webp')) {
    thumb = await canvasToBlob(c, 'image/jpeg', 0.6);
  }
  return thumb;
}

/**
 * Burns the authoritative server watermark + invisible LSB pixel steganography onto a live camera photo,
 * attaches a cryptographic HMAC binary signature chunk, and compresses to WebP/JPEG <= 180KB.
 */
export async function createWatermarkedProof(
  fileOrBlob: Blob,
  opts: {
    userId: string;
    choreId: string;
    nonce: string;
    memberName: string;
    choreTitle: string;
    serverTimeFormatted: string;
    serverIsoTimestamp: string;
    phase?: 'before' | 'after' | 'single';
  },
): Promise<WatermarkedPhotoResult> {
  const { source, width: origW, height: origH, cleanup } = await loadImageSource(fileOrBlob);
  const phase = opts.phase ?? 'single';
  const stegoPayload = `${opts.userId}|${opts.choreId}|${opts.nonce}|${opts.serverIsoTimestamp}`;

  try {
    const dimensionCaps = [1280, 1024, 840, 680];
    const qualitySteps = [0.82, 0.72, 0.6, 0.48, 0.38];

    let bestBlob: Blob | null = null;
    let bestMime: 'image/webp' | 'image/jpeg' = 'image/webp';

    for (const maxDim of dimensionCaps) {
      const scale = Math.min(1, maxDim / Math.max(origW, origH));
      const targetW = Math.max(320, Math.round(origW * scale));
      const targetH = Math.max(240, Math.round(origH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Trình duyệt không hỗ trợ Canvas 2D');

      ctx.drawImage(source, 0, 0, targetW, targetH);
      drawTelemetryBar(
        ctx,
        targetW,
        targetH,
        opts.memberName,
        opts.choreTitle,
        opts.serverTimeFormatted,
        phase,
      );

      // Invisible LSB pixel steganography watermark `[userId|choreId|nonce|serverTimestamp]`
      embedLsbPixelSteganography(ctx, targetW, targetH, stegoPayload);

      for (const quality of qualitySteps) {
        let blob = await canvasToBlob(canvas, 'image/webp', quality);
        let mime: 'image/webp' | 'image/jpeg' = 'image/webp';

        if (!blob || blob.type !== 'image/webp') {
          blob = await canvasToBlob(canvas, 'image/jpeg', quality);
          mime = 'image/jpeg';
        }

        if (blob) {
          bestBlob = blob;
          bestMime = mime;
          if (blob.size <= MAX_BYTES) {
            const signedBlob = await attachContainerSignature(blob, mime, {
              userId: opts.userId,
              choreId: opts.choreId,
              nonce: opts.nonce,
              serverTimestamp: opts.serverIsoTimestamp,
            });
            const thumbBlob = await createLowResThumb(source, origW, origH, mime);
            return {
              blob: signedBlob,
              thumbBlob,
              previewUrl: URL.createObjectURL(signedBlob),
              sizeBytes: signedBlob.size,
              mimeType: mime,
            };
          }
        }
      }
    }

    if (!bestBlob) {
      throw new Error('Không thể nén ảnh xác thực');
    }

    const signedBestBlob = await attachContainerSignature(bestBlob, bestMime, {
      userId: opts.userId,
      choreId: opts.choreId,
      nonce: opts.nonce,
      serverTimestamp: opts.serverIsoTimestamp,
    });
    const thumbBlob = await createLowResThumb(source, origW, origH, bestMime);
    return {
      blob: signedBestBlob,
      thumbBlob,
      previewUrl: URL.createObjectURL(signedBestBlob),
      sizeBytes: signedBestBlob.size,
      mimeType: bestMime,
    };
  } finally {
    cleanup();
  }
}
