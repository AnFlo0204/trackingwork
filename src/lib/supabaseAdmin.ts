import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedAdmin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  cachedAdmin = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedAdmin;
}

export async function bumpSyncSignal(topic = 'all'): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    await supabase
      .from('sync_signals')
      .upsert({ topic, updated_at: new Date().toISOString() }, { onConflict: 'topic' });
  } catch (err) {
    console.error('bumpSyncSignal failed:', err);
  }
}
