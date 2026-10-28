-- 단체 결제 점검 (읽기 전용 · SELECT만). 삭제/수정 없음.
-- 목록을 먼저 확인하고, 지울 대상은 소유자 승인 후 별도로 처리하세요.

-- 1) 같은 단체·같은 금액·같은 날짜인 결제가 객실마다 따로 있는 묶음 (한 번 받은 돈이 객실별로 복제됐을 가능성)
select b.group_id, p.amount, p.biz_date, p.method, count(*) as rows_n,
       array_agg(p.id order by p.created_at) as payment_ids,
       array_agg(p.booking_id order by p.created_at) as booking_ids
from public.booking_payments p
join public.bookings b on b.id = p.booking_id
where b.group_id is not null
group by b.group_id, p.amount, p.biz_date, p.method
having count(*) > 1
order by b.group_id, p.biz_date;

-- 2) 객실 결제와 단체 결제가 함께 섞인 단체
select b.group_id, count(distinct p.id) filter (where p.booking_id is not null and p.group_id is null) as room_rows,
       count(distinct gp.id) as group_rows
from public.bookings b
left join public.booking_payments p on p.booking_id = b.id
left join public.booking_payments gp on gp.group_id = b.group_id
where b.group_id is not null
group by b.group_id
having count(distinct p.id) > 0 and count(distinct gp.id) > 0;

-- 3) 메모에 '배분'이 들어간 결제 (옛 배분 기능이 만든 줄)
select id, booking_id, group_id, amount, biz_date, note from public.booking_payments where note like '%배분%';
