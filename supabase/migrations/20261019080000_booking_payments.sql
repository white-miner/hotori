-- 선금 · 잔금: 예약마다 받은 돈을 한 줄씩 적어요 (작은 표 + RLS)
--  · kind: deposit(선금) · balance(잔금 받음), method: card · cash, biz_date: 받은 영업일
--  · 잔금 = 판매 가격(중도 퇴실이면 환불 뺀 금액) − 받은 돈 합계. 화면에서 계산해요.
--  · 플랫폼(OTA) 예약은 플랫폼이 받은 걸로 봐서 잔금을 안 보여요. 현장 결제 플랫폼만 (설정의 platforms[].onsite).
--  · 예전 앱은 이 표를 모르니 그대로 동작해요 (bookings는 바뀌지 않아요).
create table public.booking_payments (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind text not null check (kind in ('deposit', 'balance')),
  method text not null check (method in ('card', 'cash')),
  amount integer not null check (amount between 1 and 100000000),
  biz_date date not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.booking_payments is '예약 결제(선금·잔금 받음). 현금은 장부 현금 시재에 들어가요';
create index booking_payments_booking_idx on public.booking_payments(booking_id);
create index booking_payments_hotel_date_idx on public.booking_payments(hotel_id, biz_date);
create index booking_payments_created_by_idx on public.booking_payments(created_by);

-- 호텔은 예약에서 가져와요 (다른 호텔 예약에 돈을 붙일 수 없어요: 예약이 안 보이면 null → 거절)
create or replace function private.fit_booking_payment()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.hotel_id := (select b.hotel_id from public.bookings b where b.id = new.booking_id);
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end $$;
revoke all on function private.fit_booking_payment() from public, anon, authenticated;
create trigger booking_payments_fit before insert on public.booking_payments
for each row execute function private.fit_booking_payment();

-- 다른 기기에 바로 보이게: 예약의 updated_at을 건드려 실시간 알림이 가게 해요
create or replace function private.bump_booking_for_payment()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.bookings set updated_at = now() where id = coalesce(new.booking_id, old.booking_id);
  return null;
end $$;
revoke all on function private.bump_booking_for_payment() from public, anon, authenticated;
create trigger booking_payments_bump after insert or delete on public.booking_payments
for each row execute function private.bump_booking_for_payment();

alter table public.booking_payments enable row level security;
create policy booking_payments_select on public.booking_payments for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy booking_payments_insert on public.booking_payments for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy booking_payments_delete on public.booking_payments for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));
revoke all on public.booking_payments from anon, authenticated;
grant select, insert, delete on public.booking_payments to authenticated;
