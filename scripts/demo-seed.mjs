// 예시 호텔 데이터를 만드는 SQL을 출력해요 (화이트보드와 같은 방 번호, 손님·금액은 모두 예시).
// 사용: node scripts/demo-seed.mjs <hotel-uuid> [기준날짜 YYYY-MM-DD] > seed.sql
// 출력된 SQL은 Supabase SQL 편집기에서 실행해요. 그 호텔의 기존 예약·지출은 지워지고 다시 만들어져요.
import { SHOP_ITEMS } from "./demo-shop-items.mjs";

const HOTEL = process.argv[2];
if (!/^[0-9a-f-]{36}$/.test(HOTEL ?? "")) throw new Error("hotel uuid가 필요해요");
const BASE = process.argv[3] ?? new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // KST-6h 영업일
const addDays = (d, n) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
const dow = (d) => new Date(d + "T00:00:00Z").getUTCDay();

const TYPES = [
  { id: "t-s", code: "S", name: "스탠다드" },
  { id: "t-t", code: "T", name: "트윈" },
  { id: "t-sd", code: "SD", name: "스탠다드 디럭스" },
  { id: "t-td", code: "TD", name: "트윈 디럭스" },
  { id: "t-bg", code: "SU", name: "스위트" },
];
const TID = Object.fromEntries(TYPES.map((t) => [t.code, t.id]));
const FL = [
  ["6층", [["601","SD"],["602","SD"],["603","SD"],["605","TD"],["606","TD"],["607","TD"],["608","TD"],["609","TD"],["610","TD"],["611","SU"]]],
  ["5층", [["501","T"],["502","T"],["503","T"],["505","SD"],["506","SD"],["507","SD"],["508","SD"],["509","SD"],["510","SD"],["511","SD"]]],
  ["3층", [["301","S"],["302","S"],["303","S"],["305","S"],["306","T"],["307","T"],["308","T"],["309","T"],["310","T"],["311","T"]]],
  ["2층", [["201","S"],["202","S"],["203","S"],["205","S"],["206","S"],["207","S"],["208","S"],["209","S"],["210","S"],["211","S"]]],
];
const FLOOR_COLORS = ["#DCE9F7", "#F8E5D6", "#E1F0DC", "#E9E3F5"]; // 화이트보드 번호줄처럼 층마다 다른 색 (예시)
const floors = FL.map(([name, rooms], i) => ({
  id: `f${i + 1}`,
  name,
  buildingId: "b-main",
  color: FLOOR_COLORS[i],
  rooms: rooms.map(([no, c]) => ({ id: `r-${no}`, no, typeId: TID[c], color: no === "611" ? "#F6EFCF" : null })),
}));
// 예시 별관: 본관과 같은 방 번호(201~203)를 써도 돼요. 방 id는 r-a201처럼 따로예요.
const ANNEX = [
  ["2층", "#D9F0EC", [["201","SD"],["202","SD"],["203","TD"]]],
  ["1층", "#F6DFE5", [["101","S"],["102","S"],["103","T"],["104","T"]]],
].map(([name, color, rooms], i) => ({
  id: `fa${2 - i}`, name, buildingId: "b-annex", color,
  rooms: rooms.map(([no, c]) => ({ id: `r-a${no}`, no, typeId: TID[c], color: null })),
}));
const PLAT = [["야","야놀자"],["여","여기어때"],["아","아고다"],["부","부킹닷컴"],["익","익스피디아"],["에","에어비앤비"],["네","네이버"],["현","현장·전화"]]
  .map(([abbr, name], i) => ({ id: `p${i + 1}`, abbr, name }));
const settings = {
  lowThreshold: 2,
  buildings: [{ id: "b-main", name: "본관" }, { id: "b-annex", name: "별관" }],
  floors: [...floors, ...ANNEX],
  types: TYPES,
  platforms: PLAT,
  shopItems: SHOP_ITEMS, // 매점 판매 예시는 scripts/demo-shop-seed.mjs
};

