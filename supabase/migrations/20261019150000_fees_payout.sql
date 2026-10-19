-- 수수료 · 입금 예정가
--  · settings.platforms[*] 에 feeRate(수수료율 %) · feeBasis('sale' 판매가 / 'net' 쿠폰 뺀 금액) · couponHotel(기본 쿠폰 숙소 부담) · payoutDays(퇴실 후 N일)
--    → 플랫폼 칸 안이라 예전 앱도 그대로 둬요 (모르는 칸도 같이 저장)
--  · settings.cardFeeRate = 카드 수수료율 % (현장 카드 결제에만). 예전 앱이 통째로 저장해도 지워지지 않게 보존 목록에 추가
--  · bookings.coupons = [{amount, hotel}] 쿠폰 (판매 가격은 쿠폰 빼기 전 그대로)
--  · bookings.payout_confirmed / payout_amount = 플랫폼 입금 확인 · 실제 입금액 (비면 입금 예정가)
alter table public.bookings
  add column coupons jsonb
    constraint bookings_coupons_shape check (coupons is null or (jsonb_typeof(coupons) = 'array' and jsonb_array_length(coupons) <= 10 and pg_column_size(coupons) <= 2000)),
  add column payout_confirmed boolean not null default false,
  add column payout_amount integer
    constraint bookings_payout_amount_range check (payout_amount is null or payout_amount between 0 and 100000000);
comment on column public.bookings.coupons is '쿠폰 [{amount, hotel}] · hotel = 숙소 부담 (공유 화면에는 안 보여요)';
comment on column public.bookings.payout_confirmed is '플랫폼 입금 확인';
comment on column public.bookings.payout_amount is '실제 입금액 (비면 입금 예정가)';

create or replace function private.keep_new_settings_keys()
returns trigger language plpgsql set search_path = '' as $$
declare k text;
begin
  if new.settings is null or old.settings is null then return new; end if;
  foreach k in array array['surchargeTiers', 'specialDates', 'stayTimes', 'extraHourFee', 'parking', 'cardFeeRate'] loop
    if not (new.settings ? k) and (old.settings ? k) then
      new.settings := new.settings || jsonb_build_object(k, old.settings -> k);
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.keep_new_settings_keys() from public, anon, authenticated;

-- 공유 화면: 돈은 그대로 안 보여요 (플랫폼 수수료 · 카드 수수료 · 쿠폰 · 입금 빼고)
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
          'arrival_mode', b.arrival_mode, 'car_count', b.car_count
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
