import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings, stockTable, stayEnd } from "./ledger";
import { buildGroupDailyPlan, groupDailyDrafts, type GroupDailyPlan } from "./groupDailyPlan";
import { groupLedger } from "./groupLedger";

const s = normalizeSettings({ types: [{ id: "std", name: "스탠다드" }, { id: "bath", name: "스탠다드 욕조" }], platforms: [{ id: "walk", name: "현장", onsite: true }], floors: [{ id: "test-floor", name: "검증층", rooms: ["std", "bath"].flatMap((typeId) => [1, 2, 3].map((n) => ({ id: `${typeId}-${n}`, no: `검증-${typeId}-${n}`, typeId }))) }] });
const thu = "2026-10-29", fri = "2026-10-30", sat = "2026-10-31";
const plan: GroupDailyPlan = {
  std: { [thu]: { rooms: 3, rate: 60000 }, [fri]: { rooms: 2, rate: 80000 } },
  bath: { [thu]: { rooms: 3, rate: 70000 }, [fri]: { rooms: 2, rate: 90000 } },
};
const opts = { s, groupId: "test-group", groupName: "검증 단체A", platformId: "walk" };

test("목요일 6실→금요일 4실: 객실별 퇴실일·날짜별 단가·단체 청구 730,000원", () => {
  const before=JSON.stringify(plan), result=buildGroupDailyPlan(s,thu,2,plan);
  assert.equal(result.error,null);
  assert.equal(result.members.length,6); assert.equal(result.roomNights,10); assert.equal(result.total,730000);
  assert.deepEqual(result.days,[{date:thu,rooms:6,total:390000,arrivals:6,departures:0},{date:fri,rooms:4,total:340000,arrivals:0,departures:2}]);
  const drafts=groupDailyDrafts(result,opts);
  assert.equal(new Set(drafts.map((b)=>b.id)).size,6);
  assert.ok(drafts.every((b)=>b.groupId===opts.groupId && b.roomId===null && !b.checkedOutAt && !b.arrived));
  assert.deepEqual(drafts.filter((b)=>b.typeId==="std").map((b)=>[b.nights,b.price]),[[2,140000],[2,140000],[1,60000]]);
  assert.deepEqual(drafts.filter((b)=>b.typeId==="bath").map((b)=>[b.nights,b.price]),[[2,160000],[2,160000],[1,70000]]);
  assert.equal(drafts.filter((b)=>stayEnd(b)===fri).length,2);
  assert.equal(drafts.filter((b)=>stayEnd(b)===sat).length,4);
  assert.deepEqual(drafts[2]!.nightRates!.nights,{[thu]:60000},"퇴실한 방에 금요일 단가를 넣지 않는다");
  const stock=stockTable(s,drafts,[thu,fri,sat]);
  for(const typeId of ["std","bath"]) assert.deepEqual([stock.get(typeId)?.get(thu),stock.get(typeId)?.get(fri),stock.get(typeId)?.get(sat)],[0,1,3]);
  const ledger=groupLedger(drafts,0,fri);
  assert.equal(ledger.due,730000); assert.equal(ledger.paid,0); assert.equal(ledger.rooms.reduce((n,r)=>n+r.nights,0),10);
  assert.equal(JSON.stringify(plan),before);
});

test("감소 후 증가: 남은 객실은 연박, 추가 객실은 별도 입실이며 기간 밖 값은 저장하지 않는다", () => {
  const result=buildGroupDailyPlan(s,thu,3,{std:{[thu]:{rooms:2,rate:60000},[fri]:{rooms:1,rate:80000},[sat]:{rooms:2,rate:90000},"2026-11-01":{rooms:60,rate:999999}}});
  assert.equal(result.error,null);
  assert.deepEqual(result.members.map((m)=>[m.checkIn,m.nights,m.price]),[[thu,3,230000],[thu,1,60000],[sat,1,90000]]);
  assert.equal(result.days[2]!.arrivals,1);
  const gap=buildGroupDailyPlan(s,thu,3,{std:{[thu]:{rooms:2,rate:60000},[fri]:{rooms:0,rate:null},[sat]:{rooms:2,rate:90000}}});
  assert.equal(gap.members.length,4); assert.equal(gap.roomNights,4);
  assert.ok(gap.members.every((m)=>m.nights===1));
});

test("요금·실 수·타입·기간 검증: 미입력이나 잘못된 값을 자동 보정하여 저장하지 않는다", () => {
  for(const patch of [{rooms:3,rate:null},{rooms:3,rate:0},{rooms:3,rate:1.5},{rooms:3,rate:Infinity},{rooms:-1,rate:60000},{rooms:1.5,rate:60000},{rooms:61,rate:60000}]) assert.ok(buildGroupDailyPlan(s,thu,1,{std:{[thu]:patch}}).error);
  assert.ok(buildGroupDailyPlan(s,thu,1,{unknown:{[thu]:{rooms:2,rate:60000}}}).error);
  assert.ok(buildGroupDailyPlan(s,"2026-02-30",1,plan).error);
  assert.ok(buildGroupDailyPlan(s,thu,0,plan).error);
  assert.ok(buildGroupDailyPlan(s,thu,2,{}).error);
  const bad=buildGroupDailyPlan(s,thu,2,{std:{[thu]:{rooms:1,rate:60000}}});
  assert.throws(()=>groupDailyDrafts(bad,opts));
});
