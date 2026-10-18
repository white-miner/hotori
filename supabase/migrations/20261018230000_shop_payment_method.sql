-- 매점 판매: 카드·현금을 따로 남겨요.
-- 예전 판매(이 컬럼이 생기기 전)는 비워 둬요(null = 미지정). 화면에서는 0이 아닐 때만 '미지정'으로 보여요.
alter table public.shop_sales
  add column payment_method text check (payment_method in ('card', 'cash'));
comment on column public.shop_sales.payment_method is '결제 방법: card 카드 · cash 현금 · null 미지정(예전 기록)';
