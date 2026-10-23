-- Option A · 잔액 보관 (stay credit)
--  · 중도퇴실 시 현금 환불(refund_amount)과 분리한 손님 부채(보관 잔액)
--  · MVP: 현장·전화(property-collected) 위주 · OTA 채널 선결제는 FO에서 생성 차단
--  · 상환: booking_payments.method = 'credit' + stay_credit_applications · amount_remaining 차감
--  · 만료(breakage)·선물권 복잡도 = Out of scope

-- 결제 방법에 'credit'(잔액 사용) 추가 · 현금 시재에 안 들어감
alter table public.booking_payments drop constraint if exists booking_payments_method_check;
alter table public.booking_payments
  add constraint booking_payments_method_check
  check (method in ('card', 'cash', 'transfer', 'credit'));
comment on column public.booking_payments.method is
  'card 카드 · cash 현금 · transfer 이체 · credit 보관 잔액 사용(시재 제외)';

create table public.stay_credits (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  guest_name text not null check (char_length(trim(guest_name)) between 1 and 40),
  guest_phone text check (guest_phone is null or char_length(trim(guest_phone)) between 1 and 30),
  amount_original integer not null check (amount_original between 1 and 100000000),
  amount_remaining integer not null check (amount_remaining between 0 and 100000000),
  preferred_recheckin_date date,
  source_booking_id uuid references public.bookings(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'depleted', 'void')),
  expires_on date,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stay_credits_remaining_le_original check (amount_remaining <= amount_original),
  constraint stay_credits_open_has_remaining check (
    (status = 'open' and amount_remaining >= 1)
    or (status = 'depleted' and amount_remaining = 0)
    or (status = 'void')
  )
);
comment on table public.stay_credits is '잔액 보관(손님 부채). 중도퇴실 환불(refund_amount)과 별개';
comment on column public.stay_credits.preferred_recheckin_date is '희망 재입실일 · 재고 홀드 아님(알림/메모)';
comment on column public.stay_credits.status is 'open 사용가능 · depleted 전액사용 · void 무효';

create index stay_credits_hotel_status_idx on public.stay_credits(hotel_id, status);
create index stay_credits_hotel_open_idx on public.stay_credits(hotel_id)
  where status = 'open';
create index stay_credits_guest_phone_idx on public.stay_credits(hotel_id, guest_phone)
  where guest_phone is not null;
create index stay_credits_source_booking_idx on public.stay_credits(source_booking_id)
  where source_booking_id is not null;
create index stay_credits_preferred_date_idx on public.stay_credits(hotel_id, preferred_recheckin_date)
  where preferred_recheckin_date is not null and status = 'open';

create table public.stay_credit_applications (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  credit_id uuid not null references public.stay_credits(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  payment_id uuid references public.booking_payments(id) on delete set null,
  amount integer not null check (amount between 1 and 100000000),
  biz_date date not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.stay_credit_applications is '보관 잔액 → 예약 결제 적용 내역';
create index stay_credit_applications_credit_idx on public.stay_credit_applications(credit_id);
create index stay_credit_applications_booking_idx on public.stay_credit_applications(booking_id);
create index stay_credit_applications_hotel_date_idx on public.stay_credit_applications(hotel_id, biz_date);

create or replace function private.fit_stay_credit()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.guest_name := trim(new.guest_name);
  if new.guest_phone is not null then
    new.guest_phone := nullif(trim(new.guest_phone), '');
  end if;
  if new.note is not null then
    new.note := nullif(trim(new.note), '');
  end if;
  if new.amount_remaining = 0 and new.status = 'open' then
    new.status := 'depleted';
  end if;
  if new.status = 'depleted' then
    new.amount_remaining := 0;
  end if;
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
    new.source_booking_id := coalesce(new.source_booking_id, old.source_booking_id);
  end if;
  return new;
end $$;
revoke all on function private.fit_stay_credit() from public, anon, authenticated;
create trigger stay_credits_fit before insert or update on public.stay_credits
for each row execute function private.fit_stay_credit();

create or replace function private.fit_stay_credit_application()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.hotel_id := (select c.hotel_id from public.stay_credits c where c.id = new.credit_id);
  new.created_by := auth.uid();
  new.created_at := now();
  if new.hotel_id is null then
    raise exception '보관 잔액을 찾을 수 없어요' using errcode = 'foreign_key_violation';
  end if;
  if not exists (
    select 1 from public.bookings b
    where b.id = new.booking_id and b.hotel_id = new.hotel_id
  ) then
    raise exception '같은 호텔 예약에만 잔액을 쓸 수 있어요' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.fit_stay_credit_application() from public, anon, authenticated;
create trigger stay_credit_applications_fit before insert on public.stay_credit_applications
for each row execute function private.fit_stay_credit_application();

alter table public.stay_credits enable row level security;
create policy stay_credits_select on public.stay_credits for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy stay_credits_insert on public.stay_credits for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy stay_credits_update on public.stay_credits for update to authenticated
  using ((select private.is_hotel_member(hotel_id)))
  with check ((select private.is_hotel_member(hotel_id)));
create policy stay_credits_delete on public.stay_credits for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));
revoke all on public.stay_credits from anon, authenticated;
grant select, insert, delete on public.stay_credits to authenticated;
grant update (
  guest_name, guest_phone, amount_remaining, preferred_recheckin_date,
  status, expires_on, note, updated_by, updated_at
) on public.stay_credits to authenticated;

alter table public.stay_credit_applications enable row level security;
create policy stay_credit_applications_select on public.stay_credit_applications for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy stay_credit_applications_insert on public.stay_credit_applications for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy stay_credit_applications_delete on public.stay_credit_applications for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));
revoke all on public.stay_credit_applications from anon, authenticated;
grant select, insert, delete on public.stay_credit_applications to authenticated;
