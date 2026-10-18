-- 빠른 입실 · 늦은 퇴실 + 이체 결제
--  · bookings.early_in_hours = 기본 입실 시간(settings.stayTimes.checkIn)보다 몇 시간 일찍 (null/0 = 없음)
--  · bookings.late_out_hours = 기본 퇴실 시간(settings.stayTimes.checkOut)보다 몇 시간 늦게
--  · bookings.time_fee       = 판매 가격(price)에 들어 있는 시간 추가 금액 (0 + 시간 있음 = 서비스). price는 그대로 총액
--  · settings.extraHourFee   = 1시간 추가 요금 (기본 10,000) → 예전 앱이 통째로 저장해도 지워지지 않게 보존 목록에 추가
--  · booking_payments.method에 'transfer'(이체). 현금 시재에는 안 들어가요
alter table public.bookings
  add column early_in_hours smallint
    constraint bookings_early_in_hours_range check (early_in_hours is null or early_in_hours between 0 and 12),
  add column late_out_hours smallint
    constraint bookings_late_out_hours_range check (late_out_hours is null or late_out_hours between 0 and 12),
  add column time_fee integer
    constraint bookings_time_fee_range check (time_fee is null or time_fee between 0 and 100000000);
comment on column public.bookings.early_in_hours is '빠른 입실 시간 수 (기본 입실 시간 기준)';
comment on column public.bookings.late_out_hours is '늦은 퇴실 시간 수 (기본 퇴실 시간 기준)';
comment on column public.bookings.time_fee is '판매 가격에 포함된 빠른 입실·늦은 퇴실 금액 · 0 = 서비스';

alter table public.booking_payments drop constraint booking_payments_method_check;
alter table public.booking_payments add constraint booking_payments_method_check check (method in ('card', 'cash', 'transfer'));

create or replace function private.keep_new_settings_keys()
returns trigger language plpgsql set search_path = '' as $$
declare k text;
begin
  if new.settings is null or old.settings is null then return new; end if;
  foreach k in array array['surchargeTiers', 'specialDates', 'stayTimes', 'extraHourFee'] loop
    if not (new.settings ? k) and (old.settings ? k) then
      new.settings := new.settings || jsonb_build_object(k, old.settings -> k);
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.keep_new_settings_keys() from public, anon, authenticated;

-- 공유 화면: 빠른/늦은 시간만 더 보여요 (금액은 안 보여요). 요금 설정은 빼요
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
      'settings', h.settings - 'shopItems' - 'expenseCategories' - 'extraHourFee',
      'bookings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', b.id, 'kind', b.kind, 'status', b.status, 'platform_id', b.platform_id,
          'guest_name', b.guest_name, 'type_id', b.type_id, 'room_id', b.room_id, 'room_segments', b.room_segments,
          'check_in', b.check_in, 'nights', b.nights, 'start_time', b.start_time,
          'end_time', b.end_time, 'arrived', b.arrived, 'early_out_on', b.early_out_on,
          'early_in_hours', b.early_in_hours, 'late_out_hours', b.late_out_hours
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
