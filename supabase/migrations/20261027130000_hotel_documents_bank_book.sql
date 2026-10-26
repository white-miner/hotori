-- 발급 vault kinds: +통장사본 (bank_book); 사업자등록증 keeps business_license
-- Extends hotel_documents.kind check beyond fire_insurance · business_license · other

alter table public.hotel_documents
  drop constraint if exists hotel_documents_kind_check;

alter table public.hotel_documents
  add constraint hotel_documents_kind_check
  check (kind in ('fire_insurance', 'bank_book', 'business_license', 'other'));

comment on column public.hotel_documents.kind is
  'fire_insurance · bank_book · business_license · other';
