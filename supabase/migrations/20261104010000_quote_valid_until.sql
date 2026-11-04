-- 견적서에 유효기간을 보관해 초안 저장·발급 스냅샷·재인쇄에 동일하게 표시해요.
alter table public.quote_issues add column if not exists valid_until date;
alter table public.quote_issues
  add column if not exists tax_mode text not null default 'included'
  check (tax_mode in ('included', 'excluded', 'exempt'));
grant update (valid_until, tax_mode) on public.quote_issues to authenticated;

create or replace function private.touch_quote_issue()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null or current_user in ('authenticated', 'anon') then
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
    if old.status = 'issued' then
      new.status := 'issued';
      new.snapshot := old.snapshot;
      new.issued_at := old.issued_at;
      new.total := old.total;
      new.lines := old.lines;
      new.show_room_nos := old.show_room_nos;
      new.valid_until := old.valid_until;
      new.tax_mode := old.tax_mode;
      if old.group_id is not null then new.group_id := old.group_id; end if;
      if coalesce(array_length(old.booking_ids, 1), 0) > 0 then new.booking_ids := old.booking_ids; end if;
    end if;
  end if;
  return new;
end $$;
