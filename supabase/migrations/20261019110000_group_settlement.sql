-- 단체 정산: 단체 하나를 결제자 하나로 (선결제 · 후불), 받은 돈은 booking_payments에 group_id로 한 줄씩
--  · booking_groups.id = bookings.group_id (단체 예약을 만들 때 같이 만들어요. 예전 단체는 처음 정산할 때 만들어요)
--  · 정산 금액은 화면에서 방들의 지금 상태로 계산해요 (취소 빼고, 노쇼 포함, 중도 퇴실 환불 · 추가 인원 · 추가 항목)
--  · 매출 날짜는 그대로(입실일 가격), 받은 돈은 받은 날 현금 시재에 들어가요
--  · 예전 앱: 이 표를 몰라요. 예약 줄은 그대로라 화면도 그대로예요. 장부 현금 시재는 받은 돈을 호텔·날짜로 읽어서 같이 들어가요.
create table public.booking_groups (
  id uuid primary key,
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  pay_mode text not null default 'prepaid' check (pay_mode in ('prepaid', 'postpaid')),
  due_on date,
  payer_company text check (payer_company is null or char_length(payer_company) <= 60),
  payer_name text check (payer_name is null or char_length(payer_name) <= 40),
  payer_phone text check (payer_phone is null or char_length(payer_phone) <= 30),
  rates jsonb check (rates is null or jsonb_typeof(rates) = 'object'),
  extras jsonb not null default '[]'::jsonb check (jsonb_typeof(extras) = 'array' and jsonb_array_length(extras) <= 50),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.booking_groups is '단체 정산 정보 (결제 방식 · 결제자 · 타입별 1박 요금 · 추가 항목). id = bookings.group_id';
create index booking_groups_hotel_idx on public.booking_groups(hotel_id);
create index booking_groups_created_by_idx on public.booking_groups(created_by);

create or replace function private.touch_booking_group()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now(); end if;
  if tg_op = 'UPDATE' then new.hotel_id := old.hotel_id; new.created_by := old.created_by; new.created_at := old.created_at; end if;
  return new;
end $$;
revoke all on function private.touch_booking_group() from public, anon, authenticated;
create trigger booking_groups_touch before insert or update on public.booking_groups
for each row execute function private.touch_booking_group();

alter table public.booking_groups enable row level security;
create policy booking_groups_select on public.booking_groups for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy booking_groups_insert on public.booking_groups for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy booking_groups_update on public.booking_groups for update to authenticated
  using ((select private.is_hotel_member(hotel_id))) with check ((select private.is_hotel_member(hotel_id)));
create policy booking_groups_delete on public.booking_groups for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));
revoke all on public.booking_groups from anon, authenticated;
grant select, insert, update, delete on public.booking_groups to authenticated;
alter publication supabase_realtime add table public.booking_groups;

-- 받은 돈: 예약 하나(booking_id) 또는 단체 하나(group_id) 중 하나에 붙어요
alter table public.booking_payments
  alter column booking_id drop not null,
  add column group_id uuid references public.booking_groups(id) on delete cascade,
  add constraint booking_payments_one_owner check ((booking_id is null) <> (group_id is null));
create index booking_payments_group_idx on public.booking_payments(group_id) where group_id is not null;

create or replace function private.fit_booking_payment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.booking_id is not null then
    new.hotel_id := (select b.hotel_id from public.bookings b where b.id = new.booking_id);
  else
    new.hotel_id := (select g.hotel_id from public.booking_groups g where g.id = new.group_id);
  end if;
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end $$;

create or replace function private.bump_booking_for_payment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(new.booking_id, old.booking_id) is not null then
    update public.bookings set updated_at = now() where id = coalesce(new.booking_id, old.booking_id);
  else
    update public.booking_groups set updated_at = now() where id = coalesce(new.group_id, old.group_id);
  end if;
  return null;
end $$;
