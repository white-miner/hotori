// 단체 정산: 타입별 요금 × 박수, 취소 빼고 · 노쇼 넣고 · 환불 빼고 · 추가 인원 · 추가 항목 · 나눠 받기
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Booking } from "./ledger";
import type { Payment } from "./payment";
import { type GroupInfo, emptyGroupInfo, rateFormula, ratePrices, settle, settleBadge, validateExtra } from "./settle";
import { groupDrafts } from "./group";
import { normalizeSettings } from "./ledger";

const S = normalizeSettings({
  types: [{ id: "s", name: "S" }, { id: "t", name: "T" }],
  platforms: [{ id: "n", name: "네이버", abbr: "네" }],
  floors: [{ id: "f", name: "1층", rooms: [...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, no: `10${i}`, typeId: "s" })), ...Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, no: `20${i}`, typeId: "t" }))] }],
});
const roomIds = [...Array.from({ length: 10 }, (_, i) => `s${i}`), ...Array.from({ length: 4 }, (_, i) => `t${i}`)];
const rates = { s: 50000, t: 70000 };
const prices = ratePrices(roomIds.map((id) => (id.startsWith("s") ? "s" : "t")), rates, 12);
const members = (): Booking[] =>
  groupDrafts({ groupId: "g", groupName: "한라건설", platformId: "n", checkIn: "2026-11-03", nights: 12, roomIds, prices, s: S }).map((b, i) => ({ ...b, id: `m${i}` }));
const info = (p: Partial<GroupInfo> = {}): GroupInfo => ({ ...emptyGroupInfo("g"), payMode: "postpaid", dueOn: "2026-11-15", payerCompany: "(주)한라건설", rates, ...p });
const pay = (amount: number, method: "card" | "cash" = "card"): Payment => ({ id: `p${amount}`, bookingId: "g", kind: "balance", method, amount, bizDate: "2026-11-15", createdAt: "" });
const OTA = { name: "네이버" };

test("타입별 1박 요금 × 박수: 10×50,000×12 + 4×70,000×12 = 9,360,000", () => {
  assert.equal(prices.reduce((a, b) => a + b, 0), 9360000);
  assert.equal(rateFormula([{ label: "S", n: 10, rate: 50000 }, { label: "T", n: 4, rate: 70000 }, { label: "SD", n: 0, rate: 1 }], 12), "S 10실 × 50,000 × 12박 + T 4실 × 70,000 × 12박");
  const st = settle(members(), info(), OTA);
  assert.deepEqual(st.lines.map((l) => [l.typeId, l.rooms, l.nights, l.rate, l.subtotal]), [["s", 10, 120, 50000, 6000000], ["t", 4, 48, 70000, 3360000]]);
  assert.equal(st.total, 9360000);
  assert.equal(st.left, 9360000);
  assert.deepEqual(settleBadge(st, info()), { text: "정산 대기 9,360,000", due: true });
});

test("취소 빼고 · 노쇼 넣고 · 중도 퇴실 환불 빼고 · 추가 인원 · 가격 고친 방", () => {
  const m = members();
  m[0] = { ...m[0], status: "cancelled" }; // S 1실 취소: 600,000 빠짐
  m[1] = { ...m[1], status: "noshow" }; // 노쇼는 그대로 청구
  m[2] = { ...m[2], earlyOut: "2026-11-10", refund: 250000 };
  m[10] = { ...m[10], price: 840000 + 60000, extraFee: 60000, guests: 4 }; // T 추가 인원 60,000
  m[11] = { ...m[11], price: 800000 }; // T 가격 고침 (840,000 → 800,000)
  const st = settle(m, info({ extras: [{ name: "매점 외상", amount: 45000 }] }), OTA);
  assert.deepEqual(st.cancelled, { rooms: 1, amount: 600000 });
  assert.equal(st.noshowRooms, 1);
  assert.equal(st.lines[0].rooms, 9);
  assert.equal(st.lines[0].noshow, 1);
  assert.equal(st.roomSum, 5400000 + 3360000 - 40000);
  assert.equal(st.extraGuests, 60000);
  assert.equal(st.extras, 45000);
  assert.equal(st.refunds, 250000);
  assert.equal(st.total, 5400000 + 3320000 + 60000 + 45000 - 250000);
});

test("나눠 받기: 받은 돈이 쌓이고, 0이 되면 정산 완료 · 방에 받은 선금도 같이", () => {
  const m = members();
  m[3] = { ...m[3], payments: [{ ...pay(360000, "cash"), kind: "deposit" }] };
  const st1 = settle(m, info({ payments: [pay(5000000)] }), OTA);
  assert.equal(st1.paid, 5360000);
  assert.equal(st1.left, 4000000);
  assert.equal(st1.settled, false);
  const st2 = settle(m, info({ payments: [pay(5000000), pay(4000000, "cash")] }), OTA);
  assert.equal(st2.left, 0);
  assert.equal(st2.settled, true);
  assert.deepEqual(settleBadge(st2, info()), { text: "정산 완료", due: false });
});

test("선결제 OTA 단체(받은 돈 없음)는 남은 금액을 따지지 않아요 · 현장 결제면 잔금", () => {
  const st = settle(members(), info({ payMode: "prepaid" }), OTA);
  assert.equal(st.tracked, false);
  assert.equal(st.left, 0);
  assert.equal(settleBadge(st, info({ payMode: "prepaid" })), null);
  const st2 = settle(members(), info({ payMode: "prepaid" }), { name: "현장·전화" });
  assert.equal(st2.left, 9360000);
  assert.deepEqual(settleBadge(st2, info({ payMode: "prepaid" })), { text: "잔금 9,360,000", due: true });
  // 정산 정보가 없는 예전 단체: 평균 1박 요금으로 보여 줘요
  const st3 = settle(members(), null, OTA);
  assert.equal(st3.lines[0].rate, 50000);
});

test("추가 항목 검사", () => {
  assert.equal(validateExtra({ name: "매점 외상", amount: 45000 }), null);
  assert.match(validateExtra({ name: " ", amount: 1 })!, /이름/);
  assert.match(validateExtra({ name: "x", amount: 0 })!, /금액/);
});
