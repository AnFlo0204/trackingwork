import { recordAuditLog } from './audit';
import { bumpSyncSignal, getSupabaseAdmin } from './supabaseAdmin';

export interface CleanupResult {
  deletedLogs: number;
  deletedFiles: number;
  cutoffIso: string;
}

function extractStoragePath(urlOrPath: string | null | undefined): string {
  if (!urlOrPath) return '';
  if (!urlOrPath.startsWith('http')) return urlOrPath;
  const marker = '/chore-proofs/';
  const idx = urlOrPath.indexOf(marker);
  return idx >= 0 ? urlOrPath.slice(idx + marker.length) : '';
}

export async function runRetentionCleanup(
  force = false,
  actorName?: string,
): Promise<CleanupResult | null> {
  const supabase = getSupabaseAdmin();

  const { data: settingsRows } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['retention_days', 'last_cleanup_at']);

  let retentionDays = 90;
  let lastCleanupAt: string | null = null;

  for (const row of settingsRows || []) {
    if (row.key === 'retention_days' && typeof row.value?.days === 'number') {
      retentionDays = Math.max(1, Math.min(3650, Math.floor(row.value.days)));
    }
    if (row.key === 'last_cleanup_at' && row.value?.timestamp) {
      lastCleanupAt = String(row.value.timestamp);
    }
  }

  if (!force && lastCleanupAt) {
    const lastMs = Date.parse(lastCleanupAt);
    if (!Number.isNaN(lastMs) && Date.now() - lastMs < 6 * 60 * 60 * 1000) {
      return null;
    }
  }

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  const { data: expiredLogs, error: fetchErr } = await supabase
    .from('chore_logs')
    .select('id, storage_path, proof_url, before_storage_path, before_proof_url, thumb_storage_path')
    .lt('created_at', cutoffIso)
    .limit(500);

  if (fetchErr) {
    console.error('Cleanup fetch error:', fetchErr);
    return null;
  }

  let deletedFiles = 0;
  let deletedLogs = 0;

  if (expiredLogs && expiredLogs.length > 0) {
    const storagePaths: string[] = [];
    for (const l of expiredLogs) {
      const pAfter = l.storage_path || extractStoragePath(l.proof_url);
      const pBefore = l.before_storage_path || extractStoragePath(l.before_proof_url);
      if (pAfter) storagePaths.push(pAfter);
      if (pBefore) storagePaths.push(pBefore);
      if (l.thumb_storage_path) storagePaths.push(l.thumb_storage_path);
    }

    if (storagePaths.length > 0) {
      const { error: rmErr } = await supabase.storage.from('chore-proofs').remove(storagePaths);
      if (!rmErr) {
        deletedFiles = storagePaths.length;
      } else {
        console.error('Storage remove error during cleanup:', rmErr);
      }
    }

    const expiredIds = expiredLogs.map((l) => l.id);
    // Log summary before deleting so triggers don't spam per-row
    await recordAuditLog({
      actorName: actorName || 'Hệ thống tự động',
      actionType: 'MANUAL_CLEANUP',
      targetSummary: `Dọn dẹp ${expiredIds.length} lượt và ${deletedFiles} ảnh quá hạn (> ${retentionDays} ngày)`,
    });

    const { error: delErr } = await supabase.from('chore_logs').delete().in('id', expiredIds);
    if (!delErr) {
      deletedLogs = expiredIds.length;
    } else {
      console.error('DB delete error during cleanup:', delErr);
    }
  } else if (force && actorName) {
    await recordAuditLog({
      actorName,
      actionType: 'MANUAL_CLEANUP',
      targetSummary: `Kiểm tra dọn dẹp thủ công (> ${retentionDays} ngày): không có dữ liệu quá hạn`,
    });
  }

  await supabase.from('app_settings').upsert(
    {
      key: 'last_cleanup_at',
      value: { timestamp: new Date().toISOString() },
    },
    { onConflict: 'key' },
  );

  if (deletedLogs > 0) {
    await bumpSyncSignal('all');
  }

  return { deletedLogs, deletedFiles, cutoffIso };
}
