-- 단체 예약: 방마다 예약 한 줄씩 그대로 두고 같은 group_id · group_name으로 묶어요
--  · 만들기: 여러 줄을 한 번에 insert (한 문장이라 모두 되거나 모두 안 돼요)
--  · 모두 입실 · 단체 취소 · 이름/날짜 바꾸기: update … where group_id = … (역시 한 문장)
--  · 예전 앱에는 그냥 따로따로인 예약으로 보여요 (새 칸은 비어 있어도 돼요)
alter table public.bookings
  add column group_id uuid,
  add column group_name text
    constraint bookings_group_name_len check (group_name is null or char_length(group_name) between 1 and 40),
  add constraint bookings_group_pair check ((group_id is null) = (group_name is null));
comment on column public.bookings.group_id is '단체 예약 묶음 id · null = 단체 아님';
comment on column public.bookings.group_name is '단체명 (묶음 안에서 같은 값)';
create index bookings_hotel_group_idx on public.bookings(hotel_id, group_id) where group_id is not null;
