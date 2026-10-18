-- 주차 관리 (설정에서 켜는 호텔만)
--  · settings.parking = {enabled, extraCarFee(추가 차량 1대 1박 요금, 2번째 차부터), walkDiscount(도보 할인, 예약 1건)}
--    없으면 꺼져 있어요 → 예전 호텔은 그대로. 예전 앱이 통째로 저장해도 지워지지 않게 보존 목록에 추가
--  · bookings.arrival_mode = 'walk'(도보) · 'car'(차량) · null(안 적음)
--  · bookings.car_count / car_plates(차량번호, 10개까지)
--  · bookings.car_fee / walk_discount = 판매 가격(price)에 들어 있는 추가 차량 금액 / 빠진 도보 할인 금액
alter table public.bookings
  add column arrival_mode text
    constraint bookings_arrival_mode_check check (arrival_mode is null or arrival_mode in ('walk', 'car')),
  add column car_count smallint
    constraint bookings_car_count_range check (car_count is null or car_count between 0 and 20),
  add column car_plates text[]
    constraint bookings_car_plates_size check (car_plates is null or (cardinality(car_plates) <= 10 and char_length(array_to_string(car_plates, '')) <= 200)),
  add column car_fee integer
    constraint bookings_car_fee_range check (car_fee is null or car_fee between 0 and 100000000),
  add column walk_discount integer
    constraint bookings_walk_discount_range check (walk_discount is null or walk_discount between 0 and 100000000);
comment on column public.bookings.arrival_mode is '도보(walk) · 차량(car) · null = 안 적음';
comment on column public.bookings.car_plates is '차량번호 (공유 화면에는 안 보여요)';
comment on column public.bookings.car_fee is '판매 가격에 포함된 추가 차량 주차 금액';
comment on column public.bookings.walk_discount is '판매 가격에서 빠진 도보 할인 금액';

create or replace function private.keep_new_settings_keys()
returns trigger language plpgsql set search_path = '' as $$
declare k text;
begin
  if new.settings is null or old.settings is null then return new; end if;
  foreach k in array array['surchargeTiers', 'specialDates', 'stayTimes', 'extraHourFee', 'parking'] loop
    if not (new.settings ? k) and (old.settings ? k) then
      new.settings := new.settings || jsonb_build_object(k, old.settings -> k);
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.keep_new_settings_keys() from public, anon, authenticated;

-- 공유 화면: 도보/차량 · 대수만 (차량번호 · 주차 요금은 빼요)
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
      'settings', (h.settings - 'shopItems' - 'expenseCategories' - 'extraHourFee' - 'parking')
        || jsonb_build_object('parking', jsonb_build_object('enabled', coalesce((h.settings -> 'parking' -> 'enabled') = 'true'::jsonb, false))),
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
