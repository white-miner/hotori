-- 시즌 요금 · 주말 요일: hotels.settings.typeSeasons / weekendDays
--   typeSeasons = { "<typeId>": [ { id, name, from, to, weekday, weekend } ] }  (타입마다 기간 겹침 없음 — 앱에서 검사)
--   weekendDays = [0..6] (일=0 … 토=6), 기본 [5, 6] (금·토 밤)
-- 새 테이블 없음: hotels 행의 기존 RLS(호텔 구성원만)가 그대로 적용돼요.
-- 예전 앱이 settings를 통째로 저장해도 두 키가 지워지지 않도록 보존 목록에 추가하고, 잘못된 JSON 타입은 막아요.

create or replace function private.keep_new_settings_keys()
returns trigger language plpgsql set search_path = '' as $$
declare
  k text;
begin
  if new.settings is null or old.settings is null then return new; end if;
  foreach k in array array[
    'surchargeTiers', 'specialDates', 'stayTimes', 'extraHourFee', 'parking', 'cardFeeRate',
    'dayuseDefaults', 'typeRates', 'typeRateOverrides', 'typeStopSell', 'typeAliases',
    'roomHolds', 'overbookSubs', 'hotelBiz', 'typeSeasons', 'weekendDays'
  ] loop
    if not (new.settings ? k) and (old.settings ? k) then
      new.settings := new.settings || jsonb_build_object(k, old.settings -> k);
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.keep_new_settings_keys() from public, anon, authenticated;

comment on function private.keep_new_settings_keys() is
  'Preserve newer hotels.settings keys (incl. typeSeasons, weekendDays) when an older client saves a partial settings object';

alter table public.hotels
  add constraint hotels_settings_type_seasons_object
    check (not (settings ? 'typeSeasons') or jsonb_typeof(settings -> 'typeSeasons') = 'object'),
  add constraint hotels_settings_weekend_days_array
    check (not (settings ? 'weekendDays') or jsonb_typeof(settings -> 'weekendDays') = 'array');
