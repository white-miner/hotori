-- 입실 · 퇴실 기본 시간 (settings.stayTimes = {checkIn: "16:00", checkOut: "12:00"})
-- 예전 화면이 settings를 통째로 저장해도 새 키가 지워지지 않도록 보존 목록에 추가해요.
create or replace function private.keep_new_settings_keys()
returns trigger language plpgsql set search_path = '' as $$
declare k text;
begin
  if new.settings is null or old.settings is null then return new; end if;
  foreach k in array array['surchargeTiers', 'specialDates', 'stayTimes'] loop
    if not (new.settings ? k) and (old.settings ? k) then
      new.settings := new.settings || jsonb_build_object(k, old.settings -> k);
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.keep_new_settings_keys() from public, anon, authenticated;
