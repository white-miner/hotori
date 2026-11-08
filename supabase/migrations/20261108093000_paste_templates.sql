-- 스마트등록 붙여넣기 양식: hotels.settings.pasteTemplates
--   [ { platformId, profileId?, version: 1, labels: { reservationId, guestName, ... } } ]
-- 칸 이름만 저장한다. 손님 글은 넣지 않는다.
-- 새 테이블 없음. 호텔 구성원 RLS가 그대로 적용된다.
-- 예전 화면이 settings를 통째로 저장해도 이 키가 지워지지 않게 보존 목록에 넣는다.

create or replace function private.keep_new_settings_keys()
returns trigger language plpgsql set search_path = '' as $$
declare
  k text;
begin
  if new.settings is null or old.settings is null then return new; end if;
  foreach k in array array[
    'surchargeTiers', 'specialDates', 'stayTimes', 'extraHourFee', 'parking', 'cardFeeRate',
    'dayuseDefaults', 'typeRates', 'typeRateOverrides', 'typeStopSell', 'typeAliases',
    'roomHolds', 'overbookSubs', 'hotelBiz', 'typeSeasons', 'weekendDays', 'pasteTemplates'
  ] loop
    if not (new.settings ? k) and (old.settings ? k) then
      new.settings := new.settings || jsonb_build_object(k, old.settings -> k);
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.keep_new_settings_keys() from public, anon, authenticated;

comment on function private.keep_new_settings_keys() is
  'Preserve newer hotels.settings keys (incl. pasteTemplates) when an older client saves a partial settings object';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hotels_settings_paste_templates_array'
  ) then
    alter table public.hotels
      add constraint hotels_settings_paste_templates_array
      check (not (settings ? 'pasteTemplates') or jsonb_typeof(settings -> 'pasteTemplates') = 'array');
  end if;
end $$;
