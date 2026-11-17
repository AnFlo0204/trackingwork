import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { formatIsoToVn } from '@/lib/time';

export const dynamic = 'force-dynamic';

function csvCell(val: string | number): string {
  const s = String(val ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET() {
  const me = await getAuthenticatedProfile();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const [logsRes, profilesRes, choresRes] = await Promise.all([
    supabase.from('chore_logs').select('*').order('created_at', { ascending: false }).limit(5000),
    supabase.from('profiles').select('id, username, display_name'),
    supabase.from('chores').select('id, title'),
  ]);

  const profileMap = new Map<string, string>();
  for (const p of profilesRes.data || []) {
    profileMap.set(p.id, p.display_name || p.username);
  }
  const choreMap = new Map<string, string>();
  for (const c of choresRes.data || []) {
    choreMap.set(c.id, c.title);
  }

  const lines = [
    ['Thời gian (UTC+7)', 'Công việc', 'Thành viên', 'Điểm thưởng', 'Ảnh xác thực'].map(csvCell).join(','),
  ];

  for (const row of logsRes.data || []) {
    lines.push(
      [
        formatIsoToVn(row.server_timestamp),
        choreMap.get(row.chore_id) || row.chore_title_snapshot || '',
        profileMap.get(row.profile_id) || '',
        row.points_awarded ?? 0,
        row.proof_url,
      ]
        .map(csvCell)
        .join(','),
    );
  }

  const csvContent = '\uFEFF' + lines.join('\r\n');
  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="lich-su-viec-nha-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