const ROOMS = floors.flatMap((f) => f.rooms.map((r) => ({ ...r, c: TYPES.find((t) => t.id === r.typeId).code })));
const total = Object.fromEntries(TYPES.map((t) => [t.code, ROOMS.filter((r) => r.c === t.code).length]));
const PW = [30, 26, 12, 9, 5, 4, 6, 8];
const D0 = addDays(BASE, -6);
const DAY = (i) => addDays(D0, i);
const TODAY = 6;
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (a, w) => { if (!w) return a[Math.floor(rnd() * a.length)]; let s = w.reduce((x, y) => x + y), r = rnd() * s; for (let i = 0; i < a.length; i++) { r -= w[i]; if (r < 0) return a[i]; } return a[0]; };
const SUR = "김이박최정강조윤장임한오서신권황안송류홍".split("");
const GIV = ["민수","지은","서연","현우","지훈","수빈","예린","도윤","하은","준호","유진","태민","소희","성민","다은","재원","나연","우진","채원","승현","가영","민재","은비","시우"];
const FOREIGN = ["David Segal","Tanaka Yui","Emma Wilson","Chen Wei","Sato Ren"];
const TARGET = {};
for (const t of TYPES) { TARGET[t.code] = []; for (let i = 0; i < 26; i++) { const o = [.62,.42,.38,.42,.5,.7,.8][dow(DAY(i))]; TARGET[t.code][i] = Math.min(total[t.code] - 1, Math.round(total[t.code] * o + (rnd() - .5) * 2)); } }
Object.assign(TARGET.S, { 6: 10, 11: 12, 12: 13, 19: 14, 18: 12 });
Object.assign(TARGET.T, { 6: 7, 11: 8, 12: 9 });
Object.assign(TARGET.SD, { 6: 8, 12: 11, 13: 8 });
Object.assign(TARGET.TD, { 6: 4, 11: 5, 12: 6, 19: 5 });
for (let i = 0; i < 26; i++) TARGET.SU[i] = [6, 12, 13, 19].includes(i) ? 1 : 0;
const BK = []; const occ = {}; const roomNight = {};
for (const t of TYPES) occ[t.code] = Array(40).fill(0);
for (let i = 0; i < 20; i++) for (const t of TYPES) {
  while (occ[t.code][i] < TARGET[t.code][i]) {
    let n = pick([1,1,1,2,2,3]); let k = 0; while (k < n && occ[t.code][i + k] < (TARGET[t.code][i + k] ?? 0)) k++; n = Math.max(1, k);
    const p = pick(PLAT, PW); const wkd = [5, 6].includes(dow(DAY(i)));
    const base = { S: 65000, T: 75000, SD: 85000, TD: 95000, SU: 130000 }[t.code] + (wkd ? 20000 : 0) + Math.round((rnd() - .5) * 8) * 1000;
    const name = rnd() < .08 ? pick(FOREIGN) : pick(SUR) + pick(GIV);
    let room = null; const assignP = i <= 7 ? 0.94 : 0.55;
    if (rnd() < assignP) { for (const r of ROOMS.filter((r) => r.c === t.code)) { let ok = true; for (let j = 0; j < n; j++) if (roomNight[r.no + "@" + (i + j)]) ok = false; if (ok) { room = r.id; break; } } }
    if (room) for (let j = 0; j < n; j++) roomNight[ROOMS.find((r) => r.id === room).no + "@" + (i + j)] = 1;
    for (let j = 0; j < n; j++) occ[t.code][i + j]++;
    BK.push({ kind: "stay", p: p.id, name, t: t.id, d: DAY(i), n, price: base * n, room, ok: i < TODAY || (i === TODAY && rnd() < .62) });
  }
}
// 취소·노쇼 예시 (줄 그어 보여요)
const freeToday = ROOMS.find((r) => r.c === "S" && !roomNight[r.no + "@" + TODAY]);
BK.push({ kind: "stay", p: "p2", name: "오지훈", t: TID.S, d: DAY(TODAY), n: 1, price: 85000, room: freeToday?.id ?? null, ok: false, status: "cancelled", memo: "고객 요청 취소" });
BK.push({ kind: "stay", p: "p3", name: "Emma Wilson", t: TID.T, d: DAY(TODAY), n: 2, price: 190000, room: null, ok: false, status: "noshow" });
// 객실 이동 예시: 4박 손님이 첫날은 한 방, 둘째 밤부터 다른 스탠다드 방으로 옮겨요 (예약은 하나, 장부 한 줄)
{
  const S_ROOMS = ROOMS.filter((r) => r.c === "S");
  const freeOn = (r, from, n) => Array.from({ length: n }, (_, j) => !roomNight[r.no + "@" + (from + j)]).every(Boolean);
  const a = S_ROOMS.find((r) => freeOn(r, TODAY, 1));
  const b = S_ROOMS.find((r) => r !== a && freeOn(r, TODAY + 1, 3));
  if (a && b) {
    roomNight[a.no + "@" + TODAY] = 1;
    for (let j = 1; j < 4; j++) roomNight[b.no + "@" + (TODAY + j)] = 1;
    BK.push({ kind: "stay", p: "p7", name: "문지호", t: TID.S, d: DAY(TODAY), n: 4, price: 300000, room: a.id, ok: true, memo: "예시 · 객실 이동", segs: [{ room: a.id, nights: 1 }, { room: b.id, nights: 3 }] });
  }
}
const D = DAY(TODAY);
const DAYUSE = [
  ["11:00","14:00","p8","정우성","S","207",35000,true],
  ["12:00","14:00","p1","이가영","T","308",30000,true],
  ["13:30","17:30","p2","박도윤","S","209",40000,true],
  ["16:00","20:00","p1","최서연","SD","511",45000,true],
  ["20:00","23:00","p8","한민재","S",null,35000,false],
];
// 별관 예시: 오늘 3건 + 대실 1건, 그리고 오버부킹 예시 날(오늘+6)에는 별관도 모두 차 있어요 (그래야 본관 예시 숫자가 그대로예요)
const AX = [["r-a201","SD","p3","김하은",TODAY,2,190000,true],["r-a101","S","p1","박준호",TODAY,1,72000,false],["r-a103","T","p2","윤소희",TODAY,1,79000,true]];
[["r-a101","S","p1","서지훈"],["r-a102","S","p3","홍예린"],["r-a103","T","p2","안도윤"],["r-a104","T","p1","송가영"],["r-a201","SD","p4","류민재"],["r-a202","SD","p3","신채원"],["r-a203","TD","p7","권우진"]]
  .forEach(([r, c, p, n]) => AX.push([r, c, p, n, TODAY + 6, 1, { S: 85000, T: 95000, SD: 105000, TD: 115000 }[c], false]));
