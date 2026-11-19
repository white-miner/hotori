-- 환불도 결제 내역에 한 줄로: kind = 'refund' · 금액은 음수(돌려준 돈).
-- 받은 돈 합계·결제수단별 합계·장부 현금 시재가 같은 표에서 바로 맞아요.
-- 기존 줄은 바뀌지 않아요 (모두 deposit/balance · 양수라 새 조건을 그대로 통과). 몇 번 실행해도 같아요.
alter table public.booking_payments drop constraint if exists booking_payments_kind_check;
alter table public.booking_payments
  add constraint booking_payments_kind_check check (kind in ('deposit', 'balance', 'refund'));

alter table public.booking_payments drop constraint if exists booking_payments_amount_check;
alter table public.booking_payments
  add constraint booking_payments_amount_check check (
    (kind <> 'refund' and amount between 1 and 100000000)
    or (kind = 'refund' and amount between -100000000 and -1)
  );

comment on column public.booking_payments.kind is 'deposit(선수금) · balance(수납) · refund(환불: 돌려준 돈, 음수 금액)';
