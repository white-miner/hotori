-- 취소 · 노쇼 · 중도 퇴실
--  · 취소(cancelled): 전액 환불. 재고 돌려주고 매출에서 빠져요 (예전 그대로)
--  · 노쇼(noshow): 결제한 금액은 매출에 남아요. 재고는 돌려줘요 (화면 계산만 바뀌어서 DB는 그대로)
--  · 중도 퇴실(새로): status는 'active' 그대로 두고 떠난 날짜만 적어요.
--      early_out_on  = 손님이 떠난 영업일 (입실 다음 날 ~ 원래 퇴실 전날). 그날 밤부터 방·재고가 비어요.
--      refund_amount = 돌려준 금액 (없으면 null). 매출에서는 early_out_on 날짜에 빠져요.
--    status를 새로 만들지 않은 까닭: 예전 앱은 모르는 status를 취소처럼 다뤄서 묵은 밤까지 비어 보여요.
--    'active' + 날짜로 두면 예전 앱에는 끝까지 묵는 예약으로 보여요 (비운 밤에 겹쳐 팔 위험이 없어요).
alter table public.bookings
  add column early_out_on date,
  add column refund_amount integer
    constraint bookings_refund_amount_range check (refund_amount is null or refund_amount between 1 and 100000000);
comment on column public.bookings.early_out_on is '중도 퇴실한 영업일 (입실 다음 날 ~ 퇴실 전날) · null = 끝까지 묵음';
comment on column public.bookings.refund_amount is '중도 퇴실 환불 금액 · null = 환불 없음 · 매출에서는 early_out_on 날짜에 빠짐';
create index bookings_hotel_early_out_idx on public.bookings(hotel_id, early_out_on) where early_out_on is not null;

-- 숙박이 실제로 쓰는 밤·방 (객실 이동 구간 따라, until 전날 밤까지)
create or replace function private.stay_rooms(p_check_in date, p_nights int, p_room text, p_segs jsonb, p_until date)
returns table(night date, room text) language sql immutable set search_path = '' as $$
  with segs as (
    select e ->> 'room' as room, (e ->> 'nights')::int as n, o
    from jsonb_array_elements(
      case when jsonb_typeof(p_segs) = 'array' and jsonb_array_length(p_segs) >= 2 then p_segs
           else jsonb_build_array(jsonb_build_object('room', p_room, 'nights', p_nights)) end
    ) with ordinality as t(e, o)
  ), cum as (
    select room, n, (coalesce(sum(n) over (order by o rows between unbounded preceding and 1 preceding), 0))::int as st from segs
  )
  select (p_check_in + c.st + g)::date, c.room
  from cum c cross join lateral generate_series(0, greatest(c.n, 0) - 1) g
  where c.room is not null and p_check_in + c.st + g < coalesce(p_until, p_check_in + p_nights)
$$;
-- 순수 계산 함수 (데이터를 안 읽어요): 저장 트리거가 로그인한 사람 권한으로 불러요
revoke all on function private.stay_rooms(date, int, text, jsonb, date) from public, anon;
grant execute on function private.stay_rooms(date, int, text, jsonb, date) to authenticated;

-- 저장 전에 맞추고 확인해요 (room_segments 다음에 돌아요: 트리거는 이름 순서)
--  · 대실·취소·노쇼·1박이면 지워요
--  · 예전 앱이 입실일·박수만 바꿔서 날짜가 범위를 벗어나면 지워요 (예전 앱과 호환)
--  · 범위 밖 날짜를 직접 보내면 거절, 환불은 결제 금액 이하
--  · 되돌리기(날짜를 지우거나 늦추기)는 비운 밤에 다른 예약이 그 방에 들어왔으면 거절
create or replace function private.fit_early_out()
returns trigger language plpgsql set search_path = '' as $$
declare
  hit text;
begin
  if new.refund_amount = 0 then new.refund_amount := null; end if;
  if new.early_out_on is null then
    new.refund_amount := null;
  elsif new.kind <> 'stay' or new.status <> 'active' or new.nights is null or new.nights < 2 then
    new.early_out_on := null;
    new.refund_amount := null;
  elsif not (new.early_out_on > new.check_in and new.early_out_on < new.check_in + new.nights::int) then
    if tg_op = 'UPDATE' and new.early_out_on is not distinct from old.early_out_on
       and (new.check_in is distinct from old.check_in or new.nights is distinct from old.nights) then
      new.early_out_on := null;
      new.refund_amount := null;
    else
      raise exception '중도 퇴실 날짜는 입실 다음 날부터 원래 퇴실 전날까지예요' using errcode = 'check_violation';
    end if;
  elsif new.refund_amount is not null and new.refund_amount > new.price then
    raise exception '환불 금액은 결제 금액보다 클 수 없어요' using errcode = 'check_violation';
  end if;

  -- 비운 밤을 다시 쓰게 되면(되돌리기·날짜 늦추기) 그 밤 그 방이 비어 있어야 해요
  if tg_op = 'UPDATE' and old.early_out_on is not null and new.status = 'active' and new.kind = 'stay'
     and (new.early_out_on is null or new.early_out_on > old.early_out_on) then
    select o.guest_name || ' (' || to_char(m.night, 'FMMM/FMDD') || ')' into hit
    from private.stay_rooms(new.check_in, new.nights, new.room_id, new.room_segments, new.early_out_on) m
    join public.bookings o
      on o.hotel_id = new.hotel_id and o.id <> new.id and o.status = 'active' and o.kind = 'stay'
     and o.check_in <= m.night and m.night < coalesce(o.early_out_on, o.check_in + o.nights::int)
    cross join lateral private.stay_rooms(o.check_in, o.nights, o.room_id, o.room_segments, o.early_out_on) x
    where m.night >= old.early_out_on and x.night = m.night and x.room = m.room
    limit 1;
    if hit is not null then
      raise exception '비운 밤에 다른 예약이 들어와서 되돌릴 수 없어요: %', hit using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.fit_early_out() from public, anon, authenticated;
create trigger bookings_stay_end before insert or update on public.bookings
for each row execute function private.fit_early_out();

-- 공유 링크: 중도 퇴실 날짜도 보내요 (환불·가격은 안 보내요)
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
          'end_time', b.end_time, 'arrived', b.arrived, 'early_out_on', b.early_out_on
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
