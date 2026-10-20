-- Fix: legacy bookings_night_rates_shape required a JSON array (len 2–90).
-- Client (PR #27) stores StayNightRates as an object:
--   { flat?, weekday?, weekend?, nights: { "YYYY-MM-DD": amount } }
-- Any priced standard-stay save wrote an object → check_violation → 「저장하지 못했어요」
-- (missed / past-date catch-up always fills nightRates via price/nights sync).

alter table public.bookings
  drop constraint if exists bookings_night_rates_shape;

alter table public.bookings
  add constraint bookings_night_rates_shape
  check (
    night_rates is null
    or (
      jsonb_typeof(night_rates) = 'object'
      and pg_column_size(night_rates) <= 8000
    )
  );

comment on column public.bookings.night_rates is
  '표준 숙박 방×밤 요금 객체 {flat?, weekday?, weekend?, nights:{date:amount}}. 장기 원장과 별개';
