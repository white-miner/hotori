-- 결제 줄 보조 메모: 「+추가금」내역에 `추가금 · 늦은 퇴실` 등을 남김 (kind는 balance 유지)
alter table public.booking_payments
  add column if not exists note text;
comment on column public.booking_payments.note is '결제 보조 라벨(추가금 사유 등). 주 카피는 method+amount';
