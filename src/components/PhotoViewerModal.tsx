'use client';

import { useEffect, useRef, useState, type TouchEvent } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Columns2,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ChoreLogItem } from '@/lib/types';
import { formatIsoToVn } from '@/lib/time';

interface PhotoViewerModalProps {
  log: ChoreLogItem | null;
  allLogs?: ChoreLogItem[];
  isAdmin: boolean;
  onSelectLog?: (log: ChoreLogItem) => void;
  onClose: () => void;
  onModerate?: (log: ChoreLogItem, action?: 'reject' | 'rework_half_penalty') => Promise<void>;
  onReact?: (log: ChoreLogItem, reaction: 'ok' | 'sloppy') => Promise<void>;
}

export function PhotoViewerModal({
  log,
  allLogs = [],
  isAdmin,
  onSelectLog,
  onClose,
  onModerate,
  onReact,
}: PhotoViewerModalProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [viewMode, setViewMode] = useState<'after' | 'before' | 'split'>('after');
  const [confirmMode, setConfirmMode] = useState<'none' | 'reject' | 'rework'>('none');
  const [moderating, setModerating] = useState(false);

  const pinchStartDist = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const offsetRef = useRef({ x: 0, y: 0 });

  const currentIndex = log ? allLogs.findIndex((item) => item.id === log.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < allLogs.length - 1;

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    offsetRef.current = { x: 0, y: 0 };
    setViewMode(log?.before_proof_url ? 'split' : 'after');
    setConfirmMode('none');
    setModerating(false);
  }, [log?.id, log?.before_proof_url]);

  // Keyboard navigation: Esc to close, ArrowLeft / ArrowRight to browse photos
  useEffect(() => {
    if (!log) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && hasPrev && onSelectLog) {
        onSelectLog(allLogs[currentIndex - 1]);
      } else if (e.key === 'ArrowRight' && hasNext && onSelectLog) {
        onSelectLog(allLogs[currentIndex + 1]);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [log, hasPrev, hasNext, currentIndex, allLogs, onSelectLog, onClose]);

  if (!log) return null;

  const hasBeforeAfter = Boolean(log.before_proof_url);

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

  async function handleConfirmModerate() {
    if (!log || !onModerate || confirmMode === 'none') return;
    setModerating(true);
    try {
      await onModerate(log, confirmMode === 'rework' ? 'rework_half_penalty' : 'reject');
      onClose();
    } finally {
      setModerating(false);
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/85 md:bg-black/75 md:backdrop-blur-sm flex items-center justify-center md:p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full h-full md:h-auto md:max-h-[90vh] md:max-w-3xl bg-black md:bg-[#0F172A] md:border md:border-[#334155] md:rounded-2xl md:shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Top Bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-white shrink-0">
          <div className="min-w-0 pr-3">
            <p className="text-sm md:text-base font-semibold truncate">{log.chore_title}</p>
            <p className="text-xs text-white/70 tabular-nums truncate">
              {log.member_name} • {formatIsoToVn(log.server_timestamp)}
              {log.points_awarded > 0 ? ` • +${log.points_awarded} điểm` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onSelectLog && allLogs.length > 1 && (
              <>
                <button
                  type="button"
                  disabled={!hasPrev}
                  onClick={() => hasPrev && onSelectLog(allLogs[currentIndex - 1])}
                  aria-label="Ảnh trước đó"
                  className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 flex items-center justify-center"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={() => hasNext && onSelectLog(allLogs[currentIndex + 1])}
                  aria-label="Ảnh tiếp theo"
                  className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 flex items-center justify-center"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng ảnh"
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Before / After Mode Switcher */}
        {hasBeforeAfter && (
          <div className="px-4 pt-2.5 flex items-center justify-center gap-1.5 shrink-0">
            {(
              [
                { key: 'split', label: 'So sánh Trước | Sau' },
                { key: 'before', label: 'Ảnh Trước' },
                { key: 'after', label: 'Ảnh Sau' },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  resetZoom();
                  setViewMode(m.key);
                }}
                className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1 ${
                  viewMode === m.key ? 'bg-[#059669] text-white' : 'bg-white/10 text-white/80'
                }`}
              >
                {m.key === 'split' && <Columns2 className="w-3.5 h-3.5" />}
                {m.label}
              </button>
            ))}
          </div>
        )}

        {/* Pinch / Zoom Image Stage */}
        <div
          className="flex-1 overflow-hidden flex items-center justify-center touch-none select-none p-3 min-h-[260px]"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onDoubleClick={() => (scale > 1 ? resetZoom() : setScale(2.2))}
        >
          {hasBeforeAfter && viewMode === 'split' ? (
            <div
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transition: pinchStartDist.current ? 'none' : 'transform 150ms ease-out',
              }}
              className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-h-full overflow-y-auto"
            >
              <div className="relative rounded-xl overflow-hidden border border-amber-500/50 bg-black flex items-center justify-center">
                <span className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded bg-amber-600 text-white text-[10px] font-bold">
                  TRƯỚC KHI LÀM
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={log.before_proof_url || ''}
                  alt="Ảnh trước khi làm"
                  className="w-full max-h-[34vh] md:max-h-[55vh] object-contain mx-auto"
                />
              </div>
              <div className="relative rounded-xl overflow-hidden border border-emerald-500/50 bg-black flex items-center justify-center">
                <span className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">
                  SAU KHI LÀM
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={log.proof_url}
                  alt="Ảnh sau khi làm"
                  className="w-full max-h-[34vh] md:max-h-[55vh] object-contain mx-auto"
                />
              </div>
            </div>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={
                viewMode === 'before' && log.before_proof_url
                  ? log.before_proof_url
                  : log.proof_url
              }
              alt={`Ảnh xác thực ${log.chore_title}`}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transition: pinchStartDist.current ? 'none' : 'transform 150ms ease-out',
              }}
              className="max-h-[60vh] md:max-h-[62vh] max-w-full object-contain rounded-lg"
            />
          )}
        </div>

        {/* Bottom Controls */}
        <div className="px-4 py-3 border-t border-white/10 bg-black/80 space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setScale((s) => Math.max(1, Number((s - 0.5).toFixed(1))))}
                className="h-10 px-2.5 rounded-xl bg-white/10 text-white flex items-center text-xs"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs text-white/80 tabular-nums px-1">{scale.toFixed(1)}x</span>
              <button
                type="button"
                onClick={() => setScale((s) => Math.min(3.5, Number((s + 0.5).toFixed(1))))}
                className="h-10 px-2.5 rounded-xl bg-white/10 text-white flex items-center text-xs"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              {scale > 1 && (
                <button
                  type="button"
                  onClick={resetZoom}
                  className="h-10 px-2.5 rounded-xl bg-white/10 text-white flex items-center text-xs"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              <span className="hidden md:inline text-[11px] text-white/50 ml-2">
                Esc để đóng • ← → để chuyển ảnh
              </span>
            </div>

            {onReact && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onReact(log, 'ok')}
                  className={`h-10 px-3 rounded-xl text-xs font-semibold flex items-center gap-1 ${
                    log.my_reaction === 'ok' ? 'bg-[#059669] text-white' : 'bg-white/10 text-white'
                  }`}
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                  Đạt chuẩn{log.ok_count > 0 ? ` (${log.ok_count})` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => onReact(log, 'sloppy')}
                  className={`h-10 px-3 rounded-xl text-xs font-semibold flex items-center gap-1 ${
                    log.my_reaction === 'sloppy'
                      ? 'bg-[#D97706] text-white'
                      : 'bg-white/10 text-white'
                  }`}
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                  Báo làm ẩu{log.sloppy_count > 0 ? ` (${log.sloppy_count})` : ''}
                </button>
              </div>
            )}
          </div>

          {isAdmin && onModerate && confirmMode === 'none' && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConfirmMode('rework')}
                className="h-11 px-3 rounded-xl bg-[#D97706] text-white text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Làm lại / Phạt 50%
              </button>
              <button
                type="button"
                onClick={() => setConfirmMode('reject')}
                className="h-11 px-3 rounded-xl bg-[#DC2626] text-white text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Từ chối / Hủy lượt
              </button>
            </div>
          )}

          {confirmMode !== 'none' && (
            <div className="rounded-xl bg-[#450A0A] border border-[#991B1B] p-3 flex items-center justify-between gap-2">
              <p className="text-xs text-[#FECACA]">
                {confirmMode === 'rework'
                  ? 'Phạt 50% quỹ & mở lại việc bắt làm lại?'
                  : 'Xóa ảnh, trừ điểm & hoàn tác trạng thái?'}
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmMode('none')}
                  className="h-10 px-3 rounded-lg bg-white/10 text-white text-xs font-medium"
                >
                  Không
                </button>
                <button
                  type="button"
                  disabled={moderating}
                  onClick={handleConfirmModerate}
                  className="h-10 px-3 rounded-lg bg-[#DC2626] text-white text-xs font-semibold"
                >
                  {moderating ? 'Đang xử lý...' : 'Xác nhận'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
