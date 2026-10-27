-- HOTORI 현장 도우미 v2 §9: 나중에 배분 확정 (단체 몫 받은 돈 한 줄 → 객실별 줄)
--  · 단체 몫(group_id) 줄 하나를 객실별 줄로 나누고, 남는 돈은 단체 몫으로 다시 둬요
--  · 한 함수 = 한 트랜잭션: 객실 줄 insert + 원래 줄 delete (모두 되거나 모두 안 돼요)
--  · security invoker → 기존 RLS(호텔 구성원만)가 그대로 적용돼요. 새 표·정책 없음 · 멱등(create or replace)
create or replace function public.allocate_group_payment(p_payment_id uuid, p_lines jsonb)
returns setof public.booking_payments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  src public.booking_payments%rowtype;
  l record;
  total bigint := 0;
  rest bigint;
begin
  select * into src from public.booking_payments where id = p_payment_id and group_id is not null for update;
  if not found then
    raise exception '배분할 단체 결제를 찾지 못했어요' using errcode = 'P0002';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception '배분할 객실이 없어요' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception '한 번에 200객실까지 배분할 수 있어요' using errcode = '22023';
  end if;

  for l in select (e->>'booking_id')::uuid as booking_id, (e->>'amount')::bigint as amount from jsonb_array_elements(p_lines) e loop
    if l.booking_id is null or l.amount is null or l.amount < 1 then
      raise exception '배분 금액을 확인해 주세요' using errcode = '22023';
    end if;
    if not exists (select 1 from public.bookings b where b.id = l.booking_id and b.group_id = src.group_id and b.hotel_id = src.hotel_id) then
      raise exception '이 단체의 객실이 아니에요' using errcode = '22023';
    end if;
    total := total + l.amount;
  end loop;
  if total > src.amount then
    raise exception '배분 합계가 받은 돈보다 커요' using errcode = '22023';
  end if;
  rest := src.amount - total;

  delete from public.booking_payments where id = src.id;
  return query
    with ins as (
      insert into public.booking_payments (booking_id, kind, method, amount, biz_date, note)
      select (e->>'booking_id')::uuid, src.kind, src.method, (e->>'amount')::integer, src.biz_date,
             left('배분' || coalesce(' · ' || nullif(src.note, ''), ''), 80)
      from jsonb_array_elements(p_lines) e
      returning *
    )
    select * from ins;
  if rest > 0 then
    return query
      with ins as (
        insert into public.booking_payments (group_id, kind, method, amount, biz_date, note)
        values (src.group_id, src.kind, src.method, rest::integer, src.biz_date, src.note)
        returning *
      )
      select * from ins;
  end if;
end $$;

revoke all on function public.allocate_group_payment(uuid, jsonb) from public, anon;
grant execute on function public.allocate_group_payment(uuid, jsonb) to authenticated;
comment on function public.allocate_group_payment(uuid, jsonb) is '단체 몫 결제 한 줄을 객실별 줄로 나눔 (원자 · RLS 적용). 남는 돈은 단체 몫으로 다시 둠';
