'use client';

import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { RotateCcw, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { ChoreLogItem } from '@/lib/types';
import { formatIsoToVn } from '@/lib/time';

interface PhotoViewerModalProps {
  log: ChoreLogItem | null;
  isAdmin: boolean;
  onClose: () => void;
  onModerate?: (log: ChoreLogItem) => Promise<void>;
}

export function PhotoViewerModal({ log, isAdmin, onClose, onModerate }: PhotoViewerModalProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [confirmReject, setConfirmReject] = useState(false);
  const [moderating, setModerating] = useState(false);

  const pinchStartDist = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const offsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    offsetRef.current = { x: 0, y: 0 };
    setConfirmReject(false);
    setModerating(false);
  }, [log?.id]);

  if (!log) return null;

  function handleTouchStart(e: TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist.current = Math.hypot(dx, dy);
      pinchStartScale.current = scale;
      panStart.current = null;
    } else if (e.touches.length === 1 && scale > 1) {
      panStart.current = {
        x: e.touches[0].clientX - offsetRef.current.x,
        y: e.touches[0].clientY - offsetRef.current.y,
      };
    }
  }

  function handleTouchMove(e: TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 2 && pinchStartDist.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const next = Math.min(3.5, Math.max(1, pinchStartScale.current * (dist / pinchStartDist.current)));
      setScale(next);
      if (next === 1) {
        setOffset({ x: 0, y: 0 });
        offsetRef.current = { x: 0, y: 0 };
      }
    } else if (e.touches.length === 1 && panStart.current && scale > 1) {
      const nextX = e.touches[0].clientX - panStart.current.x;
      const nextY = e.touches[0].clientY - panStart.current.y;
      const clamped = {
        x: Math.max(-180, Math.min(180, nextX)),
        y: Math.max(-220, Math.min(220, nextY)),
      };
      offsetRef.current = clamped;
      setOffset(clamped);
    }
  }

  function handleTouchEnd() {
    pinchStartDist.current = null;
    panStart.current = null;
  }

  function resetZoom() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    offsetRef.current = { x: 0, y: 0 };
  }

  async function handleRejectConfirm() {
    if (!log || !onModerate) return;
    setModerating(true);
    try {
      await onModerate(log);
      onClose();
    } finally {
      setModerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col max-w-[430px] mx-auto">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-white">
        <div className="min-w-0 pr-3">
          <p className="text-sm font-semibold truncate">{log.chore_title}</p>
          <p className="text-xs text-white/70 tabular-nums truncate">
            {log.member_name} • {formatIsoToVn(log.server_timestamp)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng ảnh"
          className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Pinch / Zoom Image Stage */}
      <div
        className="flex-1 overflow-hidden flex items-center justify-center touch-none select-none p-2"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={() => (scale > 1 ? resetZoom() : setScale(2.2))}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={log.proof_url}
          alt={`Ảnh xác thực ${log.chore_title}`}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: pinchStartDist.current ? 'none' : 'transform 150ms ease-out',
          }}
          className="max-h-full max-w-full object-contain rounded-lg"
        />
      </div>

      {/* Bottom Controls */}
      <div className="px-4 py-3 border-t border-white/10 bg-black/80 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(1, Number((s - 0.5).toFixed(1))))}
              className="h-11 px-3 rounded-xl bg-white/10 text-white flex items-center gap-1 text-xs font-medium"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs text-white/80 tabular-nums px-1.5">{scale.toFixed(1)}x</span>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(3.5, Number((s + 0.5).toFixed(1))))}
              className="h-11 px-3 rounded-xl bg-white/10 text-white flex items-center gap-1 text-xs font-medium"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            {scale > 1 && (
              <button
                type="button"
                onClick={resetZoom}
                className="h-11 px-3 rounded-xl bg-white/10 text-white flex items-center gap-1 text-xs font-medium"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {isAdmin && onModerate && !confirmReject && (
            <button
              type="button"
              onClick={() => setConfirmReject(true)}
              className="h-11 px-4 rounded-xl bg-[#DC2626] text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              Từ chối / Hủy lượt
            </button>
          )}
        </div>

        {confirmReject && (
          <div className="rounded-xl bg-[#450A0A] border border-[#991B1B] p-3 flex items-center justify-between gap-2">
            <p className="text-xs text-[#FECACA]">
              Xóa ảnh, trừ điểm & hoàn tác trạng thái?
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmReject(false)}
                className="h-10 px-3 rounded-lg bg-white/10 text-white text-xs font-medium"
              >
                Không
              </button>
              <button
                type="button"
                disabled={moderating}
                onClick={handleRejectConfirm}
                className="h-10 px-3 rounded-lg bg-[#DC2626] text-white text-xs font-semibold"
              >
                {moderating ? 'Đang hủy...' : 'Xác nhận hủy'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
