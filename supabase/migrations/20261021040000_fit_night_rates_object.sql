-- STRUCTURAL FIX: trigger private.fit_night_rates still assumed legacy JSON **array**
-- (jsonb_array_length / jsonb_array_elements). Client writes StayNightRates **object**
-- { flat?, weekday?, weekend?, nights: { "YYYY-MM-DD": amount } }.
-- CHECK bookings_night_rates_shape was already updated to object (#30), but this
-- BEFORE INSERT/UPDATE trigger still ran first → Postgres 22023
-- "cannot get array length of a non-array" on any priced 2+ night save
-- (and on 1-night if OR does not short-circuit). User toast: 「저장하지 못했어요」.

create or replace function private.fit_night_rates()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.night_rates is null then
    return new;
  end if;

  -- Non-stay never keeps night_rates
  if new.kind <> 'stay' then
    new.night_rates := null;
    return new;
  end if;

  -- Current client shape: object
  if jsonb_typeof(new.night_rates) = 'object' then
    if pg_column_size(new.night_rates) > 8000 then
      raise exception 'night_rates: 요금 정보가 너무 커요'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Legacy array payload (pre-object matrix): drop — client no longer writes arrays
  new.night_rates := null;
  return new;
end
$function$;

comment on function private.fit_night_rates() is
  'Normalize bookings.night_rates: keep StayNightRates objects; null legacy arrays / non-stay';
