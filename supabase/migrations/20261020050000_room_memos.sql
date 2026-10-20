-- 객실 특이사항: 「지금」보드 말풍선 · 호텔 스코프
-- 인수인계(handoff) Next: 미해결 특이사항(kind=issue) + 전달사항(kind=delivery) · 해결/미해결(status)
-- room_id = hotels.settings 안의 방 id (JSON이라 FK 없음)
-- UI 라벨 「특이사항」(테이블명 room_memos는 기술 식별자)

create table public.room_memos (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  room_id text not null check (char_length(trim(room_id)) between 1 and 40),
  body text not null check (char_length(trim(body)) between 1 and 120),
  status text not null default 'open' check (status in ('open', 'resolved')),
  kind text not null default 'issue' check (kind in ('issue', 'delivery')),
  resolved_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_memos_resolved_consistency check (
    (status = 'open' and resolved_at is null)
    or (status = 'resolved' and resolved_at is not null)
  )
);
comment on table public.room_memos is '객실 특이사항 (호텔 멤버만) — 「지금」말풍선 · 인수인계용 미해결 특이사항·전달사항';
comment on column public.room_memos.room_id is 'settings floors[].rooms[].id';
comment on column public.room_memos.status is 'open 미해결 · resolved 해결';
comment on column public.room_memos.kind is 'issue 특이사항 · delivery 전달사항';
create index room_memos_hotel_room_idx on public.room_memos(hotel_id, room_id);
create index room_memos_hotel_open_idx on public.room_memos(hotel_id, room_id) where status = 'open';
create index room_memos_hotel_kind_open_idx on public.room_memos(hotel_id, kind) where status = 'open';
create index room_memos_created_by_idx on public.room_memos(created_by);
create index room_memos_updated_by_idx on public.room_memos(updated_by);

create or replace function private.touch_room_memo()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null or current_user in ('authenticated', 'anon') then
    new.updated_by := auth.uid();
    new.updated_at := now();
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      new.created_at := now();
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.hotel_id := old.hotel_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  -- 해결/미해결 전환 시 resolved_at 맞춤
  if new.status = 'open' then
    new.resolved_at := null;
  elsif new.status = 'resolved' and new.resolved_at is null then
    new.resolved_at := now();
  end if;
  return new;
end $$;
revoke all on function private.touch_room_memo() from public, anon, authenticated;
create trigger room_memos_touch before insert or update on public.room_memos
for each row execute function private.touch_room_memo();

alter table public.room_memos enable row level security;
create policy room_memos_select on public.room_memos for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy room_memos_insert on public.room_memos for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy room_memos_update on public.room_memos for update to authenticated
  using ((select private.is_hotel_member(hotel_id)))
  with check ((select private.is_hotel_member(hotel_id)));
create policy room_memos_delete on public.room_memos for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));
revoke all on public.room_memos from anon, authenticated;
grant select, insert, delete on public.room_memos to authenticated;
grant update (room_id, body, status, kind, resolved_at) on public.room_memos to authenticated;

alter publication supabase_realtime add table public.room_memos;
