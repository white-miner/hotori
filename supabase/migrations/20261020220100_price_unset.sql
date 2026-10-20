-- 간단 예약 · 금액미정: 판매가 미확정 플래그 (price는 0 유지 · UI는 「금액미정」)
alter table public.bookings
  add column if not exists price_unset boolean not null default false;

comment on column public.bookings.price_unset is
  'true = 판매가 미확정(금액미정). price는 0으로 두며 잔금·완납 계산은 확정 전까지 보류.';
