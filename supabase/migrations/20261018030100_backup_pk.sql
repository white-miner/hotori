-- 백업 표에 기본 키 (성능 권고 반영). 내용은 그대로예요.
alter table private.hotel_settings_backup add column if not exists id bigint generated always as identity primary key;
