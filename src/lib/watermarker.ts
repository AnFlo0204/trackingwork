export interface WatermarkedPhotoResult {
  blob: Blob;
  previewUrl: string;
  sizeBytes: number;
  mimeType: 'image/webp' | 'image/jpeg';
}

const MAX_BYTES = 180 * 1024; // <= 180KB per spec

async function loadImageSource(fileOrBlob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
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
) {
  const barHeight = Math.max(66, Math.round(height * 0.12));
  const yStart = height - barHeight;

  // High-contrast dark telemetry bar
  ctx.fillStyle = 'rgba(17, 24, 39, 0.88)';
  ctx.fillRect(0, yStart, width, barHeight);

  // Crisp top accent hairline
  ctx.fillStyle = '#059669';
  ctx.fillRect(0, yStart, width, Math.max(2, Math.round(barHeight * 0.04)));

  const padX = Math.max(14, Math.round(width * 0.025));
  const fontPrimary = Math.max(12, Math.min(20, Math.round(barHeight * 0.25)));
  const fontSecondary = Math.max(11, Math.min(18, Math.round(barHeight * 0.22)));

  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#F9FAFB';
  ctx.font = `600 ${fontPrimary}px Inter, system-ui, -apple-system, sans-serif`;
  const line1 = `NGƯỜI LÀM: ${memberName} | VIỆC: ${choreTitle}`;
  ctx.fillText(line1, padX, yStart + barHeight * 0.34, width - padX * 2);

  ctx.fillStyle = '#34D399';
  ctx.font = `500 ${fontSecondary}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const line2 = `THỜI GIAN THỰC: ${serverTimeFormatted} (Verified)`;
  ctx.fillText(line2, padX, yStart + barHeight * 0.72, width - padX * 2);
}

/**
 * Burns the authoritative server watermark onto a live camera photo and compresses to WebP/JPEG <= 180KB.
 */
export async function createWatermarkedProof(
  fileOrBlob: Blob,
  opts: {
    memberName: string;
    choreTitle: string;
    serverTimeFormatted: string;
  },
): Promise<WatermarkedPhotoResult> {
  const { source, width: origW, height: origH, cleanup } = await loadImageSource(fileOrBlob);

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
      );

      for (const quality of qualitySteps) {
        let blob = await canvasToBlob(canvas, 'image/webp', quality);
        let mime: 'image/webp' | 'image/jpeg' = 'image/webp';

        // Some mobile Safari builds fall back to image/png when webp is unsupported
        if (!blob || blob.type !== 'image/webp') {
          blob = await canvasToBlob(canvas, 'image/jpeg', quality);
          mime = 'image/jpeg';
        }

        if (blob) {
          bestBlob = blob;
          bestMime = mime;
          if (blob.size <= MAX_BYTES) {
            return {
              blob,
              previewUrl: URL.createObjectURL(blob),
              sizeBytes: blob.size,
              mimeType: mime,
            };
          }
        }
      }
    }

    if (!bestBlob) {
      throw new Error('Không thể nén ảnh xác thực');
    }

    return {
      blob: bestBlob,
      previewUrl: URL.createObjectURL(bestBlob),
      sizeBytes: bestBlob.size,
      mimeType: bestMime,
    };
  } finally {
    cleanup();
  }
}
