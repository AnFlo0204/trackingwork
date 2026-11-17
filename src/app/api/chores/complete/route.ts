import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchAuthoritativeServerTime, getVnDateParts } from '@/lib/time';

export async function POST(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me) {
    return NextResponse.json({ error: 'Phiên đăng nhập hết hạn.' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const choreId = String(formData.get('choreId') || '').trim();
    const assignedChoreId = String(formData.get('assignedChoreId') || '').trim() || null;
    const requestedCycleKey = String(formData.get('cycleKey') || '').trim() || null;
    const sessionId = String(formData.get('sessionId') || '').trim() || null;
    const photo = formData.get('photo');

    if (!choreId || !(photo instanceof Blob)) {
      return NextResponse.json({ error: 'Thiếu thông tin công việc hoặc ảnh xác thực.' }, { status: 400 });
    }

    if (photo.size === 0 || photo.size > 300 * 1024) {
      return NextResponse.json(
        { error: 'Dung lượng ảnh không hợp lệ (tối đa ~180KB sau khi nén).' },
        { status: 400 },
      );
    }

    const allowedTypes = ['image/webp', 'image/jpeg', 'image/png'];
    const mimeType = allowedTypes.includes(photo.type) ? photo.type : 'image/webp';
    const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp';

    const supabase = getSupabaseAdmin();
    const [serverTime, choreRes, settingsRes, latestLogRes] = await Promise.all([
      fetchAuthoritativeServerTime(),
      supabase.from('chores').select('*').eq('id', choreId).eq('is_active', true).maybeSingle(),
      supabase.from('app_settings').select('value').eq('key', 'feature_flags').maybeSingle(),
      supabase
        .from('chore_logs')
        .select('id, server_timestamp')
        .eq('chore_id', choreId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const chore = choreRes.data;
    if (!chore) {
      return NextResponse.json({ error: 'Công việc không tồn tại hoặc đã bị ẩn.' }, { status: 404 });
    }

    const serverNowMs = Date.parse(serverTime.isoUtc);
    const todayCycleKey = getVnDateParts(serverNowMs).dateStr;
    let resolvedCycleKey: string | null = requestedCycleKey || todayCycleKey;

    // 1. Validate Before/After session if chore requires it
    let beforeProofUrl: string | null = null;
    let beforeStoragePath: string | null = null;
    let startedAt: string | null = null;
    let activeSessionId: string | null = null;

    if (chore.require_before_after) {
      const sessionQuery = supabase
        .from('chore_sessions')
        .select('*')
        .eq('profile_id', me.id)
        .eq('chore_id', chore.id)
        .eq('status', 'in_progress')
        .order('created_at', { ascending: false })
        .limit(1);

      const { data: sessionRow } = sessionId
        ? await supabase
            .from('chore_sessions')
            .select('*')
            .eq('id', sessionId)
            .eq('profile_id', me.id)
            .eq('status', 'in_progress')
            .maybeSingle()
        : await sessionQuery.maybeSingle();

      if (!sessionRow) {
        return NextResponse.json(
          { error: 'Việc này yêu cầu chụp ảnh Trước khi làm trước khi hoàn thành.' },
          { status: 400 },
        );
      }

      const unlockMs = Date.parse(sessionRow.unlock_at);
      if (serverNowMs < unlockMs) {
        const remainSec = Math.ceil((unlockMs - serverNowMs) / 1000);
        const mins = Math.floor(remainSec / 60);
        const secs = remainSec % 60;
        return NextResponse.json(
          {
            error: `Chưa đủ thời gian tối thiểu (${chore.min_duration_minutes} phút). Vui lòng chờ thêm ${mins}p ${secs}s.`,
          },
          { status: 429 },
        );
      }

      beforeProofUrl = sessionRow.before_proof_url;
      beforeStoragePath = sessionRow.before_storage_path;
      startedAt = sessionRow.started_at;
      activeSessionId = sessionRow.id;
    }

    // 2. Validate Assignment & Accepted Shift Swaps
    let acceptedSwap: {
      id: string;
      requester_id: string;
      accepted_by: string | null;
      bounty_amount: number;
    } | null = null;

    if (assignedChoreId) {
      const { data: assignment } = await supabase
        .from('assigned_chores')
        .select('id, assignee_id, chore_id, is_active, schedule_type, due_date')
        .eq('id', assignedChoreId)
        .maybeSingle();

      if (!assignment || !assignment.is_active) {
        return NextResponse.json({ error: 'Nhiệm vụ được giao không còn hiệu lực.' }, { status: 404 });
      }
      if (assignment.schedule_type === 'once' && assignment.due_date) {
        resolvedCycleKey = assignment.due_date;
      }

      const { data: swapRow } = await supabase
        .from('shift_swaps')
        .select('id, requester_id, accepted_by, bounty_amount')
        .eq('assigned_chore_id', assignedChoreId)
        .eq('cycle_key', resolvedCycleKey)
        .eq('status', 'accepted')
        .maybeSingle();

      acceptedSwap = swapRow || null;
      const effectiveOwnerId = acceptedSwap?.accepted_by || assignment.assignee_id;

      if (effectiveOwnerId !== me.id) {
        return NextResponse.json({ error: 'Nhiệm vụ này thuộc về thành viên khác.' }, { status: 403 });
      }

      const { data: dupLog } = await supabase
        .from('chore_logs')
        .select('id')
        .eq('assigned_chore_id', assignedChoreId)
        .eq('cycle_key', resolvedCycleKey)
        .limit(1)
        .maybeSingle();

      if (dupLog) {
        return NextResponse.json(
          { error: 'Nhiệm vụ được giao trong chu kỳ này đã hoàn thành rồi.' },
          { status: 409 },
        );
      }
    } else {
      const cooldownMs = Math.max(0, Number(chore.cooldown_minutes || 0)) * 60_000;
      if (latestLogRes.data && cooldownMs > 0) {
        const lastMs = Date.parse(latestLogRes.data.server_timestamp);
        const elapsed = serverNowMs - lastMs;
        if (elapsed >= 0 && elapsed < cooldownMs) {
          const remainMin = Math.ceil((cooldownMs - elapsed) / 60_000);
          return NextResponse.json(
            { error: `Việc này vừa được hoàn thành. Vui lòng đợi thêm ${remainMin} phút.` },
            { status: 429 },
          );
        }
      }
      resolvedCycleKey = null;
    }

    const buffer = Buffer.from(await photo.arrayBuffer());
    const storagePath = `${chore.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from('chore-proofs')
      .upload(storagePath, buffer, {
        contentType: mimeType,
        cacheControl: '31536000',
        upsert: false,
      });

    if (uploadErr) {
      console.error('Upload error:', uploadErr);
      return NextResponse.json({ error: 'Không thể tải ảnh lên máy chủ.' }, { status: 500 });
    }

    const { data: publicUrlData } = supabase.storage.from('chore-proofs').getPublicUrl(storagePath);
    const gamificationOn = Boolean(settingsRes.data?.value?.gamification ?? true);
    const pointsAwarded = gamificationOn ? Number(chore.points || 0) : 0;

    const { data: insertedLog, error: insertErr } = await supabase
      .from('chore_logs')
      .insert({
        chore_id: chore.id,
        profile_id: me.id,
        assigned_chore_id: assignedChoreId,
        cycle_key: resolvedCycleKey,
        proof_url: publicUrlData.publicUrl,
        storage_path: storagePath,
        before_proof_url: beforeProofUrl,
        before_storage_path: beforeStoragePath,
        started_at: startedAt,
        points_awarded: pointsAwarded,
        chore_title_snapshot: chore.title,
        server_timestamp: serverTime.isoUtc,
      })
      .select()
      .single();

    if (insertErr) {
      await supabase.storage.from('chore-proofs').remove([storagePath]);
      console.error('Insert log error:', insertErr);
      return NextResponse.json({ error: 'Không thể lưu lịch sử hoàn thành.' }, { status: 500 });
    }

    if (activeSessionId) {
      await supabase
        .from('chore_sessions')
        .update({ status: 'completed' })
        .eq('id', activeSessionId);
    }

    // 3. Settle Shift Swap Bounty Transfer upon verified completion
    if (acceptedSwap && acceptedSwap.accepted_by === me.id) {
      await supabase
        .from('shift_swaps')
        .update({ status: 'completed', completed_at: serverTime.isoUtc })
        .eq('id', acceptedSwap.id);

      const bounty = Number(acceptedSwap.bounty_amount || 0);
      if (bounty > 0 && acceptedSwap.requester_id !== me.id) {
        const [{ data: reqProf }, { data: helperProf }] = await Promise.all([
          supabase
            .from('profiles')
            .select('id, display_name, current_balance')
            .eq('id', acceptedSwap.requester_id)
            .maybeSingle(),
          supabase
            .from('profiles')
            .select('id, display_name, current_balance')
            .eq('id', me.id)
            .maybeSingle(),
        ]);

        if (reqProf && helperProf) {
          const reqNewBal = Number(reqProf.current_balance || 0) - bounty;
          const helperNewBal = Number(helperProf.current_balance || 0) + bounty;

          await Promise.all([
            supabase
              .from('profiles')
              .update({ current_balance: reqNewBal, updated_at: serverTime.isoUtc })
              .eq('id', reqProf.id),
            supabase
              .from('profiles')
              .update({ current_balance: helperNewBal, updated_at: serverTime.isoUtc })
              .eq('id', helperProf.id),
            supabase.from('fund_transactions').insert([
              {
                profile_id: reqProf.id,
                assigned_chore_id: assignedChoreId,
                chore_id: chore.id,
                tx_type: 'adjustment',
                category: 'bounty_paid',
                amount: -bounty,
                balance_after: reqNewBal,
                cycle_key: resolvedCycleKey,
                description: `Thưởng làm hộ (${helperProf.display_name}): ${chore.title}`,
                server_timestamp: serverTime.isoUtc,
              },
              {
                profile_id: helperProf.id,
                assigned_chore_id: assignedChoreId,
                chore_id: chore.id,
                tx_type: 'refund',
                category: 'bounty_earned',
                amount: bounty,
                balance_after: helperNewBal,
                cycle_key: resolvedCycleKey,
                description: `Nhận thưởng làm hộ (${reqProf.display_name}): ${chore.title}`,
                server_timestamp: serverTime.isoUtc,
              },
            ]),
            supabase.from('notifications').insert([
              {
                profile_id: reqProf.id,
                kind: 'balance_update',
                title: `Đã hoàn thành ca nhờ làm hộ`,
                body: `${helperProf.display_name} đã hoàn thành ${chore.title}. Chuyển thưởng -${bounty.toLocaleString('vi-VN')}đ.`,
              },
              {
                profile_id: helperProf.id,
                kind: 'balance_update',
                title: `Nhận thưởng +${bounty.toLocaleString('vi-VN')}đ`,
                body: `Hoàn thành việc làm hộ ${chore.title} cho ${reqProf.display_name}.`,
              },
            ]),
          ]);
        }
      }
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ log: insertedLog });
  } catch (err) {
    console.error('Complete chore error:', err);
    return NextResponse.json({ error: 'Lỗi xử lý hoàn thành việc.' }, { status: 500 });
  }
}
