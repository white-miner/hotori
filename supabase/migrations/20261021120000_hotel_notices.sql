-- 호텔 전체 공지 (탑바 ClipboardList) · Threads식 텍스트 피드
-- status: open 미해결 · in_progress 진행중 · resolved 해결
-- 배지 = open+in_progress (확인/ack와 무관). receipts = 선택 스탬프만
-- Bell/room_memos.issue 특이사항 · room_memos.delivery 인수인계는 그대로

create table public.hotel_notices (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 280),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  resolved_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_notices_resolved_consistency check (
    (status in ('open', 'in_progress') and resolved_at is null)
    or (status = 'resolved' and resolved_at is not null)
  )
);
comment on table public.hotel_notices is '호텔 전체 공지 (멤버만) — 탑바 공지 피드 · room_id 없음';
comment on column public.hotel_notices.status is 'open 미해결 · in_progress 진행중 · resolved 해결';
create index hotel_notices_hotel_created_idx on public.hotel_notices(hotel_id, created_at desc);
create index hotel_notices_hotel_unresolved_idx on public.hotel_notices(hotel_id)
  where status in ('open', 'in_progress');
create index hotel_notices_created_by_idx on public.hotel_notices(created_by);
create index hotel_notices_updated_by_idx on public.hotel_notices(updated_by);

create table public.hotel_notice_receipts (
  notice_id uuid not null references public.hotel_notices(id) on delete cascade,
  staff_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz,
  acked_at timestamptz,
  primary key (notice_id, staff_id)
);
comment on table public.hotel_notice_receipts is '공지 읽음/확인 스탬프 (배지와 무관 · 공용 계정 MVP-lite)';
create index hotel_notice_receipts_staff_idx on public.hotel_notice_receipts(staff_id);

create or replace function private.touch_hotel_notice()
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
  if new.status = 'resolved' then
    if new.resolved_at is null then new.resolved_at := now(); end if;
  else
    new.resolved_at := null;
  end if;
  return new;
end $$;
revoke all on function private.touch_hotel_notice() from public, anon, authenticated;
create trigger hotel_notices_touch before insert or update on public.hotel_notices
for each row execute function private.touch_hotel_notice();

alter table public.hotel_notices enable row level security;
create policy hotel_notices_select on public.hotel_notices for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy hotel_notices_insert on public.hotel_notices for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy hotel_notices_update on public.hotel_notices for update to authenticated
  using ((select private.is_hotel_member(hotel_id)))
  with check ((select private.is_hotel_member(hotel_id)));
create policy hotel_notices_delete on public.hotel_notices for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));
revoke all on public.hotel_notices from anon, authenticated;
grant select, insert, delete on public.hotel_notices to authenticated;
grant update (body, status, resolved_at) on public.hotel_notices to authenticated;

alter table public.hotel_notice_receipts enable row level security;
create policy hotel_notice_receipts_select on public.hotel_notice_receipts for select to authenticated
  using (
    exists (
      select 1 from public.hotel_notices n
      where n.id = notice_id and (select private.is_hotel_member(n.hotel_id))
    )
  );
create policy hotel_notice_receipts_insert on public.hotel_notice_receipts for insert to authenticated
  with check (
    staff_id = (select auth.uid())
    and exists (
      select 1 from public.hotel_notices n
      where n.id = notice_id and (select private.is_hotel_member(n.hotel_id))
    )
  );
create policy hotel_notice_receipts_update on public.hotel_notice_receipts for update to authenticated
  using (staff_id = (select auth.uid()))
  with check (staff_id = (select auth.uid()));
create policy hotel_notice_receipts_delete on public.hotel_notice_receipts for delete to authenticated
  using (staff_id = (select auth.uid()));
revoke all on public.hotel_notice_receipts from anon, authenticated;
grant select, insert, delete on public.hotel_notice_receipts to authenticated;
grant update (read_at, acked_at) on public.hotel_notice_receipts to authenticated;

alter publication supabase_realtime add table public.hotel_notices;
