-- 견적서 · 청구서 발급 기록 (P1.1 / P1.2a)
-- Issue = frozen snapshot; reprint from snapshot only.

create table public.quote_issues (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'issued')),
  title text not null default '',
  client_name text not null default '',
  client_phone text not null default '',
  notes text not null default '',
  check_in date,
  nights int not null default 0 check (nights >= 0 and nights <= 365),
  guest_count int not null default 0 check (guest_count >= 0 and guest_count <= 9999),
  lines jsonb not null default '[]'::jsonb,
  total int not null default 0 check (total >= 0),
  show_room_nos boolean not null default false,
  group_id uuid references public.booking_groups(id) on delete set null,
  booking_ids uuid[] not null default '{}',
  snapshot jsonb,
  issued_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.quote_issues is '견적서 draft/issued · issued 시 snapshot 동결';
create index quote_issues_hotel_created_idx on public.quote_issues(hotel_id, created_at desc);
create index quote_issues_hotel_status_idx on public.quote_issues(hotel_id, status);

create or replace function private.touch_quote_issue()
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
    -- issued row: freeze identity fields from overwrite races
    if old.status = 'issued' then
      new.status := 'issued';
      new.snapshot := old.snapshot;
      new.issued_at := old.issued_at;
      new.total := old.total;
      new.lines := old.lines;
      new.show_room_nos := old.show_room_nos;
      -- allow linking group/bookings once after issue
      if old.group_id is not null then new.group_id := old.group_id; end if;
      if coalesce(array_length(old.booking_ids, 1), 0) > 0 then new.booking_ids := old.booking_ids; end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.touch_quote_issue() from public, anon, authenticated;
create trigger quote_issues_touch before insert or update on public.quote_issues
for each row execute function private.touch_quote_issue();

alter table public.quote_issues enable row level security;
create policy quote_issues_select on public.quote_issues for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy quote_issues_insert on public.quote_issues for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy quote_issues_update on public.quote_issues for update to authenticated
  using ((select private.is_hotel_member(hotel_id)))
  with check ((select private.is_hotel_member(hotel_id)));
create policy quote_issues_delete on public.quote_issues for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));
revoke all on public.quote_issues from anon, authenticated;
grant select, insert, delete on public.quote_issues to authenticated;
grant update (
  status, title, client_name, client_phone, notes, check_in, nights, guest_count,
  lines, total, show_room_nos, group_id, booking_ids, snapshot, issued_at, updated_at
) on public.quote_issues to authenticated;
create index quote_issues_hotel_group_idx on public.quote_issues(hotel_id, group_id);

-- 청구번호 연도별 카운터
create table public.invoice_issue_counters (
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  year int not null check (year >= 2000 and year <= 2100),
  last_n int not null default 0 check (last_n >= 0),
  primary key (hotel_id, year)
);
comment on table public.invoice_issue_counters is '청구서 일련번호 YYYY-NNN per hotel·year';
alter table public.invoice_issue_counters enable row level security;
create policy invoice_issue_counters_select on public.invoice_issue_counters for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy invoice_issue_counters_insert on public.invoice_issue_counters for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy invoice_issue_counters_update on public.invoice_issue_counters for update to authenticated
  using ((select private.is_hotel_member(hotel_id)))
  with check ((select private.is_hotel_member(hotel_id)));
revoke all on public.invoice_issue_counters from anon, authenticated;
grant select, insert, update on public.invoice_issue_counters to authenticated;

create or replace function public.alloc_invoice_number(p_hotel_id uuid, p_year int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not private.is_hotel_member(p_hotel_id) then
    raise exception 'not a hotel member';
  end if;
  insert into public.invoice_issue_counters (hotel_id, year, last_n)
  values (p_hotel_id, p_year, 1)
  on conflict (hotel_id, year) do update
    set last_n = public.invoice_issue_counters.last_n + 1
  returning last_n into n;
  return p_year::text || '-' || lpad(n::text, 3, '0');
end $$;
revoke all on function public.alloc_invoice_number(uuid, int) from public, anon;
grant execute on function public.alloc_invoice_number(uuid, int) to authenticated;

create table public.invoice_issues (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'issued')),
  issue_number text,
  group_id uuid references public.booking_groups(id) on delete set null,
  booking_ids uuid[] not null default '{}',
  payer_name text not null default '',
  payer_phone text not null default '',
  is_mid_stay boolean not null default false,
  snapshot jsonb,
  issued_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_issues_number_when_issued check (
    status = 'draft' or (issue_number is not null and snapshot is not null and issued_at is not null)
  )
);
comment on table public.invoice_issues is '청구서 · issue 시 snapshot+청구번호 동결 (손해내역서 아님)';
create index invoice_issues_hotel_created_idx on public.invoice_issues(hotel_id, created_at desc);
create index invoice_issues_hotel_group_idx on public.invoice_issues(hotel_id, group_id);
create unique index invoice_issues_hotel_number_uidx
  on public.invoice_issues(hotel_id, issue_number)
  where issue_number is not null;

create or replace function private.touch_invoice_issue()
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
      new.issue_number := old.issue_number;
      new.snapshot := old.snapshot;
      new.issued_at := old.issued_at;
      new.group_id := old.group_id;
      new.booking_ids := old.booking_ids;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.touch_invoice_issue() from public, anon, authenticated;
create trigger invoice_issues_touch before insert or update on public.invoice_issues
for each row execute function private.touch_invoice_issue();

alter table public.invoice_issues enable row level security;
create policy invoice_issues_select on public.invoice_issues for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy invoice_issues_insert on public.invoice_issues for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy invoice_issues_update on public.invoice_issues for update to authenticated
  using ((select private.is_hotel_member(hotel_id)))
  with check ((select private.is_hotel_member(hotel_id)));
create policy invoice_issues_delete on public.invoice_issues for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));
revoke all on public.invoice_issues from anon, authenticated;
grant select, insert, delete on public.invoice_issues to authenticated;
grant update (
  status, issue_number, group_id, booking_ids, payer_name, payer_phone,
  is_mid_stay, snapshot, issued_at, updated_at
) on public.invoice_issues to authenticated;
