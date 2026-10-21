// 퇴실처리(`checkedOutAt`) = 물리 점유 아님 · 활성 투숙은 계속 하드 차단
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Booking,
  boardMoveTargets,
  checkedOutRoomOverlaps,
  freeRooms,
  legConflicts,
  normalizeSettings,
  occupiesRoom,
} from "./ledger";

const S = normalizeSettings({
  types: [{ id: "s", name: "스탠다드" }],
  platforms: [{ id: "p", name: "야놀자", abbr: "야" }],
  floors: [
    {
      id: "f5",
      name: "5층",
      rooms: [
        { id: "r503", no: "503", typeId: "s" },
        { id: "r502", no: "502", typeId: "s" },
        { id: "r501", no: "501", typeId: "s" },
      ],
    },
  ],
});

let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`,
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 100000,
  guestName: `손님${n}`,
  typeId: "s",
  roomId: "r503",
  checkIn: "2026-10-19",
  nights: 1,
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

test("occupiesRoom: 퇴실처리면 false · 미퇴실 active면 true", () => {
  assert.equal(occupiesRoom(bk({ checkedOutAt: "2026-10-21T03:00:00.000Z" })), false);
  assert.equal(occupiesRoom(bk({ checkedOutAt: null })), true);
  assert.equal(occupiesRoom(bk({ status: "cancelled", checkedOutAt: null })), false);
});

test("503 퇴실완료(19~20) + 새 19~22: freeRooms에 503 · legConflicts 빈 배열", () => {
  const old = bk({
    guestName: "옛손님",
    roomId: "r503",
    checkIn: "2026-10-19",
    nights: 1,
    checkedOutAt: "2026-10-21T03:00:00.000Z",
  });
  const draft = bk({
    id: "new",
    guestName: "새손님",
    roomId: "r503",
    checkIn: "2026-10-19",
    nights: 3,
    arrived: false,
    checkedOutAt: null,
  });
  assert.equal(freeRooms(S, [old], draft).has("r503"), true);
  assert.deepEqual(legConflicts([old], draft), []);
  const overlaps = checkedOutRoomOverlaps([old], draft);
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].id, old.id);
});

test("미퇴실 투숙 겹침은 계속 하드 차단", () => {
  const live = bk({
    guestName: "투숙중",
    roomId: "r503",
    checkIn: "2026-10-19",
    nights: 2,
    checkedOutAt: null,
  });
  const draft = bk({
    id: "new",
    roomId: "r503",
    checkIn: "2026-10-19",
    nights: 3,
    arrived: false,
  });
  assert.equal(freeRooms(S, [live], draft).has("r503"), false);
  assert.equal(legConflicts([live], draft).length, 1);
  assert.deepEqual(checkedOutRoomOverlaps([live], draft), []);
});

test("객실 이동: 퇴실완료 고스트만 있으면 503 타깃 가능", () => {
  const ghost = bk({
    id: "ghost",
    roomId: "r503",
    checkIn: "2026-10-19",
    nights: 1,
    checkedOutAt: "2026-10-21T03:00:00.000Z",
  });
  const me = bk({
    id: "me",
    roomId: "r502",
    checkIn: "2026-10-19",
    nights: 2,
    checkedOutAt: null,
  });
  assert.equal(boardMoveTargets(S, [ghost, me], me, "2026-10-19").has("r503"), true);
});
