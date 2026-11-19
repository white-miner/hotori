-- 매점 객실 외상 (객실 후불, PMS의 Post to Room)
-- · 매점에서 팔 때 결제 방법으로 '객실 외상'(payment_method = 'room')을 고르면, 지금 투숙 중인 예약(또는 단체)을 골라요.
-- · 이 판매는 결제가 아니라 그 예약·단체 장부의 청구예요. 미수금 = 전체 청구(객실 요금 + 추가 항목 + 매점 객실 외상) − 결제.
-- · 손님이 낼 때는 평소처럼 결제 등록으로 받아요. 매점 판매를 취소(삭제)하면 청구도 같이 사라져요 (줄이 하나라 따로 맞출 게 없어요).
-- · 추가만 해요: 기존 판매(card · cash · null)는 그대로. 결제 방법 허용 값에 'room'만 더해요.
-- · 예약·단체를 지우면 연결만 비워요(on delete set null). 매출 기록은 남아요.

alter table public.shop_sales
  add column if not exists booking_id uuid references public.bookings(id) on delete set null,
  add column if not exists group_id uuid references public.booking_groups(id) on delete set null;

comment on column public.shop_sales.booking_id is '객실 외상: 청구를 올린 예약 (payment_method = room 일 때만)';
comment on column public.shop_sales.group_id is '객실 외상: 청구를 올린 단체 장부 (payment_method = room 일 때만)';

-- 결제 방법 허용 값 넓히기: card · cash · room (null = 미지정 예전 기록)
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
    where con.conrelid = 'public.shop_sales'::regclass and con.contype = 'c' and att.attname = 'payment_method'
      and con.conname <> 'shop_sales_payment_method_room_check'
  loop
    execute format('alter table public.shop_sales drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.shop_sales drop constraint if exists shop_sales_payment_method_room_check;
alter table public.shop_sales
  add constraint shop_sales_payment_method_room_check check (payment_method is null or payment_method in ('card', 'cash', 'room'));
comment on column public.shop_sales.payment_method is '결제 방법: card 카드 · cash 현금 · room 객실 외상(예약·단체 청구) · null 미지정(예전 기록)';

-- 연결은 객실 외상일 때만, 예약과 단체 중 하나만
alter table public.shop_sales drop constraint if exists shop_sales_room_target_check;
alter table public.shop_sales
  add constraint shop_sales_room_target_check check (
    (payment_method = 'room' or (booking_id is null and group_id is null))
    and not (booking_id is not null and group_id is not null)
  );

create index if not exists shop_sales_booking_idx on public.shop_sales(booking_id) where booking_id is not null;
create index if not exists shop_sales_group_idx on public.shop_sales(group_id) where group_id is not null;
create index if not exists shop_sales_room_tab_idx on public.shop_sales(hotel_id, biz_date) where payment_method = 'room';

-- 새 객실 외상은 같은 호텔의 예약·단체에만, 그리고 꼭 하나를 골라야 해요
create or replace function private.check_shop_room_tab()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.payment_method is distinct from 'room' then return new; end if;
  if new.booking_id is null and new.group_id is null then
    raise exception 'room tab needs a booking or group' using errcode = 'check_violation';
  end if;
  if new.booking_id is not null and not exists (
    select 1 from public.bookings b where b.id = new.booking_id and b.hotel_id = new.hotel_id and b.status = 'active'
  ) then
    raise exception 'room tab booking not found in this hotel' using errcode = 'check_violation';
  end if;
  if new.group_id is not null and not exists (
    select 1 from public.booking_groups g where g.id = new.group_id and g.hotel_id = new.hotel_id
  ) then
    raise exception 'room tab group not found in this hotel' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.check_shop_room_tab() from public, anon, authenticated;
drop trigger if exists shop_sales_room_tab_check on public.shop_sales;
create trigger shop_sales_room_tab_check before insert on public.shop_sales
for each row execute function private.check_shop_room_tab();
