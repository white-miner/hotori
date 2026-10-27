-- HOTORI 현장 도우미 v2 §6: 확인 필요 함의 "이대로 둠" 기억 (tangle_states)
--  · key = 규칙+대상 (예: T05:<예약 id>) · signature = 그때의 값. 값이 바뀌면 서명이 달라져 다시 나타나요
--  · 업무 데이터가 아니라 안내 기억이라 멤버가 지울 수도 있어요 (다시 보기)
--  · 멱등: 다시 실행해도 안전해요
create table if not exists public.tangle_states (
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  key text not null check (char_length(key) between 1 and 200),
  signature text not null check (char_length(signature) <= 300),
  state text not null default 'ignored' check (state in ('ignored', 'resolved')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (hotel_id, key)
);
comment on table public.tangle_states is '확인 필요 함 · 이대로 둠/해결 기억 · 서명이 바뀌면 다시 나타남';

create or replace function private.touch_tangle_state()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.created_at := now();
  return new;
end $$;
revoke all on function private.touch_tangle_state() from public, anon, authenticated;
drop trigger if exists tangle_states_touch on public.tangle_states;
create trigger tangle_states_touch before insert or update on public.tangle_states
for each row execute function private.touch_tangle_state();

alter table public.tangle_states enable row level security;
drop policy if exists tangle_states_select on public.tangle_states;
create policy tangle_states_select on public.tangle_states for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
drop policy if exists tangle_states_insert on public.tangle_states;
create policy tangle_states_insert on public.tangle_states for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
drop policy if exists tangle_states_update on public.tangle_states;
create policy tangle_states_update on public.tangle_states for update to authenticated
  using ((select private.is_hotel_member(hotel_id)))
  with check ((select private.is_hotel_member(hotel_id)));
drop policy if exists tangle_states_delete on public.tangle_states;
create policy tangle_states_delete on public.tangle_states for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));
