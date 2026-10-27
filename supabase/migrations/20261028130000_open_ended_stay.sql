-- HOTORI 현장 도우미 v2 §8: 열린 숙박 (끝 날짜 없이 계속 묵음)
--  · open_ended: 켜면 앱이 열릴 때 퇴실일이 지난 숙박을 "오늘 밤 + hold_ahead일"까지 이어 놓아요 (결제 주기가 아니에요)
--  · hold_ahead: 방 보호 버퍼(일). 0이면 오늘 밤까지만
--  · 멱등 · 열 2개만 추가 (RLS·정책·기존 값은 그대로)
alter table public.bookings add column if not exists open_ended boolean not null default false;
alter table public.bookings add column if not exists hold_ahead smallint not null default 1;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_hold_ahead_check' and conrelid = 'public.bookings'::regclass) then
    alter table public.bookings add constraint bookings_hold_ahead_check check (hold_ahead between 0 and 30);
  end if;
end $$;
comment on column public.bookings.open_ended is '열린 숙박: 앱이 오늘 밤까지 따라가며 박수를 늘려요 (결제 주기 아님)';
comment on column public.bookings.hold_ahead is '열린 숙박의 방 보호 버퍼(일, 0~30)';
