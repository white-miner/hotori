// 퇴실처리 되돌리기 helper
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Booking,
  normalizeSettings,
} from "./ledger";
import {
  CHECKOUT_UNDO_CTA,
  canUndoCheckout,
  checkoutUndoBlock,
  checkoutUndoConfirmBody,
  recentCheckedOutForRoom,
  restoreCheckoutPatch,
} from "./checkoutUndo";

const S = normalizeSettings({
  types: [{ id: "s", name: "스탠다드" }],
  platforms: [{ id: "p", name: "야놀자", abbr: "야" }],
  floors: [
    {
      id: "f3",
      name: "3층",
      rooms: [
        { id: "r301", no: "301", typeId: "s" },
        { id: "r302", no: "302", typeId: "s" },
      ],
    },
  ],
});
void S;

let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`,
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 100000,
  guestName: `손님${n}`,
  typeId: "s",
  roomId: "r301",
  checkIn: "2026-10-19",
  nights: 2,
  startTime: null,
  endTime: null,
  arrived: true,
  memo: null,
  cancelledAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  segments: null,
  earlyOut: null,
  refund: null,
  checkedOutAt: null,
  ...p,
});

const label = (id: string | null) => (id === "r301" ? "301" : id === "r302" ? "302" : id);

test("canUndoCheckout · restoreCheckoutPatch", () => {
  assert.equal(canUndoCheckout(bk({ checkedOutAt: "2026-10-21T03:00:00.000Z" })), true);
  assert.equal(canUndoCheckout(bk({ checkedOutAt: null })), false);
  assert.equal(canUndoCheckout(bk({ status: "cancelled", checkedOutAt: "2026-10-21T03:00:00.000Z" })), false);
  assert.deepEqual(restoreCheckoutPatch(), { checkedOutAt: null });
  assert.equal(CHECKOUT_UNDO_CTA, "되돌리기");
});

test("recentCheckedOutForRoom: 오늘 퇴실아침 복구 가능 · 최신 1건", () => {
  const old = bk({
    id: "old",
    guestName: "옛",
    checkedOutAt: "2026-10-21T01:00:00.000Z",
  });
  const newer = bk({
    id: "new",
    guestName: "새",
    checkedOutAt: "2026-10-21T05:00:00.000Z",
  });
  const hit = recentCheckedOutForRoom([old, newer], "r301", "2026-10-21");
  assert.equal(hit?.id, "new");
  assert.equal(recentCheckedOutForRoom([old], "r302", "2026-10-21"), null);
  // 이미 입실전·이용중 밤이 지난 먼 과거는 제외
  const ancient = bk({
    id: "anc",
    checkIn: "2026-10-01",
    nights: 1,
    checkedOutAt: "2026-10-02T03:00:00.000Z",
  });
  assert.equal(recentCheckedOutForRoom([ancient], "r301", "2026-10-21"), null);
});

test("checkoutUndoBlock: 빈 방이면 null · 겹치는 투숙이면 차단", () => {
  const gone = bk({
    guestName: "문지호",
    checkedOutAt: "2026-10-21T03:00:00.000Z",
  });
  assert.equal(checkoutUndoBlock([gone], gone, "2026-10-21", label), null);

  const live = bk({
    id: "live",
    guestName: "새손님",
    roomId: "r301",
    checkIn: "2026-10-19",
    nights: 3,
    arrived: true,
    checkedOutAt: null,
  });
  const msg = checkoutUndoBlock([gone, live], gone, "2026-10-21", label);
  assert.match(msg!, /301호/);
  assert.match(msg!, /새손님/);
  assert.match(msg!, /되돌릴 수 없어요/);
});

test("checkoutUndoBlock: 당일 입실 다음 예약만 있어도 칸 충돌 차단", () => {
  const gone = bk({
    id: "gone",
    guestName: "퇴실손님",
    checkIn: "2026-10-19",
    nights: 2,
    checkedOutAt: "2026-10-21T03:00:00.000Z",
  });
  const next = bk({
    id: "next",
    guestName: "다음",
    roomId: "r301",
    checkIn: "2026-10-21",
    nights: 1,
    arrived: false,
    checkedOutAt: null,
  });
  // 밤 겹침 없음(퇴실아침)이어도 칸에 다음 예약 → 차단
  const msg = checkoutUndoBlock([gone, next], gone, "2026-10-21", label);
  assert.match(msg!, /다음/);
  assert.match(msg!, /301호/);
});

test("checkoutUndoConfirmBody: 결제 불변 안내", () => {
  const b = bk({ guestName: "김", checkedOutAt: "2026-10-21T03:00:00.000Z" });
  assert.match(checkoutUndoConfirmBody(b, "301"), /결제/);
  assert.match(checkoutUndoConfirmBody(b, "301"), /김/);
});
