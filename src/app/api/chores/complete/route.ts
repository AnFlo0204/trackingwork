import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { recordAuditLog } from '@/lib/audit';
import { getAuthenticatedSession } from '@/lib/auth';
import { extractAndVerifyProofBinary, verifySignedRequest } from '@/lib/requestIntegrity';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchAuthoritativeServerTime, getVnDateParts, vnDateTimeToUtcMs } from '@/lib/time';

const MAX_UPLOAD_BYTES = 300 * 1024;
const ALLOWED_MIMES = new Set(['image/webp', 'image/jpeg']);

export async function POST(req: Request) {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ error: 'Phiên đăng nhập hết hạn.' }, { status: 401 });
  }
  const me = session.profile;

  const verified = await verifySignedRequest(req, session);
  if (!verified.ok) return verified.response;

  try {
    const formData = verified.formData;
    if (!formData) {
      return NextResponse.json({ error: 'Dữ liệu FormData không hợp lệ.' }, { status: 400 });
    }
    const choreId = String(formData.get('choreId') || '').trim();
    const uploadToken = String(formData.get('uploadToken') || '').trim();
    const assignedChoreId = String(formData.get('assignedChoreId') || '').trim() || null;
    const requestedCycleKey = String(formData.get('cycleKey') || '').trim() || null;
    const sessionId = String(formData.get('sessionId') || '').trim() || null;
    const photo = formData.get('photo');
    const thumb = formData.get('thumb');

    if (!choreId || !(photo instanceof Blob) || !uploadToken) {
      return NextResponse.json(
        { error: 'Thiếu token xác thực tải ảnh hoặc dữ liệu ảnh.' },
        { status: 400 },
      );
    }

    if (photo.size === 0 || photo.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: 'Dung lượng ảnh không hợp lệ (tối đa 300KB).' },
        { status: 400 },
      );
    }

    if (!ALLOWED_MIMES.has(photo.type)) {
      return NextResponse.json(
        { error: 'Chỉ chấp nhận ảnh định dạng WebP hoặc JPEG.' },
        { status: 400 },
      );
    }

    const mimeType = photo.type;
    const ext = mimeType === 'image/jpeg' ? 'jpg' : 'webp';

    const supabase = getSupabaseAdmin();
    const [serverTime, choreRes, settingsRes, latestLogRes, tokenRes] = await Promise.all([
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
      supabase.from('upload_tokens').select('*').eq('id', uploadToken).maybeSingle(),
    ]);

    const tok = tokenRes.data;
    const serverNowMs = Date.parse(serverTime.isoUtc);

    if (
      !tok ||
      tok.profile_id !== me.id ||
      tok.chore_id !== choreId ||
      tok.used_at !== null ||
      Date.parse(tok.expires_at) < serverNowMs
    ) {
      return NextResponse.json(
        { error: 'Phiên tải ảnh đã hết hạn (2 phút) hoặc đã được sử dụng. Vui lòng chụp lại.' },
        { status: 403 },
      );
    }

    const { data: consumedTok } = await supabase
      .from('upload_tokens')
      .update({ used_at: serverTime.isoUtc })
      .eq('id', tok.id)
      .is('used_at', null)
      .select('id')
      .maybeSingle();

    if (!consumedTok) {
      return NextResponse.json({ error: 'Token tải ảnh đã được sử dụng.' }, { status: 409 });
    }

    const chore = choreRes.data;
    if (!chore) {
      return NextResponse.json({ error: 'Công việc không tồn tại hoặc đã bị ẩn.' }, { status: 404 });
    }

    const serverNowIso = new Date(serverNowMs).toISOString();
    // Auto-expire any stale locks older than 60 minutes, then reject if another user holds an active lock
    await supabase
      .from('chore_sessions')
      .update({ status: 'cancelled' })
      .eq('chore_id', chore.id)
      .eq('status', 'in_progress')
      .lte('expires_at', serverNowIso);

    const { data: foreignLock } = await supabase
      .from('chore_sessions')
      .select('id, profile_id')
      .eq('chore_id', chore.id)
      .eq('status', 'in_progress')
      .gt('expires_at', serverNowIso)
      .neq('profile_id', me.id)
      .limit(1)
      .maybeSingle();

    if (foreignLock) {
      const { data: locker } = await supabase
        .from('profiles')
        .select('display_name, username')
        .eq('id', foreignLock.profile_id)
        .maybeSingle();
      const lockerName = locker?.display_name || locker?.username || 'Thành viên';
      return NextResponse.json(
        { error: `🔒 ${lockerName} đang làm việc này.` },
        { status: 409 },
      );
    }

    const todayCycleKey = getVnDateParts(serverNowMs).dateStr;
    let resolvedCycleKey: string | null = requestedCycleKey || todayCycleKey;

    let beforeProofUrl: string | null = null;
    let beforeStoragePath: string | null = null;
    let startedAt: string | null = null;

    if (chore.require_before_after) {
      const { data: sessionRow } = sessionId
        ? await supabase
            .from('chore_sessions')
            .select('*')
            .eq('id', sessionId)
            .eq('profile_id', me.id)
            .eq('status', 'in_progress')
            .maybeSingle()
        : await supabase
            .from('chore_sessions')
            .select('*')
            .eq('profile_id', me.id)
            .eq('chore_id', chore.id)
            .eq('status', 'in_progress')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

      if (!sessionRow || !sessionRow.before_proof_url) {
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
    }

    let acceptedSwap: {
      id: string;
      requester_id: string;
      accepted_by: string | null;
      bounty_amount: number;
    } | null = null;
    let autoAssignmentBonus: {
      amount: number;
      assignedById: string | null;
      onTime: boolean;
    } | null = null;

    if (assignedChoreId) {
      const { data: assignment } = await supabase
        .from('assigned_chores')
        .select('id, assignee_id, assigned_by, chore_id, is_active, schedule_type, due_date, due_time, bonus_amount')
        .eq('id', assignedChoreId)
        .maybeSingle();

      if (!assignment || !assignment.is_active) {
        return NextResponse.json({ error: 'Nhiệm vụ được giao không còn hiệu lực.' }, { status: 404 });
      }
      if (assignment.schedule_type === 'once' && assignment.due_date) {
        resolvedCycleKey = assignment.due_date;
      }

      const deadlineMs = resolvedCycleKey
        ? vnDateTimeToUtcMs(resolvedCycleKey, assignment.due_time || '23:59')
        : serverNowMs;
      const bonusVal = Math.max(0, Math.round(Number(assignment.bonus_amount || 0)));
      if (bonusVal > 0 && serverNowMs <= deadlineMs) {
        autoAssignmentBonus = {
          amount: bonusVal,
          assignedById: assignment.assigned_by || null,
          onTime: true,
        };
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
    const binCheck = extractAndVerifyProofBinary(buffer, mimeType, {
      userId: me.id,
      choreId,
      signingKey: session.signingKey,
    });
    if (!binCheck.ok) {
      await recordAuditLog({
        actorName: me.display_name,
        actionType: 'BINARY_TAMPER_ATTEMPT',
        targetSummary: `Từ chối ảnh hoàn thành [${chore.title}]: ${binCheck.reason}`,
        refId: chore.id,
      });
      return NextResponse.json({ error: `Ảnh xác thực không hợp lệ: ${binCheck.reason}` }, { status: 403 });
    }

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

    // Optional low-res thumbnail upload for ultra-low feed egress
    let thumbUrl: string | null = null;
    let thumbStoragePath: string | null = null;
    if (thumb instanceof Blob && thumb.size > 0 && thumb.size <= 50 * 1024 && ALLOWED_MIMES.has(thumb.type)) {
      const tExt = thumb.type === 'image/jpeg' ? 'jpg' : 'webp';
      const tPath = `thumbs/${chore.id}/${Date.now()}-${crypto.randomUUID()}.${tExt}`;
      const tBuf = Buffer.from(await thumb.arrayBuffer());
      const { error: tErr } = await supabase.storage
        .from('chore-proofs')
        .upload(tPath, tBuf, { contentType: thumb.type, cacheControl: '31536000', upsert: false });
      if (!tErr) {
        thumbStoragePath = tPath;
        thumbUrl = supabase.storage.from('chore-proofs').getPublicUrl(tPath).data.publicUrl;
      }
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
        thumb_url: thumbUrl,
        thumb_storage_path: thumbStoragePath,
        storage_path: storagePath,
        before_proof_url: beforeProofUrl,
        before_storage_path: beforeStoragePath,
        started_at: startedAt,
        points_awarded: pointsAwarded,
        points_earned: pointsAwarded,
        chore_title_snapshot: chore.title,
        server_timestamp: serverTime.isoUtc,
      })
      .select()
      .single();

    if (insertErr) {
      await supabase.storage
        .from('chore-proofs')
        .remove([storagePath, ...(thumbStoragePath ? [thumbStoragePath] : [])]);
      console.error('Insert log error:', insertErr);
      return NextResponse.json({ error: 'Không thể lưu lịch sử hoàn thành.' }, { status: 500 });
    }

    // Complete any active lock sessions held by current user for this chore
    await supabase
      .from('chore_sessions')
      .update({ status: 'completed' })
      .eq('chore_id', chore.id)
      .eq('profile_id', me.id)
      .eq('status', 'in_progress');

    const effectiveAutoBonus =
      autoAssignmentBonus && autoAssignmentBonus.onTime && autoAssignmentBonus.amount > 0
        ? autoAssignmentBonus.amount
        : Math.max(0, Math.round(Number(chore.bonus_amount || 0)));

    if (effectiveAutoBonus > 0) {
      const { data: bonusCfgRow } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'bonus_reward_config')
        .maybeSingle();
      const bonusEnabled = Boolean(bonusCfgRow?.value?.enabled ?? true);
      if (bonusEnabled) {
        let assignerName = 'Hệ thống';
        if (autoAssignmentBonus?.assignedById) {
          const { data: assigner } = await supabase
            .from('profiles')
            .select('display_name, username')
            .eq('id', autoAssignmentBonus.assignedById)
            .maybeSingle();
          if (assigner) {
            assignerName = assigner.display_name || assigner.username;
          }
        }
        await supabase.rpc('award_member_bonus', {
          p_recipient_id: me.id,
          p_actor_id: autoAssignmentBonus?.assignedById || null,
          p_actor_name: assignerName,
          p_amount: effectiveAutoBonus,
          p_reason: `Hoàn thành: ${chore.title}`,
          p_log_id: insertedLog.id,
          p_assigned_chore_id: assignedChoreId,
          p_chore_id: chore.id,
          p_cycle_key: resolvedCycleKey,
          p_server_ts: serverTime.isoUtc,
          p_is_auto: true,
        });
      }
    }

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
