export async function compressAvatarSquareWebp(file: File): Promise<{ blob: Blob; mime: string }> {
  const bitmap = await createImageBitmap(file);
  const size = 160;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Không thể khởi tạo canvas xử lý ảnh đại diện.');
  }

  const minSide = Math.min(bitmap.width, bitmap.height);
  const sx = Math.floor((bitmap.width - minSide) / 2);
  const sy = Math.floor((bitmap.height - minSide) / 2);
  ctx.drawImage(bitmap, sx, sy, minSide, minSide, 0, 0, size, size);
  bitmap.close();

  const encode = (mime: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), mime, quality));

  for (const q of [0.82, 0.7, 0.56, 0.42]) {
    const b = await encode('image/webp', q);
    if (b && b.type === 'image/webp' && b.size <= 40 * 1024) {
      return { blob: b, mime: 'image/webp' };
    }
  }

  const fallback = (await encode('image/jpeg', 0.72)) || (await encode('image/webp', 0.4));
  if (!fallback) {
    throw new Error('Không thể nén ảnh đại diện.');
  }
  return { blob: fallback, mime: fallback.type || 'image/jpeg' };
}
