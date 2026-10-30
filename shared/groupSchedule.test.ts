import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings, stockTable, type Booking } from "./ledger";
import { groupDrafts } from "./group";
import { groupLedger } from "./groupLedger";
import { groupEvidenceText } from "./groupEvidence";
import { saveScheduleChanges, scheduleClashes, scheduleDirty, scheduleEdit, scheduleLock, scheduleMatches, schedulePlan, scheduleUpdateRow, validDate, type ScheduleChange } from "./groupSchedule";
import { parseStayNightRates } from "./nightrates";
import { planOpsExtend } from "./extend";
import { cardCharges } from "./cardCharges";

const thu = "2026-10-29", fri = "2026-10-30", sat = "2026-10-31", sun = "2026-11-01";
const s = normalizeSettings({ types: [{ id: "std", name: "스탠다드" }, { id: "bath", name: "스탠다드 욕조" }], platforms: [{ id: "walk", name: "현장", onsite: true }], floors: [{ id: "f", name: "검증층", rooms: ["std", "bath"].flatMap(typeId => [1, 2, 3].map(n => ({ id: `${typeId}-${n}`, no: `검증-${typeId}-${n}`, typeId }))) }] });
function bookings(): Booking[] {
  return groupDrafts({ s, groupId: "g", groupName: "검증 단체A", platformId: "walk", checkIn: thu, nights: 2,
    roomIds: ["std-1", "std-2", "std-3", "bath-1", "bath-2", "bath-3"], prices: [],
    memberNightRates: [0, 1, 2, 3, 4, 5].map(i => ({ nights: { [thu]: i < 3 ? 60000 : 70000, [fri]: i < 3 ? 80000 : 90000 } })),
  }).map((b, i) => ({ ...b, id: `booking-${i}`, updatedAt: "2026-10-30T00:00:00Z", arrived: true, memo: `보존-${i}`,
    payments: i === 0 ? [{ id: "receipt-card", bookingId: "booking-0", kind: "deposit", method: "card", amount: 40000, bizDate: thu, createdAt: thu }] : [] }));
}
function change(b: Booking, out: string, amounts: Record<string, number> = {}): ScheduleChange {
  const e = scheduleEdit(b); const p = schedulePlan(b, { ...e, out, rates: { ...e.rates, ...amounts } });
  assert.equal(p.error, null); assert.ok(p.patch); return { before: b, patch: p.patch };
}
test("배정 단체 일부만 금요일 퇴실: 6→4실, 73만원, 배정·수납·나머지 예약 보존", async () => {
  const original = bookings(); const snapshot = JSON.stringify(original);
  const changes = [change(original[2]!, fri), change(original[5]!, fri)];
  let db = structuredClone(original); const writes: string[] = [];
  const result = await saveScheduleChanges(changes, { read: async ids => db.filter(b => ids.includes(b.id)), update: async c => { writes.push(c.before.id); const next = { ...db.find(b => b.id === c.before.id)!, ...c.patch, updatedAt: "2026-10-30T01:00:00Z" }; db = db.map(b => b.id === next.id ? next : b); return next; } });
  assert.equal(result.error, null); assert.equal(result.saved.length, 2); assert.equal(writes.length, 2);
  assert.equal(JSON.stringify(original), snapshot, "계획은 원본을 변경하지 않는다");
  for (let i = 0; i < db.length; i++) {
    const a = original[i]!, b = db[i]!;
    assert.deepEqual([b.id, b.roomId, b.groupId, b.groupName, b.arrived, b.checkedOutAt, b.memo, b.payments], [a.id, a.roomId, a.groupId, a.groupName, a.arrived, a.checkedOutAt, a.memo, a.payments]);
    if (![2, 5].includes(i)) assert.deepEqual(b, a, "미수정 예약은 쓰지 않는다");
  }
  const ledger = groupLedger(db, 500000, fri); assert.equal(ledger.due, 730000); assert.equal(ledger.paid, 540000); assert.equal(ledger.owed, 190000);
  const stock = stockTable(s, db, [thu, fri, sat]); for (const t of ["std", "bath"]) assert.deepEqual([stock.get(t)?.get(thu), stock.get(t)?.get(fri), stock.get(t)?.get(sat)], [0, 1, 3]);
});
test("일부 객실 연장: 새 박은 명시 입력, 기존 단가·추가 항목·할인·이동 보존", () => {
  const b = { ...bookings()[0]!, segments: [{ roomId: "std-1", nights: 1 }, { roomId: "std-2", nights: 1 }], price: 165000,
    nightRates: { nights: { [thu]: 60000, [fri]: 80000 }, extras: [{ name: "이불", amount: 10000 }, { name: "인원", amount: 20000, perNight: 10000 }] } };
  const e = scheduleEdit(b);
  assert.match(schedulePlan(b, { ...e, out: sun }).error!, /2026-10-31/);
  const c = change(b, sun, { [sat]: 110000 });
  assert.equal(c.patch.price, 285000); assert.deepEqual(c.patch.segments, [{ roomId: "std-1", nights: 1 }, { roomId: "std-2", nights: 2 }]);
  assert.deepEqual(c.patch.nightRates?.nights, { [thu]: 60000, [fri]: 80000, [sat]: 110000 });
  assert.equal(c.patch.nightRates?.extras?.[0]?.amount, 10000); assert.equal(c.patch.nightRates?.extras?.[1]?.amount, 30000);
});
test("기존 총액으로 단가를 추측하지 않고 전체 박 입력과 총액 변경 동의 요구", () => {
  const b = { ...bookings()[0]!, nightRates: null, price: 140000 }; const e = scheduleEdit(b);
  assert.deepEqual(e.rates, { [thu]: null, [fri]: null }); assert.equal(scheduleDirty(b, e), false);
  assert.match(schedulePlan(b, { ...e, out: sun }).error!, /요금/);
  const filled = { ...e, rates: { [thu]: 60000, [fri]: 80000 }, replaceTotal: false };
  assert.match(schedulePlan(b, filled).error!, /동의/);
  assert.equal(schedulePlan(b, { ...filled, replaceTotal: true }).patch?.price, 140000);
});
test("퇴실·취소·장기 예약 보호, 날짜와 금액 검증", () => {
  const b = bookings()[0]!;
  for (const locked of [{ ...b, checkedOutAt: `${fri}T03:00:00Z` }, { ...b, earlyOut: fri }, { ...b, status: "cancelled" as const }, { ...b, stayMode: "long_stay" as const }]) {
    assert.ok(scheduleLock(locked)); assert.ok(schedulePlan(locked, { ...scheduleEdit(locked), out: sun }).error);
  }
  for (const d of ["2026-02-30", "2026-13-01", "", "wat"]) { assert.equal(validDate(d), false); assert.ok(schedulePlan(b, { ...scheduleEdit(b), out: d }).error); }
  for (const amount of [-1, 1.5, Infinity, 100000001]) assert.ok(schedulePlan(b, { ...scheduleEdit(b), rates: { [thu]: amount, [fri]: 80000 } }).error);
});
test("다른 직원의 수정·단체 이동을 감지하면 쓰기 전 중단", async () => {
  const bs = bookings(), c = change(bs[0]!, fri); let writes = 0;
  for (const changed of [{ ...bs[0]!, updatedAt: "v2" }, { ...bs[0]!, groupId: "other" }]) {
    const result = await saveScheduleChanges([c], { read: async () => [changed], update: async () => { writes++; return changed; } });
    assert.ok(result.error); assert.equal(result.saved.length, 0);
  } assert.equal(writes, 0);
});
test("부분 성공 표시·후속 중단, 응답 유실 조회 확인과 이중 쓰기 방지", async () => {
  const bs = bookings(), cs = [change(bs[0]!, fri), change(bs[1]!, fri), change(bs[2]!, fri)];
  let db = structuredClone(bs), writes = 0;
  const r = await saveScheduleChanges(cs, { read: async ids => db.filter(b => ids.includes(b.id)), update: async c => { writes++; if (writes === 2) throw Error("network"); const b = { ...c.before, ...c.patch, updatedAt: "v2" }; db = db.map(x => x.id === b.id ? b : x); return b; } });
  assert.ok(r.error); assert.equal(r.saved.length, 1); assert.equal(writes, 2); assert.equal(db[2]!.nights, 2);
  db = structuredClone(bs); writes = 0;
  const verified = await saveScheduleChanges([cs[0]!], { read: async ids => db.filter(b => ids.includes(b.id)), update: async c => { writes++; db = db.map(b => b.id === c.before.id ? { ...b, ...c.patch, updatedAt: "v2" } : b); throw Error("lost response"); } });
  assert.equal(verified.error, null); assert.equal(verified.saved.length, 1); assert.equal(writes, 1); assert.ok(scheduleMatches(db[0]!, cs[0]!));
});
test("같은 단체의 다른 예약까지 연장 객실 겹침 검사", () => {
  const bs = bookings(), other = { ...bs[1]!, id: "next-guest", roomId: bs[0]!.roomId, checkIn: sat, nights: 1 };
  assert.deepEqual(scheduleClashes([...bs, other], [change(bs[0]!, sun, { [sat]: 110000 })]).map(c => [c.date, c.otherId]), [[sat, "next-guest"]]);
  assert.equal(scheduleClashes(bs, [change(bs[0]!, fri)]).length, 0);
});
test("청구 495,000원·수납 540,000원의 실제 초과 근거", () => {
  const b = { ...bookings()[0]!, nights: 3, price: 495000, nightRates: { nights: { [thu]: 165000, [fri]: 165000, [sat]: 165000 } }, payments: [] };
  const g = groupLedger([b], 540000, fri), text = groupEvidenceText(g, () => "본관 701호");
  assert.equal(g.prepaid, 45000); assert.match(text, /540,000원 − 전체 청구 495,000원 = 초과 수납 45,000원/); assert.match(text, /본관 701호/);
});
test("0원 단가의 유료 연장은 거부, 명시한 서비스만 무료·후불은 수납 없이 요금 가산", () => {
  const b = { ...bookings()[0]!, price: 0, nightRates: null };
  for (const method of ["card", "cash", "transfer", "deferred"] as const) assert.ok("err" in planOpsExtend(b, { rate: 0, method, bizDate: fri }));
  const service = planOpsExtend(b, { rate: 0, method: "service", bizDate: fri }); assert.ok(!("err" in service));
  assert.ok("err" in planOpsExtend({ ...b, checkedOutAt: `${fri}T03:00:00Z` }, { rate: 90000, method: "deferred", bizDate: fri }));
  const deferred = planOpsExtend(b, { rate: 90000, method: "deferred", bizDate: fri }); assert.ok(!("err" in deferred)); if (!("err" in deferred)) { assert.equal(deferred.draft.price, 90000); assert.equal(deferred.collectAmount, 0); assert.equal(deferred.draft.nightRates?.nights?.[sat], 90000); assert.equal(deferred.draft.nightRates?.flat, null); assert.equal(deferred.draft.nightRates?.nights?.[thu], undefined, "과거 약정은 추측해 채우지 않는다"); }
});
test("카드 약정은 실제 저장값만: 미등록·0원과 미수를 구분", () => {
  const b = bookings()[0]!, platform = s.platforms[0]!;
  const full = cardCharges(b, null, platform, fri); assert.equal(full.due, 100000); assert.deepEqual(full.nights.map(n => n.amount), [60000, 80000]);
  const unknown = cardCharges({ ...b, price: 0, nightRates: null }, null, platform, fri); assert.equal(unknown.needsPrice, true); assert.ok(unknown.nights.every(n => n.amount === null));
});
test("DB 수정 열은 일정·요금만, JSON 직렬화 후에도 저장 확인이 일치한다", () => {
  const c = change(bookings()[0]!, fri), row = scheduleUpdateRow(c.patch);
  assert.deepEqual(Object.keys(row).sort(), ["nights", "price", "price_unset", "night_rates", "open_ended", "room_segments"].sort());
  assert.ok(scheduleMatches({ ...c.before, ...c.patch, nightRates: parseStayNightRates(row.night_rates), updatedAt: "v2" }, c));
  const hostile = { ...c.patch, roomId: "other", payments: [], groupId: "other", arrived: false, checkedOutAt: "now" };
  assert.deepEqual(scheduleUpdateRow(hostile), row, "배정·수납·단체·입퇴실 속성은 쓰기 요청에서 제외");
});
