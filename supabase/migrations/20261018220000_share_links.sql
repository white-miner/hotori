-- HOTORI · 현황 공유 링크 (Pro 전용)
-- 직원이 로그인 없이 현황판(객실 현황 14일 + 객실 배치 + 대실·방 미배정 목록)을 '보기만' 할 수 있는 링크예요.
-- · 토큰은 private 스키마에만 있어요 (API로 바로 못 읽어요). 주인(owner)만 아래 함수로 만들기·새로 만들기·끄기를 해요.
-- · 링크로 보는 함수(get_shared_status)는 요금제가 pro이고 공유가 켜져 있을 때만 데이터를 돌려줘요.
--   그래서 Free로 내려가면 기존 링크도 바로 막혀요.
-- · 돌려주는 예약에는 판매 가격·메모가 없어요. 테이블 RLS는 그대로예요.

create table if not exists private.hotel_shares (
  hotel_id uuid primary key references public.hotels(id) on delete cascade,
  token text not null unique check (char_length(token) >= 40),
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.hotel_shares enable row level security;
revoke all on private.hotel_shares from public, anon, authenticated;

-- 32바이트 무작위 → base64url (43글자)
create or replace function private.new_share_token()
returns text language sql volatile set search_path = '' as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
$$;
revoke all on function private.new_share_token() from public, anon, authenticated;

create or replace function private.is_hotel_owner(hid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hotel_members m
    where m.hotel_id = hid and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;
revoke all on function private.is_hotel_owner(uuid) from public, anon, authenticated;

-- 주인용: 지금 공유 상태 보기
create or replace function public.share_link_status(hid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  p text;
  sh private.hotel_shares%rowtype;
begin
  if not private.is_hotel_owner(hid) then raise exception 'not allowed' using errcode = '42501'; end if;
  select h.plan into p from public.hotels h where h.id = hid;
  select * into sh from private.hotel_shares s where s.hotel_id = hid;
  return jsonb_build_object(
    'plan', p,
    'enabled', coalesce(sh.enabled, false) and p = 'pro',
    'token', case when sh.enabled and p = 'pro' then sh.token end,
    'updatedAt', sh.updated_at
  );
end $$;

-- 주인용: 링크 만들기 / 새로 만들기(예전 링크는 바로 못 써요)
create or replace function public.share_link_create(hid uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  t text := private.new_share_token();
begin
  if not private.is_hotel_owner(hid) then raise exception 'not allowed' using errcode = '42501'; end if;
  if (select h.plan from public.hotels h where h.id = hid) is distinct from 'pro' then
    raise exception 'pro plan required' using errcode = '42501';
  end if;
  insert into private.hotel_shares (hotel_id, token, enabled, created_by)
  values (hid, t, true, (select auth.uid()))
  on conflict (hotel_id) do update
    set token = excluded.token, enabled = true, created_by = excluded.created_by, updated_at = now();
  return t;
end $$;

-- 주인용: 공유 끄기 (토큰도 바꿔 둬서 다시 켜도 예전 링크는 안 열려요)
create or replace function public.share_link_disable(hid uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_hotel_owner(hid) then raise exception 'not allowed' using errcode = '42501'; end if;
  update private.hotel_shares
    set enabled = false, token = private.new_share_token(), updated_at = now()
    where hotel_id = hid;
end $$;

-- 누구나(로그인 없이): 링크로 현황 보기. 맞지 않으면 null.
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
      'settings', h.settings,
      'bookings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', b.id, 'kind', b.kind, 'status', b.status, 'platform_id', b.platform_id,
          'guest_name', b.guest_name, 'type_id', b.type_id, 'room_id', b.room_id,
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

revoke all on function public.share_link_status(uuid) from public, anon;
revoke all on function public.share_link_create(uuid) from public, anon;
revoke all on function public.share_link_disable(uuid) from public, anon;
grant execute on function public.share_link_status(uuid) to authenticated;
grant execute on function public.share_link_create(uuid) to authenticated;
grant execute on function public.share_link_disable(uuid) to authenticated;
revoke all on function public.get_shared_status(text) from public;
grant execute on function public.get_shared_status(text) to anon, authenticated;
