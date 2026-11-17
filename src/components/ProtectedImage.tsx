'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

interface ProtectedImageProps {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  objectFit?: 'cover' | 'contain';
  onClick?: () => void;
}

export function ProtectedImage({
  src,
  alt,
  className = '',
  style,
  objectFit = 'cover',
  onClick,
}: ProtectedImageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [fallbackBg, setFallbackBg] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCanvasReady(false);
    setFallbackBg(false);

    if (!src) return;

    const img = new Image();
    // Same-origin / blob URLs or Supabase Storage with CORS support
    if (!src.startsWith('blob:') && !src.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) {
        setFallbackBg(true);
        return;
      }

      const w = img.naturalWidth || 640;
      const h = img.naturalHeight || 480;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setFallbackBg(true);
        return;
      }

      try {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        setCanvasReady(true);
      } catch {
        setFallbackBg(true);
      }
    };

    img.onerror = () => {
      if (!cancelled) {
        setFallbackBg(true);
      }
    };

    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  const fitClass = objectFit === 'contain' ? 'object-contain' : 'object-cover';

  return (
    <div
      role="img"
      aria-label={alt}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      style={style}
      className={`relative overflow-hidden select-none ${className}`}
    >
      {fallbackBg ? (
        <div
          aria-hidden="true"
          className="w-full h-full bg-center bg-no-repeat"
          style={{
            backgroundImage: `url("${src.replace(/"/g, '%22')}")`,
            backgroundSize: objectFit === 'contain' ? 'contain' : 'cover',
          }}
        />
      ) : (
        <canvas
          ref={canvasRef}
          className={`w-full h-full ${fitClass} block pointer-events-none select-none transition-opacity duration-150 ${
            canvasReady ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {/* Transparent pointer barrier to prevent right-click Save As / drag extraction */}
      <div
        aria-hidden="true"
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
        className="absolute inset-0 z-10 bg-transparent select-none"
      />
    </div>
  );
}
