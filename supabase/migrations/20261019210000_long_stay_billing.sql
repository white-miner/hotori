-- 장기숙박(퇴실 미정): stay_mode · 요금표 · 박별 누적 원장 · 정산 주기
--  · nights는 재고 확정 창만 (NULL 금지 — 기존 stay 제약 유지)
--  · 청구 진실 = booking_night_charges 합 − booking_payments 합
--  · bookings.price 는 장기에서 누적 합 캐시(총액 진실 아님)

alter table public.bookings
  add column stay_mode text not null default 'standard'
    check (stay_mode in ('standard', 'long_stay'));
comment on column public.bookings.stay_mode is '숙박 유형: standard(일반) · long_stay(장기·퇴실 미정)';

alter table public.bookings
  add column long_stay_rate jsonb null;
comment on column public.bookings.long_stay_rate is '장기 요금표 {kind:flat|dow, flatAmount?, dowAmounts?, currency:KRW}';

alter table public.bookings
  add column settle_cycle text null
    check (settle_cycle is null or settle_cycle in ('weekly', 'adhoc'));
comment on column public.bookings.settle_cycle is '장기 정산 주기: weekly(기본) · adhoc(수시만). 일반은 null';

-- 박별 누적 원장 (1급)
create table public.booking_night_charges (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  night_date date not null,
  amount integer not null check (amount between 0 and 100000000),
  created_at timestamptz not null default now(),
  unique (booking_id, night_date)
);
comment on table public.booking_night_charges is '장기 박별 청구 줄. 미수 = 합 − booking_payments. 정산해도 줄을 지우지 않음';
create index booking_night_charges_booking_idx on public.booking_night_charges(booking_id);
create index booking_night_charges_hotel_idx on public.booking_night_charges(hotel_id, night_date);

create or replace function private.fit_booking_night_charge()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.hotel_id := (select b.hotel_id from public.bookings b where b.id = new.booking_id);
  new.created_at := coalesce(new.created_at, now());
  return new;
end $$;
revoke all on function private.fit_booking_night_charge() from public, anon, authenticated;
create trigger booking_night_charges_fit before insert on public.booking_night_charges
for each row execute function private.fit_booking_night_charge();

create or replace function private.bump_booking_for_night_charge()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.bookings set updated_at = now() where id = coalesce(new.booking_id, old.booking_id);
  return null;
end $$;
revoke all on function private.bump_booking_for_night_charge() from public, anon, authenticated;
create trigger booking_night_charges_bump after insert or delete on public.booking_night_charges
for each row execute function private.bump_booking_for_night_charge();

alter table public.booking_night_charges enable row level security;
create policy booking_night_charges_select on public.booking_night_charges for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy booking_night_charges_insert on public.booking_night_charges for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy booking_night_charges_delete on public.booking_night_charges for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));
revoke all on public.booking_night_charges from anon, authenticated;
grant select, insert, delete on public.booking_night_charges to authenticated;

-- 공유 화면: 장기 뱃지용 stay_mode 전달 (금액·원장은 공유에 안 넣음)
create or replace function public.get_shared_status(share_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  hid uuid;
  d0 date := ((now() at time zone 'Asia/Seoul') - interval '6 hours')::date;
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
          'checked_out_at', b.checked_out_at,
          'stay_mode', b.stay_mode
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