for (const [room, c, p, name, i, n, price, ok] of AX) BK.push({ kind: "stay", p, name, t: TID[c], d: DAY(i), n, price, room, ok, memo: "예시 · 별관" });
DAYUSE.push(["14:00","17:00","p8","오세린","T","a104",40000,false]);
const q = (v) => (v === null || v === undefined ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
let ts = Date.parse(D0 + "T01:00:00Z");
const rows = BK.map((b) => { ts += 600e3; const c = new Date(ts).toISOString();
  return `(${q(HOTEL)},'stay',${q(b.status ?? "active")},${q(b.p)},${b.price},${q(b.name)},${q(b.t)},${q(b.room)},${b.segs ? q(JSON.stringify(b.segs)) + "::jsonb" : "null"},${q(b.d)},${b.n},null,null,${b.ok},${q(b.memo ?? null)},${q(c)},${q(c)})`; });
for (const [s, e, p, name, c, no, price, ok] of DAYUSE) { ts += 600e3; const cr = new Date(ts).toISOString();
  rows.push(`(${q(HOTEL)},'dayuse','active',${q(p)},${price},${q(name)},${q(TID[c])},${q(no ? "r-" + no : null)},null,${q(D)},null,${q(s)},${q(e)},${ok},null,${q(cr)},${q(cr)})`); }
// 지출 예시 몇 건 (기준날짜에서 며칠 전)
const EXP = [[0,"비품",32000,"cash","칫솔·면도기 2박스"],[0,"세탁",85000,"card","시트·수건 주간 세탁"],[-1,"식자재",24500,"cash","매점 음료 보충"],[-2,"수리",60000,"card","305호 샤워기 교체"],[-4,"공과금",412000,"card","전기요금"],[-21,"세탁",78000,"card","시트·수건 주간 세탁"],[-25,"비품",45000,"cash","휴지·물티슈"]];
const exRows = EXP.map(([d, c, a, m, memo]) => `(${q(HOTEL)},${q(addDays(BASE, d))},${q(c)},${a},${q(m)},${q(memo)})`);
console.log(`begin;
update public.hotels set settings = ${q(JSON.stringify(settings))}::jsonb where id = ${q(HOTEL)};
delete from public.bookings where hotel_id = ${q(HOTEL)};
insert into public.bookings (hotel_id,kind,status,platform_id,price,guest_name,type_id,room_id,room_segments,check_in,nights,start_time,end_time,arrived,memo,created_at,updated_at) values
${rows.join(",\n")};
delete from public.expenses where hotel_id = ${q(HOTEL)};
insert into public.expenses (hotel_id,biz_date,category,amount,payment_method,memo) values
${exRows.join(",\n")};
commit;`);
