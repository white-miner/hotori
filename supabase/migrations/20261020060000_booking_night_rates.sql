-- 표준 숙박: 방별·밤별 요금 스냅샷 (단체·개인 공용)
-- shape: { flat?, weekday?, weekend?, nights: { "YYYY-MM-DD": amount } }
-- 총액 진실(행렬 있을 때) = Σ nights + 가산분. 장기 booking_night_charges 와 별축.

alter table public.bookings
  add column if not exists night_rates jsonb null;

comment on column public.bookings.night_rates is
  '표준 숙박 방×밤 요금 {flat?, weekday?, weekend?, nights:{date:amount}}. 장기 원장과 별개';
