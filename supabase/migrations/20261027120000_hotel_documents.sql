-- 호텔 증서 보관함 (화재보험 등) · 발급 허 P0
-- Storage bucket hotel-documents (private) + hotel_documents metadata
-- Path: {hotel_id}/certs/{document_id}/{filename}

create table public.hotel_documents (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  kind text not null default 'fire_insurance'
    check (kind in ('fire_insurance', 'business_license', 'other')),
  title text not null check (char_length(trim(title)) between 1 and 80),
  storage_path text not null,
  mime text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
  issued_on date,
  expires_on date,
  notes text check (notes is null or char_length(notes) <= 280),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hotel_documents is '호텔 증서 보관함 메타 (화재보험·영업허가 등) — Storage hotel-documents';
comment on column public.hotel_documents.kind is 'fire_insurance · business_license · other';
comment on column public.hotel_documents.storage_path is 'bucket object path {hotel_id}/certs/{id}/{filename}';

create index hotel_documents_hotel_created_idx on public.hotel_documents(hotel_id, created_at desc);
create index hotel_documents_hotel_kind_idx on public.hotel_documents(hotel_id, kind);

create or replace function private.touch_hotel_document()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null or current_user in ('authenticated', 'anon') then
    new.updated_at := now();
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      new.created_at := now();
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.hotel_id := old.hotel_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.storage_path := old.storage_path;
  end if;
  return new;
end $$;
revoke all on function private.touch_hotel_document() from public, anon, authenticated;
create trigger hotel_documents_touch before insert or update on public.hotel_documents
for each row execute function private.touch_hotel_document();

alter table public.hotel_documents enable row level security;
create policy hotel_documents_select on public.hotel_documents for select to authenticated
  using ((select private.is_hotel_member(hotel_id)));
create policy hotel_documents_insert on public.hotel_documents for insert to authenticated
  with check ((select private.is_hotel_member(hotel_id)));
create policy hotel_documents_update on public.hotel_documents for update to authenticated
  using ((select private.is_hotel_member(hotel_id)))
  with check ((select private.is_hotel_member(hotel_id)));
create policy hotel_documents_delete on public.hotel_documents for delete to authenticated
  using ((select private.is_hotel_member(hotel_id)));
revoke all on public.hotel_documents from anon, authenticated;
grant select, insert, delete on public.hotel_documents to authenticated;
grant update (kind, title, mime, issued_on, expires_on, notes, updated_at) on public.hotel_documents to authenticated;

-- Storage bucket (private · 20MB · PDF/JPEG/PNG)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hotel-documents',
  'hotel-documents',
  false,
  20971520,
  array['application/pdf', 'image/jpeg', 'image/png']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path folder[1] = hotel_id
create policy hotel_documents_obj_select on storage.objects for select to authenticated
  using (
    bucket_id = 'hotel-documents'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select private.is_hotel_member(((storage.foldername(name))[1])::uuid))
  );
create policy hotel_documents_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'hotel-documents'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select private.is_hotel_member(((storage.foldername(name))[1])::uuid))
  );
create policy hotel_documents_obj_update on storage.objects for update to authenticated
  using (
    bucket_id = 'hotel-documents'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select private.is_hotel_member(((storage.foldername(name))[1])::uuid))
  )
  with check (
    bucket_id = 'hotel-documents'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select private.is_hotel_member(((storage.foldername(name))[1])::uuid))
  );
create policy hotel_documents_obj_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'hotel-documents'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select private.is_hotel_member(((storage.foldername(name))[1])::uuid))
  );
