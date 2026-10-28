-- HOTORI 객실 카드: 개별 예약에도 회사명 (선택 입력)
--  · 추가만 해요: bookings.company 열 하나 (null = 입력 안 함). 기존 행·RLS·권한은 그대로
--  · 단체의 회사명(booking_groups.payer_company)은 그대로 두고, 카드는 예약 회사명을 먼저 · 없으면 단체 회사명을 보여요
--  · 멱등: 다시 실행해도 안전해요 (if not exists)
alter table public.bookings
  add column if not exists company text check (company is null or char_length(company) between 1 and 60);
comment on column public.bookings.company is '회사명 (선택). 객실 카드에 표시 · null = 입력 안 함';
