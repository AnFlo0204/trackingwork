import { signedFetch } from './requestSigner';

export function haptic(ms = 15): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch {
    // Ignore on unsupported browsers
  }
}

export interface QueuedProofItem {
  id: string;
  endpoint: '/api/chores/start' | '/api/chores/complete';
  phase: 'before' | 'after' | 'single';
  choreId: string;
  choreTitle: string;
  assignedChoreId: string | null;
  cycleKey: string | null;
  sessionId: string | null;
  mimeType: string;
  photoBlob: Blob;
  thumbBlob?: Blob | null;
  queuedAtIso: string;
}

const DB_NAME = 'trackingwork_offline';
const STORE_NAME = 'proof_queue';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueOfflineProof(item: QueuedProofItem): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listOfflineProofs(): Promise<QueuedProofItem[]> {
  try {
    const db = await openDb();
    const items = await new Promise<QueuedProofItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result || []) as QueuedProofItem[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items.sort((a, b) => a.queuedAtIso.localeCompare(b.queuedAtIso));
  } catch {
    return [];
  }
}

export async function removeOfflineProof(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function flushOfflineProofQueue(): Promise<{ synced: number; remaining: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const cur = await listOfflineProofs();
    return { synced: 0, remaining: cur.length };
  }

  const items = await listOfflineProofs();
  let synced = 0;

  for (const item of items) {
    try {
      // Request a fresh single-use 2-minute upload token with HMAC signature
      const tokRes = await signedFetch('/api/upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choreId: item.choreId, phase: item.phase || 'single' }),
      });
      if (!tokRes.ok) break;
      const tokData = await tokRes.json();

      const ext = item.mimeType === 'image/jpeg' ? 'jpg' : 'webp';
      const fd = new FormData();
      fd.append('choreId', item.choreId);
      fd.append('uploadToken', tokData.token);
      if (item.assignedChoreId) fd.append('assignedChoreId', item.assignedChoreId);
      if (item.cycleKey) fd.append('cycleKey', item.cycleKey);
      if (item.sessionId) fd.append('sessionId', item.sessionId);
      fd.append('photo', item.photoBlob, `proof.${ext}`);
      if (item.thumbBlob) {
        fd.append('thumb', item.thumbBlob, `thumb.${ext}`);
      }

      const res = await signedFetch(item.endpoint, { method: 'POST', body: fd });
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        await removeOfflineProof(item.id);
        if (res.ok) synced += 1;
      }
    } catch {
      break;
    }
  }

  const remaining = (await listOfflineProofs()).length;
  return { synced, remaining };
}
