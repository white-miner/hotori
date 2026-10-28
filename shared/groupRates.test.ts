// 객실별 요금표: 총액 나누기·같은 금액 복사·타입 가격 잠금이 없어야 해요.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings } from "./ledger";
import { groupLedger } from "./groupLedger";
import { groupDrafts } from "./group";
import type { PeriodBooking } from "./periodPay";
import {
  type RateEdits,
  draftRates,
  groupTotal,
  roomSlots,
  rowRateLine,
  slotRows,
  typeSlots,
  unpricedMessage,
} from "./groupRates";

const S = normalizeSettings({
  types: [{ id: "std", name: "스탠다드" }, { id: "dlx", name: "디럭스" }],
  platforms: [{ id: "p", name: "현장", abbr: "현" }],
  floors: [
    { id: "f6", name: "6층", rooms: [{ id: "r602", no: "602", typeId: "std" }] },
    { id: "f5", name: "5층", rooms: [{ id: "r501", no: "501", typeId: "dlx" }, { id: "r502", no: "502", typeId: "dlx" }] },
  ],
  weekendDays: [5, 6],
});
const info = (id: string) => {
  const r = S.floors.flatMap((f) => f.rooms).find((x) => x.id === id)!;
  return { typeId: r.typeId!, label: `${r.no}호`, sub: r.typeId === "std" ? "스탠다드" : "디럭스" };
};
const CI = "2026-10-25"; // 일 · 월 · 화 3박
const flat = (n: number, v: number): RateEdits[string] => ({
  rates: { flat: v, nights: Object.fromEntries(Array.from({ length: n }, (_, i) => [`2026-10-${25 + i}`, v])) },
});

test("602=7만 · 501=8만 · 502=8만 (10/25~10/27 3박): 소계 21만·24만·24만, 총액 69만 / 502 빼면 45만", () => {
  const slots = roomSlots(["r602", "r501", "r502"], info);
  const edits: RateEdits = { "r:r602": flat(3, 70_000), "r:r501": flat(3, 80_000), "r:r502": flat(3, 80_000) };
  const rows = slotRows(S, slots, edits, CI, 3);
  assert.deepEqual(rows.map((r) => r.subtotal), [210_000, 240_000, 240_000]);
  assert.equal(groupTotal(rows), 690_000);
  assert.equal(groupTotal(slotRows(S, slots.slice(0, 2), edits, CI, 3)), 450_000);
  // 2박이면 30만 · 46만
  assert.equal(groupTotal(slotRows(S, slots.slice(0, 3), edits, CI, 2)), 140_000 + 160_000 + 160_000);
  assert.equal(rowRateLine(rows[0]!, 3), "3박 × 70,000원");
});

test("같은 타입(501·502)이어도 방마다 가격이 달라요 · 평균·복사 없음", () => {
  const slots = roomSlots(["r501", "r502"], info);
  const edits: RateEdits = { "r:r501": flat(3, 80_000), "r:r502": flat(3, 95_000) };
  const rows = slotRows(S, slots, edits, CI, 3);
  assert.deepEqual(rows.map((r) => r.subtotal), [240_000, 285_000]);
  assert.notEqual(rows[0]!.subtotal, rows[1]!.subtotal);
  assert.equal(groupTotal(rows), 525_000);
  const { memberNightRates, prices } = draftRates(rows);
  assert.deepEqual(prices, [240_000, 285_000]);
  const ds = groupDrafts({
    groupId: "g", groupName: "단체", platformId: "p", checkIn: CI, nights: 3, roomIds: ["r501", "r502"],
    prices, memberNightRates, s: S, guestsOf: () => 2, arrived: false,
  });
  assert.deepEqual(ds.map((d) => d.price), [240_000, 285_000]);
});

test("같은 타입 · 인원/추가 이불이 달라 소계가 달라요 (추가 항목)", () => {
  const slots = roomSlots(["r501", "r502"], info);
  const edits: RateEdits = {
    "r:r501": { ...flat(3, 80_000), extras: [{ name: "인원 추가", amount: 10_000, perNight: true }] },
    "r:r502": { ...flat(3, 80_000), extras: [{ name: "추가 이불", amount: 15_000, perNight: false }] },
  };
  const rows = slotRows(S, slots, edits, CI, 3);
  assert.equal(rows[0]!.subtotal, 270_000); // 24만 + 1만×3박
  assert.equal(rows[1]!.subtotal, 255_000); // 24만 + 1.5만 한 번
  assert.equal(rows[0]!.roomCharge, 240_000);
  assert.equal(rows[0]!.extras, 30_000);
  assert.equal(rows[0]!.rates.extras?.[0]?.perNight, 10_000);
  assert.equal(rows[1]!.rates.extras?.[0]?.perNight, undefined);
  assert.equal(groupTotal(rows), 525_000);
  // 추가 항목만 있고 객실료가 0이면 미입력
  const empty = slotRows(S, slots, { "r:r501": { extras: [{ name: "x", amount: 5000, perNight: false }] } }, CI, 3);
  assert.ok(unpricedMessage(empty));
});

