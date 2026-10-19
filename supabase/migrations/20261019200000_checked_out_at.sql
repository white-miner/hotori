-- 정상 퇴실처리: 직원이 확인한 퇴실 시각 (중도 퇴실 early_out_on 과 별개)
alter table public.bookings
  add column checked_out_at timestamptz null;
comment on column public.bookings.checked_out_at is '정상 퇴실처리 시각 · null이면 아직 퇴실 전 (early_out_on 재사용 금지)';

-- 공유 화면: 퇴실처리된 방은 빈 칸으로 보이도록 전달
create or replace function public.get_shared_status(share_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  hid uuid;
  d0 date := ((now() at time zone 'Asia/Seoul') - interval '6 hours')::date; -- 영업일(새벽 6시 기준)
begin
  if share_token is null or char_length(share_token) < 40 or char_length(share_token) > 64 then return null; end if;
  select s.hotel_id into hid
    from private.hotel_shares s join public.hotels h on h.id = s.hotel_id
    where s.token = share_token and s.enabled and h.plan = 'pro';
  if hid is null then return null; end if;
  return (
    select jsonb_build_object(
      'name', h.name,
      'today', d0,
      'settings', (h.settings - 'shopItems' - 'expenseCategories' - 'extraHourFee' - 'parking' - 'cardFeeRate' - 'platforms')
        || jsonb_build_object('parking', jsonb_build_object('enabled', coalesce((h.settings -> 'parking' -> 'enabled') = 'true'::jsonb, false)))
        || jsonb_build_object('platforms', coalesce((
             select jsonb_agg(p - 'feeRate' - 'feeBasis' - 'couponHotel' - 'payoutDays' order by o)
             from jsonb_array_elements(case when jsonb_typeof(h.settings -> 'platforms') = 'array' then h.settings -> 'platforms' else '[]'::jsonb end) with ordinality as x(p, o)
           ), '[]'::jsonb)),
      'bookings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', b.id, 'kind', b.kind, 'status', b.status, 'platform_id', b.platform_id,
          'guest_name', b.guest_name, 'type_id', b.type_id, 'room_id', b.room_id, 'room_segments', b.room_segments,
          'check_in', b.check_in, 'nights', b.nights, 'start_time', b.start_time,
          'end_time', b.end_time, 'arrived', b.arrived, 'early_out_on', b.early_out_on,
          'early_in_hours', b.early_in_hours, 'late_out_hours', b.late_out_hours,
          'arrival_mode', b.arrival_mode, 'car_count', b.car_count,
          'tentative', b.tentative,
          'no_clean', b.no_clean,
          'checked_out_at', b.checked_out_at
        ) order by b.check_in)
        from public.bookings b
        where b.hotel_id = hid
          and b.check_in <= d0 + 14
          and b.check_in >= d0 - 91
          and (case when b.kind = 'stay' then b.check_in + b.nights::int > d0 - 1 else b.check_in >= d0 - 1 end)
      ), '[]'::jsonb)
    )
    from public.hotels h where h.id = hid
  );
end $function$;
