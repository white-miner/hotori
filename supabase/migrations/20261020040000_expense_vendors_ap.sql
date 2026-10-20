-- 지출 거래처 + 입고일 · 미수금(AP) · 금액 미정(0) 허용
-- vendor_type: mart 마트 · wholesaler 상사 · auction 옥션(온라인샵) · other 기타

create table public.expense_vendors (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  vendor_type text not null check (vendor_type in ('mart', 'wholesaler', 'auction', 'other')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hotel_id, name)
);
comment on table public.expense_vendors is '지출 거래처 (호텔 멤버만) — 마트·상사·옥션 등';
comment on column public.expense_vendors.vendor_type is 'mart 마트 · wholesaler 상사 · auction 옥션 · other 기타';
create index expense_vendors_hotel_idx on public.expense_vendors(hotel_id);
create index expense_vendors_created_by_idx on public.expense_vendors(created_by);
create index expense_vendors_updated_by_idx on public.expense_vendors(updated_by);

create or replace function private.touch_expense_vendor()
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
revoke all on function private.touch_expense_vendor() from public, anon, authenticated;
create trigger expense_vendors_touch before insert or update on public.expense_vendors
for each row execute function private.touch_expense_vendor();

alter table public.expense_vendors enable row level security;
create policy expense_vendors_select on public.expense_vendors for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy expense_vendors_insert on public.expense_vendors for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy expense_vendors_update on public.expense_vendors for update to authenticated
  using ((select private.is_hotel_member(hotel_id)))
  with check ((select private.is_hotel_member(hotel_id)));
create policy expense_vendors_delete on public.expense_vendors for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));
revoke all on public.expense_vendors from anon, authenticated;
grant select, insert, delete on public.expense_vendors to authenticated;
grant update (name, vendor_type) on public.expense_vendors to authenticated;

alter publication supabase_realtime add table public.expense_vendors;

-- expenses: 거래처 · 입고일 · 미수/입금 · 금액 0(미정) · 결제수단 null(미수)
alter table public.expenses
  add column vendor_id uuid references public.expense_vendors(id) on delete set null,
  add column stock_in_date date check (stock_in_date is null or stock_in_date between date '2020-01-01' and date '2100-01-01'),
  add column paid boolean not null default true;

comment on column public.expenses.vendor_id is '거래처 (expense_vendors)';
comment on column public.expenses.stock_in_date is '입고날짜 (영업일 biz_date와 별도)';
comment on column public.expenses.paid is 'true 입금 완료 · false 미수금(AP)';

create index expenses_vendor_idx on public.expenses(hotel_id, vendor_id) where vendor_id is not null;
create index expenses_unpaid_idx on public.expenses(hotel_id, biz_date) where paid = false;

alter table public.expenses drop constraint if exists expenses_amount_check;
alter table public.expenses add constraint expenses_amount_check check (amount between 0 and 100000000);

alter table public.expenses alter column payment_method drop not null;
alter table public.expenses drop constraint if exists expenses_payment_method_check;
alter table public.expenses
  add constraint expenses_payment_method_check
  check (payment_method is null or payment_method in ('card', 'cash', 'transfer'));

-- 입금 완료면 금액≥1 · 결제수단 필수. 미수면 금액 0 가능 · 결제수단 선택
alter table public.expenses
  add constraint expenses_paid_consistency check (
    (paid = false and (payment_method is null or payment_method in ('card', 'cash', 'transfer')))
    or (paid = true and amount >= 1 and payment_method in ('card', 'cash', 'transfer'))
  );

revoke update on public.expenses from authenticated;
grant update (biz_date, category, amount, payment_method, memo, vendor_id, stock_in_date, paid) on public.expenses to authenticated;
