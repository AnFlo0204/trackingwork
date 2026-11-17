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

/**
 * Purges chore_logs and Storage objects (both AFTER and BEFORE photos) older than `retentionDays`.
 */
export async function runRetentionCleanup(force = false): Promise<CleanupResult | null> {
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
    .select('id, storage_path, proof_url, before_storage_path, before_proof_url')
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
    const { error: delErr } = await supabase.from('chore_logs').delete().in('id', expiredIds);
    if (!delErr) {
      deletedLogs = expiredIds.length;
    } else {
      console.error('DB delete error during cleanup:', delErr);
    }
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
