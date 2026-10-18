// 주차 관리: 기본 꺼짐 · 추가 차량 요금(2번째 차부터 1대 × 1박) · 도보 할인 · 차량번호 검색 · 주차 현황
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking, boardTabFromHash, normalizeSettings, revenueOf } from "./ledger";
import { autoCarFee, autoWalkOff, cleanPlates, filterParking, normPlate, parkingMark, parkingRows, parkingTotals, plateMatches } from "./parking";
import { settle } from "./settle";

const base = { types: [{ id: "t", name: "T" }], platforms: [{ id: "w", name: "현장·전화", abbr: "현" }], floors: [{ id: "f", name: "1층", rooms: [{ id: "r1", no: "101", typeId: "t" }, { id: "r2", no: "102", typeId: "t" }] }] };
const OFF = normalizeSettings(base as never);
const ON = normalizeSettings({ ...base, parking: { enabled: true, extraCarFee: 10000, walkDiscount: 5000 } } as never);
const bk = (p: Partial<Booking>): Booking => ({
  id: "b", kind: "stay", status: "active", platformId: "w", price: 100000, guestName: "손님", typeId: "t", roomId: "r1", checkIn: "2026-10-19", nights: 2,
  startTime: null, endTime: null, arrived: false, memo: null, cancelledAt: null, createdAt: "", updatedAt: "", ...p,
});

test("기본은 꺼짐 · 켜면 요금 기본 1만 원 · 주차 탭 주소", () => {
  assert.deepEqual(OFF.parking, { enabled: false, extraCarFee: 10000, walkDiscount: 0 });
  assert.equal(normalizeSettings({ parking: { enabled: "yes" } } as never).parking.enabled, false);
  assert.equal(autoCarFee(OFF, "car", 3, 2), 0);
  assert.equal(boardTabFromHash("#/board/parking"), "parking");
});

test("추가 차량: 2번째 차부터 1대 × 1박 × 박수 · 도보 할인은 1번", () => {
  assert.equal(autoCarFee(ON, "car", 1, 2), 0);
  assert.equal(autoCarFee(ON, "car", 3, 2), 40000);
  assert.equal(autoCarFee(ON, "walk", 3, 2), 0);
  assert.equal(autoCarFee(ON, "car", 2, null), 10000);
  assert.equal(autoWalkOff(ON, "walk"), 5000);
  assert.equal(autoWalkOff(ON, "car"), 0);
  assert.equal(revenueOf(bk({ price: 140000, arrival: "car", cars: 3, carFee: 40000 })), 140000);
});

test("차량번호: 띄어쓰기 무시 검색 · 대수만큼 저장", () => {
  assert.equal(normPlate("12가 3456"), "12가3456");
  const b = bk({ arrival: "car", cars: 2, plates: ["12가 3456", "34나5678"] });
  assert.ok(plateMatches(b, "3456"));
  assert.ok(plateMatches(b, "12가3456"));
  assert.ok(plateMatches(b, "34나 56"));
  assert.ok(!plateMatches(b, "9"));
  assert.deepEqual(cleanPlates(["  12가  3456 ", "", "x"], 2), ["12가 3456"]);
  assert.equal(parkingMark(b), "차2");
  assert.equal(parkingMark(bk({ arrival: "car" })), "차");
  assert.equal(parkingMark(bk({ arrival: "walk" })), "도보");
  assert.equal(parkingMark(bk({})), null);
});

test("주차 현황: 그날 밤 묵는 손님 + 대실, 취소 빼고, 필터", () => {
  const list = [
    bk({ id: "a", arrival: "car", cars: 2, plates: ["12가 3456", "34나 5678"] }),
    bk({ id: "b", roomId: "r2", checkIn: "2026-10-18", nights: 3, arrival: "walk" }),
    bk({ id: "c", roomId: "r2", checkIn: "2026-10-19", kind: "dayuse", nights: null, startTime: "10:00", endTime: "14:00", arrival: "car" }),
    bk({ id: "d", status: "cancelled", arrival: "car" }),
    bk({ id: "e", checkIn: "2026-10-21", arrival: "car" }),
    bk({ id: "f", roomId: "r2", checkIn: "2026-10-19", nights: 1 }),
  ];
  const rows = parkingRows(list, "2026-10-19");
  assert.deepEqual(rows.map((r) => [r.b.id, r.when, r.cars]), [["a", "in", 2], ["b", "stay", 0], ["c", "dayuse", 1], ["f", "in", 0]]);
  assert.deepEqual(parkingTotals(rows), { cars: 3, carRooms: 2, walk: 1, unset: 1 });
  const no = (id: string | null) => (id === "r1" ? "101" : "102");
  assert.deepEqual(filterParking(rows, "car", "", no).map((r) => r.b.id), ["a", "c"]);
  assert.deepEqual(filterParking(rows, "all", "5678", no).map((r) => r.b.id), ["a"]);
  assert.deepEqual(filterParking(rows, "all", "102", no).map((r) => r.b.id), ["b", "c", "f"]);
  assert.deepEqual(filterParking(rows, "unset", "", no).map((r) => r.b.id), ["f"]);
});

test("단체 정산: 주차 금액은 따로 한 줄", () => {
  const m = [bk({ id: "1", groupId: "g", price: 110000, arrival: "car", cars: 2, carFee: 10000 }), bk({ id: "2", groupId: "g", roomId: "r2", price: 95000, arrival: "walk", walkOff: 5000 })];
  const st = settle(m, null, { name: "현장·전화" });
  assert.equal(st.parking, 5000);
  assert.equal(st.roomSum, 200000);
  assert.equal(st.total, 205000);
});
