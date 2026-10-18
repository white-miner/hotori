-- 매점 판매: 로그인한 사용자가 넣을 때만 누가·언제를 서버가 정해요.
-- (관리자가 SQL로 넣는 예시 판매는 적어 준 날짜·시각을 그대로 써요)
create or replace function private.touch_shop_sale()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null or current_user in ('authenticated', 'anon') then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end $$;
revoke all on function private.touch_shop_sale() from public, anon, authenticated;
