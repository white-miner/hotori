import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking, normalizeSettings } from "./ledger";
import { barSpan, calendarLayout, markConflicts, stackLanes, type Bar } from "./calendar";

const S = normalizeSettings({
  types: [{ id: "s", name: "S" }],
  platforms: [{ id: "p", name: "야놀자", abbr: "야" }],
  buildings: [{ id: "b1", name: "본관" }, { id: "b2", name: "" }],
  floors: [
    { id: "f2", name: "2층", buildingId: "b1", rooms: [{ id: "r201", no: "201", typeId: "s" }, { id: "r202", no: "202", typeId: "s" }] },
    { id: "fa", name: "1층", buildingId: "b2", rooms: [{ id: "ra1", no: "101", typeId: "s" }] },
  ],
});
let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`, kind: "stay", status: "active", platformId: "p", price: 1, guestName: `손님${n}`, typeId: "s", roomId: null,
  checkIn: "2026-10-18", nights: 1, startTime: null, endTime: null, arrived: false, memo: null, cancelledAt: null,
  createdAt: `2026-10-01T00:00:0${n % 10}Z`, updatedAt: "2026-10-01T00:00:00Z", ...p,
});

test("막대 칸: 입실일부터 N박, 퇴실일 칸은 비어 있어요", () => {
  assert.deepEqual(barSpan("2026-10-18", 2, "2026-10-18", "2026-10-31"), { start: 0, len: 2, clipL: false, clipR: false });
  assert.deepEqual(barSpan("2026-10-20", 1, "2026-10-18", "2026-10-31"), { start: 2, len: 1, clipL: false, clipR: false });
});
test("막대 칸: 범위 밖으로 나가면 잘라서 표시", () => {
  assert.deepEqual(barSpan("2026-10-15", 5, "2026-10-18", "2026-10-31"), { start: 0, len: 2, clipL: true, clipR: false }, "10/15~10/19 밤 → 18·19만");
  assert.deepEqual(barSpan("2026-10-30", 4, "2026-10-18", "2026-10-31"), { start: 12, len: 2, clipL: false, clipR: true });
  assert.deepEqual(barSpan("2026-10-10", 30, "2026-10-18", "2026-10-24"), { start: 0, len: 7, clipL: true, clipR: true });
  assert.equal(barSpan("2026-10-16", 2, "2026-10-18", "2026-10-31"), null, "10/17 밤까지 → 18일 퇴실, 안 보여요");
  assert.equal(barSpan("2026-11-01", 1, "2026-10-18", "2026-10-31"), null);
});

const bar = (b: Booking, start: number, len: number): Bar => ({ b, span: { start, len, clipL: false, clipR: false }, conflict: false });

test("같은 방 겹침: 정상 숙박끼리만, 퇴실일 = 다음 입실일은 겹침 아님", () => {
  const a = bar(bk({ checkIn: "2026-10-18", nights: 2 }), 0, 2);
  const b = bar(bk({ checkIn: "2026-10-19", nights: 1 }), 1, 1);
  const c = bar(bk({ checkIn: "2026-10-20", nights: 1 }), 2, 1);
  const x = bar(bk({ checkIn: "2026-10-18", nights: 1, status: "cancelled" }), 0, 1);
  assert.equal(markConflicts([a, b, c, x]), 1);
  assert.deepEqual([a.conflict, b.conflict, c.conflict, x.conflict], [true, true, false, false]);
});

test("방 미배정 줄 나누기: 안 겹치게 가장 위 줄부터", () => {
  const bs = [bar(bk({}), 0, 3), bar(bk({}), 1, 2), bar(bk({}), 3, 2), bar(bk({}), 2, 1), bar(bk({}), 5, 1)];
  const lanes = stackLanes(bs);
  assert.equal(lanes.length, 3, "2번째 칸에 셋이 겹쳐서 3줄");
  assert.equal(lanes[0].length, 3, "첫 줄: 0~2, 3~4, 5");
  for (const lane of lanes)
    for (let i = 1; i < lane.length; i++) assert.ok(lane[i].span.start >= lane[i - 1].span.start + lane[i - 1].span.len, "같은 줄은 안 겹쳐요");
  assert.equal(lanes.flat().length, 5);
  assert.deepEqual(stackLanes([]), []);
});

test("캘린더 배치: 방별 막대, 겹침, 미배정 줄, 대실 칸, 건물별, 취소 숨김", () => {
  const list = [
    bk({ roomId: "r201", checkIn: "2026-10-18", nights: 3 }),
    bk({ roomId: "r201", checkIn: "2026-10-19", nights: 1 }), // 겹침
    bk({ roomId: "r202", checkIn: "2026-10-18", nights: 1, status: "cancelled", cancelledAt: "2026-10-02T00:00:00Z" }),
    bk({ roomId: "r202", checkIn: "2026-10-18", nights: 2, createdAt: "2026-10-03T00:00:00Z" }), // 취소 자리를 채움
    bk({ roomId: "ra1", checkIn: "2026-10-20", nights: 1, status: "noshow", cancelledAt: "2026-10-02T00:00:00Z" }),
    bk({ roomId: null, checkIn: "2026-10-18", nights: 2 }),
    bk({ roomId: null, checkIn: "2026-10-19", nights: 2 }),
    bk({ kind: "dayuse", roomId: "r202", checkIn: "2026-10-21", nights: null, startTime: "14:00", endTime: "17:00" }),
    bk({ roomId: "r201", checkIn: "2026-12-01", nights: 1 }), // 범위 밖
  ];
  const L = calendarLayout(S, list, "2026-10-18", "2026-10-31");
  assert.equal(L.rooms.get("r201")?.length, 2);
  assert.equal(L.conflicts, 1);
  assert.equal(L.rooms.get("r202")?.length, 1, "채워진 취소는 안 보여요");
  assert.equal(L.rooms.get("ra1")?.[0].b.status, "noshow", "안 채워진 노쇼는 흐리게 보여요");
  assert.equal(L.lanes.length, 2);
  assert.equal(L.dayuse.get("r202")?.get(3)?.length, 1);
  const B2 = calendarLayout(S, list, "2026-10-18", "2026-10-31", "b2");
  assert.deepEqual([...B2.rooms.keys()], ["ra1"]);
  assert.equal(B2.lanes.length, 0, "방 미배정은 전체에서만");
});
