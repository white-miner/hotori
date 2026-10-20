-- 지출 결제수단: 카드 · 현금 · 이체 (예약 결제와 동일. 이체는 현금 시재에 안 들어가요)
alter table public.expenses drop constraint if exists expenses_payment_method_check;
alter table public.expenses
  add constraint expenses_payment_method_check check (payment_method in ('card', 'cash', 'transfer'));
comment on column public.expenses.payment_method is '결제 방법: card 카드 · cash 현금 · transfer 이체';
