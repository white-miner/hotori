-- HOTORI v3 · 예약 장부 스키마
-- 호텔 1곳 = hotels 1줄. 층·방·타입·플랫폼 설정은 hotels.settings(JSONB)에 두고, 예약은 bookings에 한 줄씩 둬요.
-- 모든 테이블은 RLS로 "내가 속한 호텔"만 보이게 해요.

create table public.hotels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  plan text not null default 'free' check (plan in ('free', 'pro')),
  is_demo boolean not null default false,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hotel_members (
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (hotel_id, user_id)
);
create index hotel_members_user_idx on public.hotel_members(user_id);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  kind text not null check (kind in ('stay', 'dayuse')),
  status text not null default 'active' check (status in ('active', 'cancelled', 'noshow')),
  platform_id text not null check (char_length(platform_id) between 1 and 40),
  price integer not null check (price between 0 and 100000000),
  guest_name text not null check (char_length(guest_name) between 1 and 60),
  type_id text not null check (char_length(type_id) between 1 and 40),
  room_id text check (room_id is null or char_length(room_id) between 1 and 40),
  check_in date not null,
  nights smallint check (nights is null or nights between 1 and 90),
  start_time time,
  end_time time,
  arrived boolean not null default false,
  memo text check (memo is null or char_length(memo) <= 200),
  cancelled_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stay_has_nights check (kind <> 'stay' or (nights is not null and start_time is null and end_time is null)),
  constraint dayuse_has_time check (kind <> 'dayuse' or (nights is null and start_time is not null and end_time is not null and start_time <> end_time))
);
create index bookings_hotel_checkin_idx on public.bookings(hotel_id, check_in);

-- 누가 언제 고쳤는지: updated_at / updated_by 자동 기록, 취소 시각 자동 기록
create or replace function public.touch_booking()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.status <> 'active' and (tg_op = 'INSERT' or old.status = 'active') then
    new.cancelled_at := now();
  elsif new.status = 'active' then
    new.cancelled_at := null;
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.hotel_id := old.hotel_id;
  end if;
  return new;
end $$;
create trigger bookings_touch before insert or update on public.bookings
for each row execute function public.touch_booking();

create or replace function public.touch_hotel()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger hotels_touch before update on public.hotels
for each row execute function public.touch_hotel();

-- 멤버 확인 (RLS 안에서 재귀 없이 쓰려고 security definer)
create or replace function public.is_hotel_member(hid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hotel_members m
    where m.hotel_id = hid and m.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_hotel_member(uuid) from public, anon;
grant execute on function public.is_hotel_member(uuid) to authenticated;

alter table public.hotels enable row level security;
alter table public.hotel_members enable row level security;
alter table public.bookings enable row level security;

create policy hotels_select on public.hotels for select to authenticated
  using ((select public.is_hotel_member(id)));
create policy hotels_update on public.hotels for update to authenticated
  using ((select public.is_hotel_member(id))) with check ((select public.is_hotel_member(id)));

create policy members_select on public.hotel_members for select to authenticated
  using (user_id = (select auth.uid()));

create policy bookings_select on public.bookings for select to authenticated
  using ((select public.is_hotel_member(hotel_id)));
create policy bookings_insert on public.bookings for insert to authenticated
  with check ((select public.is_hotel_member(hotel_id)));
create policy bookings_update on public.bookings for update to authenticated
  using ((select public.is_hotel_member(hotel_id))) with check ((select public.is_hotel_member(hotel_id)));
create policy bookings_delete on public.bookings for delete to authenticated
  using ((select public.is_hotel_member(hotel_id)));

-- 요금제(plan)·예시 여부는 사용자가 직접 못 바꿔요. 이름과 설정만 수정 가능.
revoke all on public.hotels from anon, authenticated;
grant select on public.hotels to authenticated;
grant update (name, settings) on public.hotels to authenticated;
revoke all on public.hotel_members from anon, authenticated;
grant select on public.hotel_members to authenticated;
revoke all on public.bookings from anon;
grant select, insert, update, delete on public.bookings to authenticated;

-- 가입 직후 호텔 만들기 (한 사람당 호텔 1곳)
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

-- 여러 기기 실시간 반영
alter publication supabase_realtime add table public.bookings;
alter publication supabase_realtime add table public.hotels;
