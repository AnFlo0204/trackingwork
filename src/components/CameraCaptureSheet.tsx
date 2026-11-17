'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera, Check, RefreshCw, ShieldCheck, Video, WifiOff, X } from 'lucide-react';
import type { AssignedChoreItem, Chore } from '@/lib/types';
import { enqueueOfflineProof, haptic } from '@/lib/offlineQueue';
import { createWatermarkedProof, type WatermarkedPhotoResult } from '@/lib/watermarker';

export interface CaptureTarget {
  chore: Chore;
  assignedChore?: AssignedChoreItem | null;
  phase: 'before' | 'after' | 'single';
  sessionId?: string | null;
}

interface CameraCaptureSheetProps {
  target: CaptureTarget | null;
  memberName: string;
  onClose: () => void;
  onCompleted: (offlineSaved?: boolean) => Promise<void>;
}

export function CameraCaptureSheet({
  target,
  memberName,
  onClose,
  onCompleted,
}: CameraCaptureSheetProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [mode, setMode] = useState<'idle' | 'webrtc' | 'processing' | 'preview'>('idle');
  const [watermarked, setWatermarked] = useState<WatermarkedPhotoResult | null>(null);
  const [uploadToken, setUploadToken] = useState<string | null>(null);
  const [serverStamp, setServerStamp] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chore = target?.chore ?? null;
  const assigned = target?.assignedChore ?? null;
  const phase = target?.phase ?? 'single';
  const sessionId = target?.sessionId ?? null;

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  useEffect(() => {
    setMode('idle');
    setError(null);
    setSubmitting(false);
    setUploadToken(null);
    if (watermarked?.previewUrl) {
      URL.revokeObjectURL(watermarked.previewUrl);
    }
    setWatermarked(null);
    stopStream();

    return () => {
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chore?.id, assigned?.id, phase, sessionId]);

  useEffect(() => {
    if (mode === 'webrtc' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [mode]);

  if (!chore) return null;

  function formatLocalFallbackVn(): string {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
  }

  async function processCapturedBlob(blob: Blob) {
    if (!chore) return;
    setMode('processing');
    setError(null);
    stopStream();
    haptic(15);

    try {
      let vnFormatted = formatLocalFallbackVn();
      let token: string | null = null;

      try {
        const tokRes = await fetch('/api/upload-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ choreId: chore.id, phase }),
        });
        if (tokRes.ok) {
          const tokData = await tokRes.json();
          if (tokData?.vnFormatted) vnFormatted = tokData.vnFormatted;
          if (tokData?.token) token = tokData.token;
        }
      } catch {
        // Offline fallback uses device clock locally until queue syncs
      }

      setUploadToken(token);
      setServerStamp(vnFormatted);

      const result = await createWatermarkedProof(blob, {
        memberName,
        choreTitle: assigned ? `${chore.title} (Được giao)` : chore.title,
        serverTimeFormatted: vnFormatted,
        phase,
      });

      if (watermarked?.previewUrl) {
        URL.revokeObjectURL(watermarked.previewUrl);
      }
      setWatermarked(result);
      setMode('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi xử lý ảnh xác thực.');
      setMode('idle');
    }
  }

  function handleNativeFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.lastModified && Date.now() - file.lastModified > 180_000) {
      setError('Chỉ chấp nhận ảnh vừa chụp trực tiếp từ camera, không dùng ảnh có sẵn trong thư viện.');
      return;
    }

    void processCapturedBlob(file);
  }

  async function startLiveCamera() {
    setError(null);
    haptic(15);
    if (!navigator.mediaDevices?.getUserMedia) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setMode('webrtc');
    } catch {
      setError('Không thể truy cập ống kính trực tiếp. Hãy dùng nút "Mở Camera sau chụp ảnh".');
    }
  }

  async function snapWebRtcFrame() {
    const video = videoRef.current;
    if (!video) return;
    haptic(15);

    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
    );
    if (!blob) {
      setError('Không thể chụp khung hình từ camera.');
      return;
    }
    await processCapturedBlob(blob);
  }

  async function handleSubmitProof() {
    if (!chore || !watermarked) return;
    setSubmitting(true);
    setError(null);
    haptic(15);

    const endpoint = phase === 'before' ? '/api/chores/start' : '/api/chores/complete';

    try {
      let activeToken = uploadToken;
      if (!activeToken) {
        const tokRes = await fetch('/api/upload-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ choreId: chore.id, phase }),
        });
        if (tokRes.ok) {
          const tokData = await tokRes.json();
          activeToken = tokData.token;
        }
      }

      if (!activeToken) {
        throw new Error('Offline');
      }

      const ext = watermarked.mimeType === 'image/jpeg' ? 'jpg' : 'webp';
      const formData = new FormData();
      formData.append('choreId', chore.id);
      formData.append('uploadToken', activeToken);
      if (assigned) {
        formData.append('assignedChoreId', assigned.id);
        if (assigned.current_cycle_key) {
          formData.append('cycleKey', assigned.current_cycle_key);
        }
      }
      if (sessionId) {
        formData.append('sessionId', sessionId);
      }
      formData.append('photo', watermarked.blob, `proof.${ext}`);
      if (watermarked.thumbBlob) {
        formData.append('thumb', watermarked.thumbBlob, `thumb.${ext}`);
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Không thể lưu ảnh xác thực.');
        return;
      }

      if (watermarked.previewUrl) {
        URL.revokeObjectURL(watermarked.previewUrl);
      }
      await onCompleted(false);
      onClose();
    } catch {
      try {
        await enqueueOfflineProof({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          endpoint,
          phase,
          choreId: chore.id,
          choreTitle: chore.title,
          assignedChoreId: assigned?.id ?? null,
          cycleKey: assigned?.current_cycle_key ?? null,
          sessionId: sessionId ?? null,
          mimeType: watermarked.mimeType,
          photoBlob: watermarked.blob,
          thumbBlob: watermarked.thumbBlob,
          queuedAtIso: new Date().toISOString(),
        });
        if (watermarked.previewUrl) {
          URL.revokeObjectURL(watermarked.previewUrl);
        }
        await onCompleted(true);
        onClose();
      } catch {
        setError('Mất kết nối mạng và không thể lưu bộ nhớ đệm.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    stopStream();
    if (watermarked?.previewUrl) {
      URL.revokeObjectURL(watermarked.previewUrl);
    }
    onClose();
  }

  const badgeTitle =
    phase === 'before'
      ? 'Bước 1/2 • Chụp ảnh TRƯỚC khi làm'
      : phase === 'after'
        ? 'Bước 2/2 • Chụp ảnh SAU khi làm'
        : assigned
          ? 'Xác thực việc được giao'
          : 'Xác thực Camera trực tiếp';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px]">
      <div className="w-full max-w-[430px] bg-white dark:bg-[#1E293B] border-t border-[#E5E7EB] dark:border-[#334155] rounded-t-3xl p-5 pb-7 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="w-10 h-1 rounded-full bg-[#D1D5DB] dark:bg-[#475569] mx-auto -mt-1" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <div
              className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${
                phase === 'before' ? 'text-[#D97706]' : 'text-[#059669]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {badgeTitle}
            </div>
            <h2 className="text-lg font-bold text-[#111827] dark:text-[#F8FAFC] mt-0.5">
              {chore.title}
            </h2>
            <p className="text-xs text-[#6B7280] dark:text-[#94A3B8]">
              {phase === 'before'
                ? 'Chụp hiện trạng ban đầu để mở đồng hồ đếm thời gian làm việc.'
                : 'Ảnh được đóng dấu giờ máy chủ Việt Nam (UTC+7) • Token bảo mật 2 phút.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Đóng"
            className="w-11 h-11 rounded-xl bg-[#F3F4F6] dark:bg-[#0F172A] flex items-center justify-center text-[#6B7280] dark:text-[#94A3B8] shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleNativeFileChange}
          className="hidden"
        />

        {error && (
          <div className="rounded-xl bg-[#FEF2F2] dark:bg-[#450A0A] border border-[#FECACA] dark:border-[#7F1D1D] px-3.5 py-2.5 text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
            {error}
          </div>
        )}

        {mode === 'idle' && (
          <div className="space-y-3 pt-1">
            <button
              type="button"
              onClick={() => {
                haptic(15);
                fileInputRef.current?.click();
              }}
              className={`w-full h-14 rounded-2xl text-white font-semibold text-base flex items-center justify-center gap-2.5 active:scale-[0.99] transition ${
                phase === 'before'
                  ? 'bg-[#D97706] hover:bg-[#B45309]'
                  : 'bg-[#059669] hover:bg-[#047857]'
              }`}
            >
              <Camera className="w-5 h-5" />
              Mở Camera sau chụp ảnh
            </button>

            <button
              type="button"
              onClick={startLiveCamera}
              className="w-full h-12 rounded-2xl border border-[#E5E7EB] dark:border-[#334155] bg-[#F8F9FA] dark:bg-[#0F172A] text-[#111827] dark:text-[#F8FAFC] font-medium text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition"
            >
              <Video className="w-4 h-4 text-[#6B7280] dark:text-[#94A3B8]" />
              Chụp trực tiếp trong ứng dụng
            </button>

            <p className="text-[11px] text-center text-[#6B7280] dark:text-[#94A3B8] flex items-center justify-center gap-1">
              <WifiOff className="w-3.5 h-3.5" />
              Hỗ trợ lưu tạm ngoại tuyến khi mất Wi-Fi và tự đồng bộ lại.
            </p>
          </div>
        )}

        {mode === 'webrtc' && (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-2xl bg-black aspect-[4/3] border border-[#E5E7EB] dark:border-[#334155]">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  stopStream();
                  setMode('idle');
                }}
                className="h-12 rounded-xl border border-[#E5E7EB] dark:border-[#334155] text-sm font-medium text-[#111827] dark:text-[#F8FAFC]"
              >
                Quay lại
              </button>
              <button
                type="button"
                onClick={snapWebRtcFrame}
                className="h-12 rounded-xl bg-[#059669] text-white text-sm font-semibold flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" />
                Chụp ngay
              </button>
            </div>
          </div>
        )}

        {mode === 'processing' && (
          <div className="py-10 text-center space-y-2">
            <div className="w-8 h-8 border-2 border-[#059669] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm font-medium text-[#111827] dark:text-[#F8FAFC]">
              Đang đồng bộ giờ máy chủ & đóng dấu ảnh...
            </p>
          </div>
        )}

        {mode === 'preview' && watermarked && (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] dark:border-[#334155] bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={watermarked.previewUrl}
                alt="Ảnh đã đóng dấu"
                className="w-full max-h-[46vh] object-contain mx-auto"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-[#6B7280] dark:text-[#94A3B8] px-1 tabular-nums">
              <span>Giờ máy chủ: {serverStamp}</span>
              <span>Dung lượng: {Math.round(watermarked.sizeBytes / 1024)} KB</span>
            </div>

            <div className="grid grid-cols-5 gap-2.5">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setMode('idle')}
                className="col-span-2 h-12 rounded-xl border border-[#E5E7EB] dark:border-[#334155] text-sm font-medium text-[#111827] dark:text-[#F8FAFC] flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" />
                Chụp lại
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmitProof}
                className={`col-span-3 h-12 rounded-xl disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-1.5 ${
                  phase === 'before'
                    ? 'bg-[#D97706] hover:bg-[#B45309]'
                    : 'bg-[#059669] hover:bg-[#047857]'
                }`}
              >
                <Check className="w-4 h-4" />
                {submitting
                  ? 'Đang lưu...'
                  : phase === 'before'
                    ? 'Bắt đầu tính giờ'
                    : 'Xác nhận hoàn thành'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
