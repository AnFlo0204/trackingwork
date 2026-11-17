import { NextResponse } from 'next/server';
import { runWeeklySettlementAndDeductions } from '@/lib/allowanceEngine';
import { getAuthenticatedProfile } from '@/lib/auth';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchAuthoritativeServerTime } from '@/lib/time';

export async function POST(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const supabase = getSupabaseAdmin();

    // 1. Update weekly_fund_config globally
    if (body?.action === 'config') {
      const cfg = body.config || {};
      const sanitized = {
        enabled: Boolean(cfg.enabled),
        reset_day: Math.max(0, Math.min(6, Math.floor(Number(cfg.reset_day ?? 1)))),
        reset_hour: Math.max(0, Math.min(23, Math.floor(Number(cfg.reset_hour ?? 0)))),
      };
      const { error } = await supabase
        .from('app_settings')
        .upsert({ key: 'weekly_fund_config', value: sanitized }, { onConflict: 'key' });
      if (error) {
        return NextResponse.json({ error: 'Không thể lưu cấu hình quỹ tuần.' }, { status: 500 });
      }
      await bumpSyncSignal('all');
      return NextResponse.json({ ok: true });
    }

    // 2. Toggle or reset Shared Party Fund ("Quỹ Liên Hoan Chung")
    if (body?.action === 'party_fund_config') {
      const { data: curRow } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'shared_party_fund')
        .maybeSingle();

      const currentBalance = Number(curRow?.value?.balance ?? 0);
      const currentShow = Boolean(curRow?.value?.show_banner ?? true);

      const nextBalance = body.reset_balance ? 0 : currentBalance;
      const nextShow =
        typeof body.show_banner === 'boolean' ? body.show_banner : currentShow;

      await supabase.from('app_settings').upsert(
        {
          key: 'shared_party_fund',
          value: { balance: nextBalance, show_banner: nextShow },
        },
        { onConflict: 'key' },
      );
      await bumpSyncSignal('all');
      return NextResponse.json({ ok: true });
    }

    // 3. Close weekly settlement & start fresh week ("Chốt sổ tuần mới")
    if (body?.action === 'close_week_settlement') {
      const serverTime = await fetchAuthoritativeServerTime();
      const serverNowMs = Date.parse(serverTime.isoUtc) || Date.now();
      await runWeeklySettlementAndDeductions(serverNowMs);

      const { data: epochRow } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'settlement_epoch')
        .maybeSingle();

      const nextNonce = Number(epochRow?.value?.nonce ?? 0) + 1;
      await supabase
        .from('app_settings')
        .upsert({ key: 'settlement_epoch', value: { nonce: nextNonce } }, { onConflict: 'key' });

      await runWeeklySettlementAndDeductions(serverNowMs);
      await bumpSyncSignal('all');
      return NextResponse.json({ ok: true, nonce: nextNonce });
    }

    // 4. Manual balance adjustment / refund (positive or negative)
    if (body?.action === 'adjust') {
      const profileId = String(body.profile_id || '').trim();
      const amount = Math.round(Number(body.amount || 0));
      const txType = body.tx_type === 'refund' ? 'refund' : 'adjustment';
      const description = String(body.description || '').trim();

      if (!profileId || !Number.isFinite(amount) || amount === 0 || !description) {
        return NextResponse.json(
          { error: 'Vui lòng chọn thành viên, số tiền khác 0 và nhập lý do.' },
          { status: 400 },
        );
      }

      const [{ data: target }, serverTime] = await Promise.all([
        supabase.from('profiles').select('id, current_balance').eq('id', profileId).maybeSingle(),
        fetchAuthoritativeServerTime(),
      ]);

      if (!target) {
        return NextResponse.json({ error: 'Không tìm thấy thành viên.' }, { status: 404 });
      }

      const nextBal = Number(target.current_balance || 0) + amount;
      await supabase
        .from('profiles')
        .update({ current_balance: nextBal, updated_at: serverTime.isoUtc })
        .eq('id', profileId);

      await supabase.from('fund_transactions').insert({
        profile_id: profileId,
        tx_type: txType,
        category: txType,
        amount,
        balance_after: nextBal,
        description,
        created_by: me.id,
        server_timestamp: serverTime.isoUtc,
      });

      await supabase.from('notifications').insert({
        profile_id: profileId,
        kind: 'balance_update',
        title: `Admin điều chỉnh ví ${amount >= 0 ? '+' : ''}${amount.toLocaleString('vi-VN')}đ`,
        body: `${description}. Số dư mới: ${nextBal.toLocaleString('vi-VN')}đ.`,
      });

      await bumpSyncSignal('all');
      return NextResponse.json({ ok: true, balance: nextBal });
    }

    // 5. Manual reset balance of a member back to their weekly_allowance
    if (body?.action === 'reset_member') {
      const profileId = String(body.profile_id || '').trim();
      const [{ data: target }, serverTime] = await Promise.all([
        supabase.from('profiles').select('id, weekly_allowance').eq('id', profileId).maybeSingle(),
        fetchAuthoritativeServerTime(),
      ]);
      if (!target) {
        return NextResponse.json({ error: 'Không tìm thấy thành viên.' }, { status: 404 });
      }
      const allowance = Number(target.weekly_allowance || 0);
      await supabase
        .from('profiles')
        .update({ current_balance: allowance, updated_at: serverTime.isoUtc })
        .eq('id', profileId);

      await supabase.from('fund_transactions').insert({
        profile_id: profileId,
        tx_type: 'adjustment',
        category: 'adjustment',
        amount: allowance,
        balance_after: allowance,
        description: 'Admin cấp lại định mức quỹ tuần',
        created_by: me.id,
        server_timestamp: serverTime.isoUtc,
      });

      await bumpSyncSignal('all');
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Hành động không hợp lệ.' }, { status: 400 });
  } catch (err) {
    console.error('Admin fund error:', err);
    return NextResponse.json({ error: 'Lỗi xử lý quỹ tuần.' }, { status: 500 });
  }
}
