-- 임시 배치(tentative)는 물리 방이 있을 때만. 미배정(타입 홀드)과 분리.
update public.bookings
  set tentative = false
  where tentative = true and room_id is null;

alter table public.bookings
  drop constraint if exists bookings_tentative_needs_room;

alter table public.bookings
  add constraint bookings_tentative_needs_room
  check (tentative = false or room_id is not null);

comment on column public.bookings.tentative is
  '임시 배치 · room_id 있을 때만 true (재고는 확정과 동일 점유). room_id null = 타입 홀드(미배정)이며 tentative 아님';
