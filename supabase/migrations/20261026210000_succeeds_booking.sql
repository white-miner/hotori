-- Cross-name 연박 연결: B.succeeds_booking_id → prior stay A
--  · Two bookings stay separate (OTA id · name · payments)
--  · Same room + continuous nights applied in app (shared/succeedStay.ts)
--  · Not group_id (parallel rooms) · not amend-extend of A

alter table public.bookings
  add column if not exists succeeds_booking_id uuid
    references public.bookings(id) on delete set null;

comment on column public.bookings.succeeds_booking_id is
  '연박 연결: 이 예약이 이어받는 이전 투숙 booking id · null = 단독. 이름·결제는 합치지 않음';

create index if not exists bookings_succeeds_booking_idx
  on public.bookings(succeeds_booking_id)
  where succeeds_booking_id is not null;

-- Self-link / cycle guard (simple: cannot succeed self)
alter table public.bookings drop constraint if exists bookings_succeeds_not_self;
alter table public.bookings
  add constraint bookings_succeeds_not_self
  check (succeeds_booking_id is null or succeeds_booking_id <> id);
