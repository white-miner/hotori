-- 객실 이동: 한 숙박이 중간에 방을 옮겨요. 예약은 그대로 하나(장부 한 줄, 총액 그대로)이고 방 구간만 따로 적어요.
-- room_segments = [{"room": "r301", "nights": 1}, {"room": "r305", "nights": 3}]
--   · null이면 예전처럼 room_id 한 방에 전부 묵어요.
--   · 있으면 room_id는 늘 첫 구간 방이에요 (예전 화면·내보내기와 호환).
--   · 박수 합 = nights, 방 이름 1~40자, 이웃 구간은 다른 방, 2구간 이상. 서버가 확인해요.
alter table public.bookings add column room_segments jsonb
  constraint bookings_room_segments_array check (room_segments is null or jsonb_typeof(room_segments) = 'array');
comment on column public.bookings.room_segments is '객실 이동 구간 [{room, nights}] · null = room_id 한 방';

-- 저장 전에 맞추고 확인해요:
--  · 대실이거나 방이 없으면 지워요
--  · 예전 앱이 room_id만 바꾸면(구간은 그대로) 통째로 그 방으로 옮긴 걸로 봐요 → 구간 지움
--  · 예전 앱이 박수만 바꾸면 마지막 구간을 늘리거나 뒤에서부터 줄여요
--  · 이웃한 같은 방은 합치고, 하나만 남으면 지워요. room_id = 첫 구간 방
create or replace function private.fit_room_segments()
returns trigger language plpgsql set search_path = '' as $$
declare
  seg jsonb;
  outa jsonb := '[]'::jsonb;
  total int := 0;
  k int;
  r text;
  last_room text := null;
  last_n int := 0;
begin
  if new.room_segments is null then return new; end if;
  if new.kind <> 'stay' or new.room_id is null or new.nights is null then
    new.room_segments := null; return new;
  end if;
  if tg_op = 'UPDATE' and new.room_id is distinct from old.room_id and new.room_segments is not distinct from old.room_segments then
    new.room_segments := null; return new;
  end if;
  if jsonb_typeof(new.room_segments) <> 'array' or jsonb_array_length(new.room_segments) > 90 then
    raise exception 'room_segments: 구간 목록 형식이 아니에요' using errcode = 'check_violation';
  end if;
  for seg in select value from jsonb_array_elements(new.room_segments) loop
    if jsonb_typeof(seg) <> 'object' or jsonb_typeof(seg -> 'room') <> 'string' or jsonb_typeof(seg -> 'nights') <> 'number' then
      raise exception 'room_segments: 구간은 {room, nights} 이어야 해요' using errcode = 'check_violation';
    end if;
    r := seg ->> 'room';
    if char_length(r) not between 1 and 40 or (seg ->> 'nights') !~ '^[0-9]{1,2}$' then
      raise exception 'room_segments: 방 이름(1~40자)·박수(1~90)를 확인해 주세요' using errcode = 'check_violation';
    end if;
    k := (seg ->> 'nights')::int;
    if k < 1 then
      raise exception 'room_segments: 박수는 1박 이상이어야 해요' using errcode = 'check_violation';
    end if;
    -- 박수에 맞춰 자르기
    k := least(k, new.nights - total);
    exit when k <= 0;
    if r = last_room then
      last_n := last_n + k;
    else
      if last_room is not null then outa := outa || jsonb_build_array(jsonb_build_object('room', last_room, 'nights', last_n)); end if;
      last_room := r; last_n := k;
    end if;
    total := total + k;
  end loop;
  if last_room is null then new.room_segments := null; return new; end if;
  last_n := last_n + (new.nights - total); -- 모자라면 마지막 방에 더해요
  outa := outa || jsonb_build_array(jsonb_build_object('room', last_room, 'nights', last_n));
  if jsonb_array_length(outa) < 2 then
    new.room_id := last_room;
    new.room_segments := null;
    return new;
  end if;
  new.room_segments := outa;
  new.room_id := outa -> 0 ->> 'room';
  return new;
end $$;
revoke all on function private.fit_room_segments() from public, anon, authenticated;
create trigger bookings_room_segments before insert or update on public.bookings
for each row execute function private.fit_room_segments();

-- 공유 링크: 방 구간도 같이 보내요 (가격은 여전히 안 보내요)
create or replace function public.get_shared_status(share_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  hid uuid;
  d0 date := ((now() at time zone 'Asia/Seoul') - interval '6 hours')::date; -- 영업일(새벽 6시 기준)
begin
  if share_token is null or char_length(share_token) < 40 or char_length(share_token) > 64 then return null; end if;
  select s.hotel_id into hid
    from private.hotel_shares s join public.hotels h on h.id = s.hotel_id
    where s.token = share_token and s.enabled and h.plan = 'pro';
  if hid is null then return null; end if;
  return (
    select jsonb_build_object(
      'name', h.name,
      'today', d0,
      'settings', h.settings - 'shopItems',
      'bookings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', b.id, 'kind', b.kind, 'status', b.status, 'platform_id', b.platform_id,
          'guest_name', b.guest_name, 'type_id', b.type_id, 'room_id', b.room_id, 'room_segments', b.room_segments,
          'check_in', b.check_in, 'nights', b.nights, 'start_time', b.start_time,
          'end_time', b.end_time, 'arrived', b.arrived
        ) order by b.check_in)
        from public.bookings b
        where b.hotel_id = hid
          and b.check_in <= d0 + 14
          and b.check_in >= d0 - 91
          and (case when b.kind = 'stay' then b.check_in + b.nights::int > d0 - 1 else b.check_in >= d0 - 1 end)
      ), '[]'::jsonb)
    )
    from public.hotels h where h.id = hid
  );
end $$;
revoke all on function public.get_shared_status(text) from public;
grant execute on function public.get_shared_status(text) to anon, authenticated;
