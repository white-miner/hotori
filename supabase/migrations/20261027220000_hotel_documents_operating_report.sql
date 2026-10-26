-- 발급 vault kinds: +영업신고서 (operating_report)
-- Extends hotel_documents.kind check

alter table public.hotel_documents
  drop constraint if exists hotel_documents_kind_check;

alter table public.hotel_documents
  add constraint hotel_documents_kind_check
  check (kind in ('fire_insurance', 'bank_book', 'business_license', 'operating_report', 'other'));

comment on column public.hotel_documents.kind is
  'fire_insurance · bank_book · business_license · operating_report · other';
