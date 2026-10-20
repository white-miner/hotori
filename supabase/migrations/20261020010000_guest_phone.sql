-- 개인 예약 연락처 (Entry 이름–연락처 레이아웃)
alter table public.bookings
  add column if not exists guest_phone text null;
comment on column public.bookings.guest_phone is '손님 연락처 · Entry 이름 옆 · 최대 30자';
