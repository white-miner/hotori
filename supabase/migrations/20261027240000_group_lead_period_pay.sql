-- 단체 대장 객실 지정 + 기간별 결제(몇 박을 냈는지) 표시
--  · booking_groups.lead_booking_id : 대장 객실(예약)을 직원이 지정. null = 앱이 자동으로 고름(투숙 중인 방 우선)
--  · booking_payments.night_date    : 이 결제가 덮는 첫 박 (기존 열 · 라이브 DB엔 이미 있어서 if not exists)
--  · booking_payments.period_nights : 그 첫 박부터 몇 박을 낸 결제인지. night_date·period_nights 둘 다 null = 예전 방식(맨 앞 미결제 박부터 채움)
-- 새 테이블 없음 → 기존 RLS(호텔 구성원만)가 그대로 적용돼요. 기존 행은 바뀌지 않아요.

alter table public.booking_groups
  add column if not exists lead_booking_id uuid references public.bookings(id) on delete set null;
comment on column public.booking_groups.lead_booking_id is
  '단체 대장 객실(예약). null = 앱이 자동 선택(투숙 중 > 수납 많은 순). 예약이 지워지면 null';
create index if not exists booking_groups_lead_booking_idx
  on public.booking_groups(lead_booking_id) where lead_booking_id is not null;

alter table public.booking_payments
  add column if not exists night_date date,
  add column if not exists period_nights smallint;
comment on column public.booking_payments.period_nights is
  '기간 결제: night_date부터 이 박수만큼 낸 결제. null = 기간 표시 없음(예전 결제)';
alter table public.booking_payments drop constraint if exists booking_payments_period_nights_check;
alter table public.booking_payments
  add constraint booking_payments_period_nights_check
  check (period_nights is null or (period_nights between 1 and 366 and night_date is not null));
