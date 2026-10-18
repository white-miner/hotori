// 예시 호텔 매점 물품과 예시 판매를 만드는 SQL을 출력해요. 예약·객실 설정은 건드리지 않아요.
// 사용: node scripts/demo-shop-seed.mjs <예시 호텔 uuid> [오늘 영업일 YYYY-MM-DD] [오늘 마지막 판매 시각 HH:MM] > shop-seed.sql
// 그 호텔의 기존 매점 판매는 지워지고 다시 만들어져요. 예시 호텔(is_demo)에만 써져요.
import { SHOP_ITEMS } from "./demo-shop-items.mjs";

const HOTEL = process.argv[2];
if (!/^[0-9a-f-]{36}$/.test(HOTEL ?? "")) throw new Error("hotel uuid가 필요해요");
const BASE = process.argv[3] ?? new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // KST-6h 영업일
const LAST = process.argv[4] ?? "21:00";
const addDays = (d, n) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647), (seed - 1) / 2147483646);
const W = { "i-ramen": 5, "i-snack": 2, "i-cola": 3, "i-water": 4, "i-beer": 3, "i-brush": 1, "i-keyring": 0.6 };
const pick = () => {
  const sum = Object.values(W).reduce((a, b) => a + b, 0);
  let r = rnd() * sum;
  for (const it of SHOP_ITEMS) if ((r -= W[it.id]) <= 0) return it;
  return SHOP_ITEMS[0];
};
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
const rows = [];
for (let back = 40; back >= 0; back--) {
  const d = addDays(BASE, -back);
  const n = back === 0 ? 9 : 4 + Math.floor(rnd() * 10);
  // 오후 2시 ~ 새벽 1시(KST)에 팔려요. 오늘은 LAST 전까지만
  const [lh, lm] = LAST.split(":").map(Number);
  const startMin = 14 * 60;
  const endMin = back === 0 ? lh * 60 + lm : 25 * 60;
  const times = Array.from({ length: n }, () => startMin + Math.floor(rnd() * (endMin - startMin))).sort((a, b) => a - b);
  for (const t of times) {
    const it = pick();
    const utc = new Date(Date.parse(`${d}T00:00:00Z`) + (t - 9 * 60) * 60e3 + Math.floor(rnd() * 60) * 1e3).toISOString();
    rows.push(`(${q(HOTEL)},${q(it.id)},${q(it.name)},${it.price},1,${q(d)},${q(utc)})`);
  }
}
console.log(`begin;
update public.hotels set settings = settings || jsonb_build_object('shopItems', ${q(JSON.stringify(SHOP_ITEMS))}::jsonb) where id = ${q(HOTEL)} and is_demo;
delete from public.shop_sales where hotel_id = ${q(HOTEL)} and (select is_demo from public.hotels where id = ${q(HOTEL)});
insert into public.shop_sales (hotel_id,item_id,item_name,unit_price,qty,biz_date,created_at)
select v.hotel_id::uuid, v.item_id, v.item_name, v.unit_price, v.qty::smallint, v.biz_date::date, v.created_at::timestamptz from (values
${rows.join(",\n")}
) as v(hotel_id,item_id,item_name,unit_price,qty,biz_date,created_at)
where (select is_demo from public.hotels where id = v.hotel_id::uuid);
commit;`);
