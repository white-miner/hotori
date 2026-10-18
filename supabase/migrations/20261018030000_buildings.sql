-- HOTORI v3b · 건물(본관·별관·A동…) 단계 추가: 호텔 → 건물 → 층 → 방
-- 층·방 설정은 계속 hotels.settings(JSONB)에 있어요. 여기에 buildings 배열과 floors[].buildingId를 더해요.
-- 기존 층·방·색·예약(bookings.room_id)은 하나도 바꾸지 않아요. 방 id가 호텔 안에서 유일해서
-- 건물이 달라도 같은 방 번호(본관 201 · 별관 201)를 쓸 수 있어요.
-- 건물 정보가 없던 호텔은 '본관'(id b-main) 하나에 모든 층이 들어가요. 앱(normalizeSettings)도 같은 규칙으로 읽어요.

-- 1) 바꾸기 전 설정을 private 스키마에 백업 (API에 노출되지 않아요)
create table if not exists private.hotel_settings_backup (
  hotel_id uuid not null,
  settings jsonb not null,
  reason text not null,
  backed_up_at timestamptz not null default now()
);
alter table private.hotel_settings_backup enable row level security;
revoke all on private.hotel_settings_backup from public, anon, authenticated;

insert into private.hotel_settings_backup (hotel_id, settings, reason)
select id, settings, '20261018030000_buildings'
from public.hotels;

-- 2) 건물 채우기 (이미 있으면 그대로, 모르는 건물을 가리키는 층은 첫 건물로)
create or replace function private.with_default_building(s jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  with b as (
    select case
      when jsonb_typeof(s -> 'buildings') = 'array' and jsonb_array_length(s -> 'buildings') > 0 then s -> 'buildings'
      else '[{"id": "b-main", "name": "본관"}]'::jsonb
    end as bs
  )
  select jsonb_set(
    jsonb_set(s, '{buildings}', b.bs),
    '{floors}',
    coalesce((
      select jsonb_agg(
        case
          when jsonb_typeof(f.v) <> 'object' then f.v
          when jsonb_typeof(f.v -> 'buildingId') = 'string'
               and exists (select 1 from jsonb_array_elements(b.bs) x where x ->> 'id' = f.v ->> 'buildingId') then f.v
          else f.v || jsonb_build_object('buildingId', b.bs -> 0 ->> 'id')
        end
        order by f.ord)
      from jsonb_array_elements(case when jsonb_typeof(s -> 'floors') = 'array' then s -> 'floors' else '[]'::jsonb end)
        with ordinality as f(v, ord)
    ), '[]'::jsonb)
  )
  from b
$$;
revoke all on function private.with_default_building(jsonb) from public, anon, authenticated;

update public.hotels
set settings = private.with_default_building(settings)
where settings is distinct from private.with_default_building(settings);

-- buildings가 있으면 배열이어야 해요 (예전 앱이 buildings 없이 저장해도 통과 → 앱이 '본관'으로 읽어요)
alter table public.hotels
  add constraint hotels_settings_buildings_array
  check (not (settings ? 'buildings') or jsonb_typeof(settings -> 'buildings') = 'array');

-- 3) 새 호텔도 '본관' 하나로 시작
create or replace function public.create_hotel(hotel_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  hid uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select m.hotel_id into hid from public.hotel_members m where m.user_id = uid limit 1;
  if hid is not null then return hid; end if;
  insert into public.hotels (name, settings)
  values (
    coalesce(nullif(btrim(hotel_name), ''), '우리 호텔'),
    jsonb_build_object(
      'lowThreshold', 2,
      'buildings', jsonb_build_array(jsonb_build_object('id', 'b-main', 'name', '본관')),
      'floors', '[]'::jsonb,
      'types', '[]'::jsonb,
      'platforms', jsonb_build_array(
        jsonb_build_object('id','p1','name','야놀자','abbr','야'),
        jsonb_build_object('id','p2','name','여기어때','abbr','여'),
        jsonb_build_object('id','p3','name','아고다','abbr','아'),
        jsonb_build_object('id','p4','name','부킹닷컴','abbr','부'),
        jsonb_build_object('id','p5','name','네이버','abbr','네'),
        jsonb_build_object('id','p6','name','현장·전화','abbr','현')
      )
    )
  )
  returning id into hid;
  insert into public.hotel_members (hotel_id, user_id, role) values (hid, uid, 'owner');
  return hid;
end $$;
revoke all on function public.create_hotel(text) from public, anon;
grant execute on function public.create_hotel(text) to authenticated;
