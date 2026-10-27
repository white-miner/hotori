-- HOTORI 기록 정정: 결제 줄을 고칠 수 있게 (금액·수단·결제일·객실/단체·대상 기간·메모)
--  · 예전엔 select/insert/delete만 있어서 고치려면 지우고 다시 적어야 했어요 (결제 시각·처리자가 사라졌죠)
--  · 이제 update를 열어요 (호텔 구성원만 · 기존 RLS 그대로). 한 문장 update = 원자적이에요
--  · 트리거가 호텔·만든 사람·만든 시각은 못 바꾸게 지키고, 정정한 시각·사람(edited_at/edited_by)을 남겨요
--  · 객실↔단체로 옮겨도 호텔은 새 주인에서 다시 구해요 (다른 호텔로는 못 옮겨요)
--  · 멱등: 다시 실행해도 안전해요 (if not exists / create or replace / drop ... if exists)
alter table public.booking_payments
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references auth.users(id) on delete set null;
comment on column public.booking_payments.edited_at is '기록 정정으로 마지막에 고친 시각 (null = 고친 적 없음)';

create or replace function private.fit_booking_payment()
returns trigger language plpgsql set search_path = '' as $$
declare
  b record;
begin
  if new.booking_id is not null then
    select x.hotel_id, x.kind, x.check_in, x.nights into b from public.bookings x where x.id = new.booking_id;
    new.hotel_id := b.hotel_id;
    if new.night_date is not null and (b.kind is distinct from 'stay' or b.nights is null
       or new.night_date < b.check_in or new.night_date >= b.check_in + b.nights::int) then
      raise exception '박별 결제 날짜가 숙박 기간 밖이에요' using errcode = 'check_violation';
    end if;
  else
    new.hotel_id := (select g.hotel_id from public.booking_groups g where g.id = new.group_id);
  end if;
  if tg_op = 'UPDATE' then
    if new.hotel_id is distinct from old.hotel_id then
      raise exception '다른 호텔로 옮길 수 없어요' using errcode = 'check_violation';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.edited_at := now();
    new.edited_by := auth.uid();
  else
    new.created_by := auth.uid();
    new.created_at := now();
    new.edited_at := null;
    new.edited_by := null;
  end if;
  return new;
end $$;
revoke all on function private.fit_booking_payment() from public, anon, authenticated;
drop trigger if exists booking_payments_fit on public.booking_payments;
create trigger booking_payments_fit before insert or update on public.booking_payments
for each row execute function private.fit_booking_payment();

-- 다른 기기에 바로 보이게: 옮겨 갔다면 옛 주인과 새 주인 모두 updated_at을 건드려요
create or replace function private.bump_booking_for_payment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'DELETE' then
    if new.booking_id is not null then
      update public.bookings set updated_at = now() where id = new.booking_id;
    else
      update public.booking_groups set updated_at = now() where id = new.group_id;
    end if;
  end if;
  if tg_op <> 'INSERT' then
    if old.booking_id is not null then
      update public.bookings set updated_at = now() where id = old.booking_id;
    else
      update public.booking_groups set updated_at = now() where id = old.group_id;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists booking_payments_bump on public.booking_payments;
create trigger booking_payments_bump after insert or update or delete on public.booking_payments
for each row execute function private.bump_booking_for_payment();

drop policy if exists booking_payments_update on public.booking_payments;
create policy booking_payments_update on public.booking_payments for update to authenticated
  using ((select private.is_hotel_member(hotel_id)))
  with check ((select private.is_hotel_member(hotel_id)));
-- 고칠 수 있는 칸만 열어요 (hotel_id·created_*는 못 바꿔요)
grant update (booking_id, group_id, kind, method, amount, biz_date, note, night_date, period_nights) on public.booking_payments to authenticated;
