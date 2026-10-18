-- 인원 추가금
--  · bookings.guests    = 인원 (null = 안 적음, 예전 예약·예전 앱)
--  · bookings.extra_fee = 판매 가격(price)에 들어 있는 추가 인원 금액 (null/0 = 없음). price는 그대로 총액이에요.
--  · 설정(hotels.settings): 타입마다 baseGuests·maxGuests·tierId, 위쪽에 surchargeTiers(추가 요금 등급)·specialDates(특별일)
--    예전 앱은 settings를 통째로 저장하면서 모르는 위쪽 키를 빼먹어요 → 저장 때 빠졌으면 예전 값을 그대로 둬요.
--    (타입 안의 새 칸은 예전 앱도 그대로 둬요: 타입 객체를 펼쳐서 저장해요)
alter table public.bookings
  add column guests smallint
    constraint bookings_guests_range check (guests is null or guests between 1 and 99),
  add column extra_fee integer
    constraint bookings_extra_fee_range check (extra_fee is null or extra_fee between 0 and 100000000);
comment on column public.bookings.guests is '인원 · null = 안 적음';
comment on column public.bookings.extra_fee is '판매 가격에 포함된 추가 인원 금액 · null = 없음';

create or replace function private.keep_new_settings_keys()
returns trigger language plpgsql set search_path = '' as $$
declare k text;
begin
  if new.settings is null or old.settings is null then return new; end if;
  foreach k in array array['surchargeTiers', 'specialDates'] loop
    if not (new.settings ? k) and (old.settings ? k) then
      new.settings := new.settings || jsonb_build_object(k, old.settings -> k);
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.keep_new_settings_keys() from public, anon, authenticated;
create trigger hotels_keep_new_settings_keys before update of settings on public.hotels
  for each row execute function private.keep_new_settings_keys();
