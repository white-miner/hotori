-- 객실 임시마감(홀드): hotels.settings.roomHolds = [{id, roomId, from, to, note?, createdAt}]
-- 게스트 예약 아님 · 타입 판매중지(typeStopSell)와 별개.
-- 예전 앱이 settings를 통째로 저장해도 키가 지워지지 않도록 보존 목록에 추가.

create or replace function private.keep_new_settings_keys()
returns trigger language plpgsql set search_path = '' as $$
declare
  k text;
begin
  if new.settings is null or old.settings is null then return new; end if;
  foreach k in array array[
    'surchargeTiers', 'specialDates', 'stayTimes', 'extraHourFee', 'parking', 'cardFeeRate',
    'dayuseDefaults', 'typeRates', 'typeRateOverrides', 'typeStopSell', 'typeAliases', 'roomHolds'
  ] loop
    if not (new.settings ? k) and (old.settings ? k) then
      new.settings := new.settings || jsonb_build_object(k, old.settings -> k);
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.keep_new_settings_keys() from public, anon, authenticated;

comment on function private.keep_new_settings_keys() is
  'Preserve newer hotels.settings keys (incl. roomHolds) when an older client saves a partial settings object';
