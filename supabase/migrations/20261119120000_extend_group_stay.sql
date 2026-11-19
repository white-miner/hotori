-- 단체 기간 연장: 여러 객실의 박수·요금·퇴실 미정을 한 트랜잭션으로 저장.
-- 표 모양은 바꾸지 않음. 한 객실이라도 실패하면 전부 되돌아감.
-- security invoker → 기존 RLS(호텔 구성원만)가 그대로 적용됨.
create or replace function public.extend_group_stay(p_lines jsonb)
returns setof public.bookings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  elem jsonb;
  n int;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 then
    raise exception '연장할 객실이 없어요' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 60 then
    raise exception '한 번에 60객실까지예요' using errcode = '22023';
  end if;

  for elem in select jsonb_array_elements(p_lines)
  loop
    update public.bookings b
      set nights = (elem->>'nights')::smallint,
          price = (elem->>'price')::integer,
          night_rates = elem->'night_rates',
          open_ended = coalesce((elem->>'open_ended')::boolean, false),
          room_id = nullif(elem->>'room_id', ''),
          room_segments = elem->'room_segments'
      where b.id = (elem->>'id')::uuid
        and b.updated_at = (elem->>'updated_at')::timestamptz
        and b.status = 'active'
        and b.checked_out_at is null;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception '다른 작업에서 예약이 바뀌었어요. 다시 열어 주세요' using errcode = '40001';
    end if;
  end loop;

  return query
    select b.* from public.bookings b
    where b.id in (select (value->>'id')::uuid from jsonb_array_elements(p_lines) as t(value));
end $$;

revoke all on function public.extend_group_stay(jsonb) from public, anon;
grant execute on function public.extend_group_stay(jsonb) to authenticated;
comment on function public.extend_group_stay(jsonb) is '단체 기간 연장 저장 (한 트랜잭션 · RLS). 결제 줄은 바꾸지 않음';
