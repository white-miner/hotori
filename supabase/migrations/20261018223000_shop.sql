-- HOTORI · 매점 (프런트에서 파는 컵라면·음료·기념품)
-- · 물품 목록은 객실 타입처럼 hotels.settings.shopItems(JSONB 배열)에 있어요: {id, name, price, category, hidden}
-- · 판매는 shop_sales에 1개씩 한 줄. 물품 이름·가격을 그때 값으로 복사해 둬서, 나중에 가격을 바꾸거나
--   물품을 지워도 지난 매출은 그대로예요. 예약(bookings)과는 섞지 않아요.
-- · Free는 물품 10개까지 (서버에서도 막아요). Pro는 제한 없음.
-- · 현황 공유 링크에는 매점 물품·매출을 보내지 않아요.

create table public.shop_sales (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  item_id text not null check (char_length(item_id) between 1 and 40),
  item_name text not null check (char_length(item_name) between 1 and 40),
  unit_price integer not null check (unit_price between 0 and 10000000),
  qty smallint not null default 1 check (qty between 1 and 99),
  biz_date date not null check (biz_date between date '2020-01-01' and date '2100-01-01'),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index shop_sales_hotel_date_idx on public.shop_sales(hotel_id, biz_date);
create index shop_sales_created_by_idx on public.shop_sales(created_by);

-- 누가 언제 팔았는지는 서버가 정해요
create or replace function private.touch_shop_sale()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end $$;
revoke all on function private.touch_shop_sale() from public, anon, authenticated;
create trigger shop_sales_touch before insert on public.shop_sales
for each row execute function private.touch_shop_sale();

alter table public.shop_sales enable row level security;
create policy shop_sales_select on public.shop_sales for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy shop_sales_insert on public.shop_sales for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy shop_sales_delete on public.shop_sales for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));
revoke all on public.shop_sales from anon, authenticated;
grant select, insert, delete on public.shop_sales to authenticated;

alter publication supabase_realtime add table public.shop_sales;

-- Free 요금제: 매점 물품 10개까지
create or replace function private.check_shop_item_limit()
returns trigger language plpgsql set search_path = '' as $$
declare
  n int := case when jsonb_typeof(new.settings -> 'shopItems') = 'array' then jsonb_array_length(new.settings -> 'shopItems') else 0 end;
  o int := 0;
begin
  if tg_op = 'UPDATE' and jsonb_typeof(old.settings -> 'shopItems') = 'array' then
    o := jsonb_array_length(old.settings -> 'shopItems');
  end if;
  -- Pro에서 Free로 내려간 호텔은 있던 물품은 그대로 두고, 10개를 넘는 동안 더 늘리지만 못해요
  if new.plan = 'free' and n > 10 and n > o then
    raise exception 'shop item limit: free plan allows up to 10 items' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.check_shop_item_limit() from public, anon, authenticated;
create trigger hotels_shop_item_limit before insert or update of settings on public.hotels
for each row execute function private.check_shop_item_limit();

alter table public.hotels
  add constraint hotels_settings_shop_items_array
  check (not (settings ? 'shopItems') or jsonb_typeof(settings -> 'shopItems') = 'array');

-- 공유 링크: 매점 물품은 빼고 보내요 (매출은 원래 안 보내요)
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
      'settings', h.settings - 'shopItems',
      'bookings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', b.id, 'kind', b.kind, 'status', b.status, 'platform_id', b.platform_id,
          'guest_name', b.guest_name, 'type_id', b.type_id, 'room_id', b.room_id,
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
