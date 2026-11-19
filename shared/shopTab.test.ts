// 매점 객실 외상 (객실 후불 · Post to Room): 매점 판매가 예약·단체 장부의 청구가 돼요. 결제가 아니에요.
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking } from "./ledger";
import { type Payment, payState } from "./payment";
import { bookingFolio, groupExtrasTotal, groupFolio } from "./folio";
import { emptyGroupInfo, settle } from "./settle";
import { type ShopSale, groupShopCharges, payLine, shopChargeLabel, shopChargeOf, shopChargesTotal, shopTabTargets, shopTotals } from "./shop";
import { methodSales } from "./execSummary";
import { paymentEntryGroupId } from "./paymentDesk";

let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`, kind: "stay", status: "active", platformId: "p", price: 140000, guestName: `손님${n}`, typeId: "s", roomId: "r301",
  checkIn: "2026-11-19", nights: 2, startTime: null, endTime: null, arrived: true, memo: null, cancelledAt: null,
  createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", segments: null, earlyOut: null, refund: null, ...p,
});
const pay = (amount: number): Payment => ({ id: `p${++n}`, bookingId: "b", kind: "balance", method: "card", amount, bizDate: "2026-11-20", createdAt: "2026-11-20T01:00:00Z" });
const sale = (p: Partial<ShopSale>): ShopSale => ({
  id: `s${++n}`, itemId: "i1", itemName: "컵라면", unitPrice: 2000, qty: 1, bizDate: "2026-11-20", createdAt: `2026-11-20T0${n % 9}:00:00Z`, method: "room", ...p,
});
const onsite = { name: "현장·전화" };
const ota = { name: "야놀자" };

test("객실 외상은 매점 매출에 들어가지만 카드·현금(받은 돈)과 따로 보여요", () => {
  const t = shopTotals([sale({ method: "card" }), sale({ method: "cash" }), sale({ method: "room", bookingId: "b1" }), sale({ method: "room", groupId: "g1", unitPrice: 3000 })]);
  assert.equal(t.amount, 9000);
  assert.deepEqual(t.pay, { card: 2000, cash: 2000, none: 0, room: 5000 });
  assert.equal(t.byItem.get("i1")?.room, 2);
  assert.equal(payLine(t.pay, String), "카드 2000 · 현금 2000 · 객실 외상 5000");
  // 장부 결제수단 합계(받은 돈)에는 넣지 않아요
  const m = methodSales({ card: 0, cash: 0, transfer: 0 }, t.pay);
  assert.equal(m.shop.total, 4000);
  assert.equal(m.shop.room, 5000);
  assert.equal(m.card + m.cash, 4000);
});

test("객실 외상 판매를 예약·단체별 청구 줄로 묶어요 (카드·현금 판매는 빼요)", () => {
  const { byBooking, byGroup } = groupShopCharges([
    sale({ bookingId: "b1", itemName: "생수", unitPrice: 1000, qty: 2 }),
    sale({ groupId: "g1" }),
    sale({ method: "cash" }),
  ]);
  assert.equal(byBooking.get("b1")?.[0]?.amount, 2000);
  assert.equal(shopChargeLabel(byBooking.get("b1")![0]!), "매점 · 생수 ×2");
  assert.equal(byGroup.get("g1")?.length, 1);
  assert.equal(byBooking.size + byGroup.size, 2);
});

test("현장 예약: 객실 요금을 다 받았어도 매점 객실 외상이 미수금으로 남고, 결제 등록으로 받으면 정산 완료", () => {
  const tab = [shopChargeOf(sale({ bookingId: "x", unitPrice: 4500 }))];
  const b = bk({ payments: [pay(140000)], shopCharges: tab });
  const f = bookingFolio(b, true, "2026-11-20");
  assert.equal(f.due, 144500);
  assert.equal(f.owed, 4500);
  assert.equal(f.label, "미수금 4,500원");
  assert.equal(payState(b, onsite, "2026-11-20").left, 4500);
  const paid = { ...b, payments: [...b.payments!, pay(4500)] };
  assert.equal(bookingFolio(paid, true, "2026-11-20").label, "정산 완료");
  // 매점 판매를 취소하면 청구도 같이 사라져요
  assert.equal(bookingFolio({ ...b, shopCharges: [] }, true, "2026-11-20").label, "정산 완료");
});

test("OTA 예약: 숙박료는 채널이 받았지만 매점 객실 외상은 현장에서 받을 돈", () => {
  const b = bk({ shopCharges: [shopChargeOf(sale({ bookingId: "x", unitPrice: 3000 }))] });
  const ps = payState(b, ota, "2026-11-20");
  assert.equal(ps.tracked, true);
  assert.equal(ps.left, 3000);
  assert.equal(payState({ ...b, payments: [pay(3000)] }, ota, "2026-11-20").left, 0);
  // 외상이 없으면 예전처럼 잔금 없음
  assert.equal(payState({ ...b, shopCharges: [] }, ota, "2026-11-20").tracked, false);
});

test("단체 장부: 매점 객실 외상은 단체 추가 항목처럼 청구에 더해요 (객실에 나누지 않음)", () => {
  const ms = [bk({ id: "m1", groupId: "g", price: 70000 }), bk({ id: "m2", groupId: "g", price: 80000, roomId: "r302" })];
  const info = { ...emptyGroupInfo("g"), payMode: "postpaid" as const, extras: [{ name: "세미나실", amount: 50000 }], shopCharges: [shopChargeOf(sale({ groupId: "g", unitPrice: 6000 }))], payments: [pay(200000)] };
  assert.equal(groupExtrasTotal(info), 56000);
  const f = groupFolio(ms, 200000, groupExtrasTotal(info), { onsite: true, payMode: "postpaid" }, "2026-11-20");
  assert.equal(f.due, 206000);
  assert.equal(f.owed, 6000);
  const st = settle(ms, info, onsite, "2026-11-20");
  assert.equal(st.total, 206000);
  assert.equal(shopChargesTotal(info.shopCharges), 6000);
});

test("객실 외상 대상: 투숙 중 예약만, 단체는 단체 장부 하나로, 장기는 예약 장부", () => {
  const list = [
    bk({ id: "a", roomId: "302", guestName: "김" }),
    bk({ id: "g1", roomId: "305", groupId: "G", groupName: "한빛상사" }),
    bk({ id: "g2", roomId: "303", groupId: "G", groupName: "한빛상사" }),
    bk({ id: "L", roomId: "401", groupId: "G", stayMode: "long_stay", guestName: "장기" }),
  ];
  const ts = shopTabTargets(list, (b) => b.roomId, paymentEntryGroupId);
  assert.deepEqual(ts.map((t) => t.label), ["302호 · 김", "단체 한빛상사 (303·305호)", "401호 · 장기"]);
  assert.equal(ts[1]!.groupId, "G");
  assert.equal(ts[1]!.bookingId, null);
  assert.equal(ts[2]!.bookingId, "L");
});
