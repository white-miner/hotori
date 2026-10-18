-- is_hotel_member를 API에 노출되지 않는 private 스키마로 옮겨요 (RLS 정책 안에서만 써요).
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_hotel_member(hid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hotel_members m
    where m.hotel_id = hid and m.user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_hotel_member(uuid) from public, anon;
grant execute on function private.is_hotel_member(uuid) to authenticated;

drop policy hotels_select on public.hotels;
drop policy hotels_update on public.hotels;
drop policy bookings_select on public.bookings;
drop policy bookings_insert on public.bookings;
drop policy bookings_update on public.bookings;
drop policy bookings_delete on public.bookings;

create policy hotels_select on public.hotels for select to authenticated
  using ((select private.is_hotel_member(id)));
create policy hotels_update on public.hotels for update to authenticated
  using ((select private.is_hotel_member(id))) with check ((select private.is_hotel_member(id)));
create policy bookings_select on public.bookings for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy bookings_insert on public.bookings for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy bookings_update on public.bookings for update to authenticated
  using ((select private.is_hotel_member(hotel_id))) with check ((select private.is_hotel_member(hotel_id)));
create policy bookings_delete on public.bookings for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));

drop function public.is_hotel_member(uuid);