test("호실 미정: 타입마다 #1 #2 줄 · 줄마다 따로 가격", () => {
  const slots = typeSlots(["std", "dlx", "dlx"], (id) => ({ name: id === "std" ? "스탠다드" : "디럭스" }));
  assert.deepEqual(slots.map((x) => x.label), ["스탠다드 #1", "디럭스 #1", "디럭스 #2"]);
  assert.ok(slots.every((x) => x.sub === "호실 미정" && x.roomId === null));
  assert.equal(new Set(slots.map((x) => x.key)).size, 3);
  const rows = slotRows(S, slots, { [slots[1]!.key]: flat(2, 90_000), [slots[2]!.key]: flat(2, 110_000), [slots[0]!.key]: flat(2, 70_000) }, CI, 2);
  assert.deepEqual(rows.map((r) => r.subtotal), [140_000, 180_000, 220_000]);
});

test("요금이 없으면 0원 줄이 남아 저장을 막아요 (나눠 채우지 않아요)", () => {
  const rows = slotRows(S, roomSlots(["r602", "r501"], info), { "r:r602": flat(3, 70_000) }, CI, 3);
  assert.equal(rows[1]!.subtotal, 0);
  assert.match(unpricedMessage(rows)!, /501호/);
  assert.equal(unpricedMessage(rows.slice(0, 1)), null);
});

test("호텔 요금 제안: 특별일 > 시즌 > 주말 > 평일 > 기본 · 출처 표시 · 고치면 직접 수정", () => {
  const hs = normalizeSettings({
    types: [{ id: "std", name: "스탠다드" }, { id: "dlx", name: "디럭스" }],
    platforms: [{ id: "p", name: "현장", abbr: "현" }],
    floors: [{ id: "f", name: "1층", rooms: [{ id: "a", no: "101", typeId: "std" }, { id: "b", no: "102", typeId: "dlx" }] }],
    typeRates: { std: { weekday: 60_000, weekend: 80_000 }, dlx: { flat: 100_000 } },
    weekendDays: [5, 6],
  });
  const slots = roomSlots(["a", "b"], (id) => ({ typeId: id === "a" ? "std" : "dlx", label: id, sub: "" }));
  // 10/22(목) 10/23(금) 10/24(토)
  const rows = slotRows(hs, slots, {}, "2026-10-22", 3);
  assert.deepEqual(Object.values(rows[0]!.rates.nights ?? {}), [60_000, 80_000, 80_000]);
  assert.deepEqual(rows[0]!.sources, ["평일 요금", "주말 요금"]);
  assert.deepEqual(rows[1]!.sources, ["기본 요금"]);
  assert.equal(rows[0]!.edited, false);
  const ed = slotRows(hs, slots, { "r:a": flat(3, 65_000) }, "2026-10-22", 3);
  assert.equal(ed[0]!.edited, true);
  assert.deepEqual(ed[0]!.sources, ["직접 수정"]);
  // 다른 방은 영향 없음
  assert.equal(ed[1]!.subtotal, 300_000);
  // 시즌이 있으면 시즌 요금이 제안 (출처에 시즌 이름)
  const seasonal = normalizeSettings({
    types: [{ id: "std", name: "스탠다드" }],
    platforms: [{ id: "p", name: "현장", abbr: "현" }],
    floors: [{ id: "f", name: "1층", rooms: [{ id: "a", no: "101", typeId: "std" }] }],
    typeRates: { std: { flat: 60_000 } },
    typeSeasons: { std: [{ id: "z", name: "성수기", from: "2026-10-23", to: "2026-10-24", weekday: 120_000, weekend: 150_000 }] },
    weekendDays: [5, 6],
  });
  const srow = slotRows(seasonal, roomSlots(["a"], () => ({ typeId: "std", label: "101호", sub: "" })), {}, "2026-10-22", 3)[0]!;
  assert.deepEqual(Object.values(srow.rates.nights ?? {}), [60_000, 150_000, 150_000]);
  assert.deepEqual(srow.sources, ["기본 요금", "시즌 요금 · 성수기"]);
  // 박마다 다르면 평균 대신 범위
  assert.match(rowRateLine(rows[0]!, 3), /60,000~80,000원 \(박마다 달라요\)/);
});

test("장부: 객실별 추가 항목이 줄로 나오고 소계에 포함돼요 · 요금 범위는 객실료 기준", () => {
  const nights = { "2026-10-25": 80_000, "2026-10-26": 80_000, "2026-10-27": 80_000 };
  const b = {
    id: "x", status: "active", kind: "stay", checkIn: CI, nights: 3, price: 270_000, priceUnset: false, earlyOut: null, refund: null,
    nightRates: { flat: 80_000, nights, extras: [{ name: "인원 추가", amount: 30_000, perNight: 10_000 }] },
    payments: [], checkedOutAt: null, stayMode: null,
  } as unknown as PeriodBooking;
  const r = groupLedger([b], 0, CI).rooms[0]!;
  assert.equal(r.subtotal, 270_000);
  assert.equal(r.extraTotal, 30_000);
  assert.equal(r.extraLines[0]?.name, "인원 추가");
  assert.deepEqual([r.rateMin, r.rateMax], [80_000, 80_000]);
});
