-- 지출 기록: 비품·식자재·세탁·수리·공과금… 한 건이 한 줄이에요.
-- 분류는 hotels.settings.expenseCategories(설정에서 고쳐요)에서 고르고, 이름을 그때 값으로 복사해 둬요.
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  biz_date date not null check (biz_date between date '2020-01-01' and date '2100-01-01'), -- 영업일(새벽 6시 기준)
  category text not null check (char_length(category) between 1 and 12),
  amount integer not null check (amount between 1 and 100000000),
  payment_method text not null check (payment_method in ('card', 'cash')),
  memo text check (memo is null or char_length(memo) <= 200),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.expenses is '지출 기록 (호텔 멤버만)';
create index expenses_hotel_date_idx on public.expenses(hotel_id, biz_date);
create index expenses_created_by_idx on public.expenses(created_by);
create index expenses_updated_by_idx on public.expenses(updated_by);

-- 누가 언제: 로그인한 사용자가 넣거나 고칠 때 서버가 정해요 (관리자가 SQL로 넣는 예시는 적은 값 그대로)
create or replace function private.touch_expense()
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
  return new;
end $$;
revoke all on function private.touch_expense() from public, anon, authenticated;
create trigger expenses_touch before insert or update on public.expenses
for each row execute function private.touch_expense();

alter table public.expenses enable row level security;
create policy expenses_select on public.expenses for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy expenses_insert on public.expenses for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy expenses_update on public.expenses for update to authenticated
  using ((select private.is_hotel_member(hotel_id)))
  with check ((select private.is_hotel_member(hotel_id)));
create policy expenses_delete on public.expenses for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));
revoke all on public.expenses from anon, authenticated;
grant select, insert, delete on public.expenses to authenticated;
grant update (biz_date, category, amount, payment_method, memo) on public.expenses to authenticated;

alter publication supabase_realtime add table public.expenses;

alter table public.hotels
  add constraint hotels_settings_expense_categories_array
  check (not (settings ? 'expenseCategories') or jsonb_typeof(settings -> 'expenseCategories') = 'array');

-- 공유 링크: 지출 분류도 빼고 보내요 (지출 기록은 원래 안 보내요)
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
      'settings', h.settings - 'shopItems' - 'expenseCategories',
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

