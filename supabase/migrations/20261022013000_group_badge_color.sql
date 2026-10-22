-- 단체 뱃지 색 (현황·배치 칸). 6종 고정 팔레트 id만 허용.
alter table public.booking_groups
  add column if not exists badge_color text
  check (badge_color is null or badge_color in ('g1', 'g2', 'g3', 'g4', 'g5', 'g6'));

comment on column public.booking_groups.badge_color is
  '단체 뱃지 색 팔레트 id (g1..g6). null이면 기본 무채 크롬.';
