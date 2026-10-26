-- 손해내역서 발급 기록 (P1.2b) — stay-bound · ≠ invoice_issues

create table public.damage_issues (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'issued')),
  booking_id uuid references public.bookings(id) on delete set null,
  guest_name text not null default '',
  guest_phone text not null default '',
  room_no text not null default '',
  type_label text not null default '',
  notes text not null default '',
  lines jsonb not null default '[]'::jsonb,
  total int not null default 0 check (total >= 0),
  snapshot jsonb,
  issued_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint damage_issues_snapshot_when_issued check (
    status = 'draft' or (snapshot is not null and issued_at is not null)
  )
);
comment on table public.damage_issues is '손해내역서 · issue 시 snapshot 동결 (청구서/견적과 별도)';
create index damage_issues_hotel_created_idx on public.damage_issues(hotel_id, created_at desc);
create index damage_issues_hotel_booking_idx on public.damage_issues(hotel_id, booking_id);

create or replace function private.touch_damage_issue()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null or current_user in ('authenticated', 'anon') then
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
    if old.status = 'issued' then
      new.status := 'issued';
      new.snapshot := old.snapshot;
      new.issued_at := old.issued_at;
      new.lines := old.lines;
      new.total := old.total;
      new.booking_id := old.booking_id;
      new.guest_name := old.guest_name;
      new.guest_phone := old.guest_phone;
      new.room_no := old.room_no;
      new.type_label := old.type_label;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.touch_damage_issue() from public, anon, authenticated;
create trigger damage_issues_touch before insert or update on public.damage_issues
for each row execute function private.touch_damage_issue();

alter table public.damage_issues enable row level security;
create policy damage_issues_select on public.damage_issues for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy damage_issues_insert on public.damage_issues for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy damage_issues_update on public.damage_issues for update to authenticated
  using ((select private.is_hotel_member(hotel_id)))
  with check ((select private.is_hotel_member(hotel_id)));
create policy damage_issues_delete on public.damage_issues for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));
revoke all on public.damage_issues from anon, authenticated;
grant select, insert, delete on public.damage_issues to authenticated;
grant update (
  status, booking_id, guest_name, guest_phone, room_no, type_label, notes,
  lines, total, snapshot, issued_at, updated_at
) on public.damage_issues to authenticated;
