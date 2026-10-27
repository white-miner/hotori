-- HOTORI 현장 도우미 v2: 장기·열린 숙박을 위해 예약 박수 상한 90 → 366.
-- 멱등 · RLS/정책은 건드리지 않아요 (제약 조건만 교체). 운영 적용은 사람이 확인한 뒤에 해요.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'bookings_nights_check' and conrelid = 'public.bookings'::regclass) then
    alter table public.bookings drop constraint bookings_nights_check;
  end if;
  alter table public.bookings
    add constraint bookings_nights_check check (nights is null or nights between 1 and 366);
end $$;
