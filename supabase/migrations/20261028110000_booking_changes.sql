-- HOTORI 현장 도우미 v2 §3·§9: 메모 + 변경 기록 (booking_changes)
--  · kind='note' 이 직원이 적은 메모, 나머지(money/room/rate/stay)는 앱이 결제·객실 추가·조기 퇴실 처리·연장 때 한 줄씩 남겨요
--  · 지울 수 없어요(삭제 정책 없음) · 메모 고정(pinned)만 바꿀 수 있어요
--  · 멱등: 다시 실행해도 안전해요 (if not exists / drop policy if exists)
create table if not exists public.booking_changes (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  group_id uuid references public.booking_groups(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  kind text not null default 'note' check (kind in ('note', 'money', 'room', 'rate', 'stay')),
  summary text not null check (char_length(summary) between 1 and 300),
  effective_on date,
  pinned boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.booking_changes is '메모 + 변경 기록 · 삭제 불가 · 메모 고정만 수정 가능';
create index if not exists booking_changes_hotel_created_idx on public.booking_changes(hotel_id, created_at desc);
create index if not exists booking_changes_group_idx on public.booking_changes(group_id, created_at desc) where group_id is not null;
create index if not exists booking_changes_booking_idx on public.booking_changes(booking_id, created_at desc) where booking_id is not null;

create or replace function private.touch_booking_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    -- 고정 여부만 바꿀 수 있어요
    new.hotel_id := old.hotel_id;
    new.group_id := old.group_id;
    new.booking_id := old.booking_id;
    new.kind := old.kind;
    new.summary := old.summary;
    new.effective_on := old.effective_on;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
revoke all on function private.touch_booking_change() from public, anon, authenticated;
drop trigger if exists booking_changes_touch on public.booking_changes;
create trigger booking_changes_touch before insert or update on public.booking_changes
for each row execute function private.touch_booking_change();

alter table public.booking_changes enable row level security;
drop policy if exists booking_changes_select on public.booking_changes;
create policy booking_changes_select on public.booking_changes for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
drop policy if exists booking_changes_insert on public.booking_changes;
create policy booking_changes_insert on public.booking_changes for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
drop policy if exists booking_changes_update on public.booking_changes;
create policy booking_changes_update on public.booking_changes for update to authenticated
  using ((select private.is_hotel_member(hotel_id)))
  with check ((select private.is_hotel_member(hotel_id)));
-- delete 정책 없음 = 아무도 지울 수 없어요
