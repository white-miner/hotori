-- 인수인계(kind=delivery): 호텔 공용 메모 허용 — room_id nullable
-- 특이사항(kind=issue)은 앱에서 room_id 필수 유지

alter table public.room_memos
  alter column room_id drop not null;

alter table public.room_memos
  drop constraint if exists room_memos_room_id_check;

alter table public.room_memos
  add constraint room_memos_room_id_check check (
    room_id is null
    or char_length(trim(room_id)) between 1 and 40
  );

-- 특이사항은 반드시 객실에 묶임
alter table public.room_memos
  drop constraint if exists room_memos_issue_needs_room;

alter table public.room_memos
  add constraint room_memos_issue_needs_room check (
    kind <> 'issue' or (room_id is not null and char_length(trim(room_id)) >= 1)
  );

comment on column public.room_memos.room_id is
  'settings floors[].rooms[].id · null = 호텔 공용 인수인계(전달사항)';
