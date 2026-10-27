// 자동 배정 오버부킹 방지 감사: 어떤 경우에도 이미 배정된 방·같은 밤에는 넣지 않는다 (사용자 긴급 요청 pt82u)
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking, type HotelSettings, addDays, allRooms, legConflicts, legsOf, normalizeSettings, occupiesRoom } from "./ledger";
import { type AutoAssignPlan, extraBlock, planAutoAssign, revalidateItem } from "./autoAssign";
import { roomsHeldForStay } from "./roomHold";

const mk = (nos: string[]): HotelSettings =>
  normalizeSettings({
    types: [{ id: "s", name: "S" }],
    platforms: [{ id: "p", name: "야놀자", abbr: "야" }],
    floors: [{ id: "f1", name: "1층", rooms: nos.map((no) => ({ id: `r${no}`, no, typeId: "s" })) }],
  });
const ONE = mk(["101"]); // 방이 하나뿐이면 겹침이 곧 배정 불가
const TWO = mk(["101", "102"]);
const withHolds = (s: HotelSettings, holds: { roomId: string; from: string; to: string }[]): HotelSettings => ({
  ...s,
  roomHolds: holds.map((h, i) => ({ id: `h${i}`, note: null, createdAt: "2026-10-01T00:00:00Z", ...h })),
});

let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`, kind: "stay", status: "active", platformId: "p", price: 100000, guestName: `손님${n}`, typeId: "s", roomId: null,
  checkIn: "2026-10-27", nights: 1, startTime: null, endTime: null, arrived: false, memo: null, cancelledAt: null,
  createdAt: `2026-10-01T00:00:${String(n % 60).padStart(2, "0")}Z`, updatedAt: "2026-10-01T00:00:00Z", segments: null, ...p,
});
const du = (p: Partial<Booking>) => bk({ kind: "dayuse", nights: null, startTime: "10:00", endTime: "14:00", ...p });
const roomOf = (plan: AutoAssignPlan, id: string) => plan.items.find((i) => i.bookingId === id)?.roomId;
const placed = (plan: AutoAssignPlan, id: string) => plan.items.some((i) => i.bookingId === id);

/** 계획을 적용한 장부에서 배정된 숙박끼리 한 방·한 밤이 겹치지 않는지 (실제 수동 경로와 같은 legConflicts) */
function applyAll(base: Booking[], plan: AutoAssignPlan): Booking[] {
  return base.map((b) => {
    const it = plan.items.find((i) => i.bookingId === b.id);
    return it ? { ...b, roomId: it.roomId, segments: it.segments } : b;
  });
}
function assertNoDouble(list: Booking[]) {
  for (const b of list) {
    if (b.kind !== "stay" || !occupiesRoom(b) || !b.roomId) continue;
    assert.deepEqual(legConflicts(list, b).map((x) => x.roomId + x.checkIn), [], `겹침 발생: ${b.id}`);
  }
}

// ───────── 기본: 같은 방 겹치는 밤 ─────────
test("같은 방에 겹치는 밤이 하나라도 있으면 배정 안 함 (첫날·마지막날·가운데·걸침·포함)", () => {
  const want = bk({ checkIn: "2026-10-27", nights: 3 }); // 27, 28, 29박 (퇴실 30일)
  const cases: [string, string, number][] = [
    ["앞에서 걸침(첫날 겹침)", "2026-10-26", 2],
    ["첫날 하루", "2026-10-27", 1],
    ["가운데 하루", "2026-10-28", 1],
    ["마지막 밤 하루", "2026-10-29", 1],
    ["뒤로 걸침(마지막날 겹침)", "2026-10-29", 3],
    ["양쪽으로 걸친 긴 연박", "2026-10-20", 20],
    ["완전히 안쪽에 포함", "2026-10-28", 1],
    ["똑같은 날짜", "2026-10-27", 3],
  ];
  for (const [name, ci, nn] of cases) {
    const ex = bk({ roomId: "r101", checkIn: ci, nights: nn });
    const plan = planAutoAssign(ONE, [ex, want], [want]);
    assert.equal(placed(plan, want.id), false, name);
    assert.equal(plan.skipped.find((x) => x.bookingId === want.id)?.reason, "full", name);
  }
});

test("퇴실일 = 다음 입실일이면 연달아 배정 가능 (앞뒤 모두)", () => {
  const before = bk({ roomId: "r101", checkIn: "2026-10-25", nights: 2 }); // 27일 퇴실
  const after = bk({ roomId: "r101", checkIn: "2026-10-29", nights: 1 }); // 27·28박 사이에 끝나야 함
  const want = bk({ checkIn: "2026-10-27", nights: 2 });
  const plan = planAutoAssign(ONE, [before, after, want], [want]);
  assert.equal(roomOf(plan, want.id), "r101");
  assertNoDouble(applyAll([before, after, want], plan));
  // 한 밤이라도 늘리면 막혀야 함
  const longer = bk({ checkIn: "2026-10-27", nights: 3 });
  assert.equal(placed(planAutoAssign(ONE, [before, after, longer], [longer]), longer.id), false);
});

// ───────── 방 이동(room_segments) ─────────
test("방 나눠 배정된 예약은 각 구간의 방을 그 밤에만 차지해요", () => {
  // 27일 1박은 101, 28·29일 2박은 102
  const moved = bk({ roomId: "r101", checkIn: "2026-10-27", nights: 3, segments: [{ roomId: "r101", nights: 1 }, { roomId: "r102", nights: 2 }] });
  assert.deepEqual(legsOf(moved).map((l) => [l.roomId, l.checkIn, l.nights]), [["r101", "2026-10-27", 1], ["r102", "2026-10-28", 2]]);
  const w28 = bk({ checkIn: "2026-10-28", nights: 1 }); // 101은 28일 비어 있음, 102는 막힘
  assert.equal(roomOf(planAutoAssign(TWO, [moved, w28], [w28]), w28.id), "r101");
  const w27 = bk({ checkIn: "2026-10-27", nights: 1 }); // 101은 27일 막힘, 102는 비어 있음
  assert.equal(roomOf(planAutoAssign(TWO, [moved, w27], [w27]), w27.id), "r102");
  // 27~29 3박은 어느 방도 통째로 안 됨 → 기본은 불가, 나눠 배정을 켜도 겹침 없이
  const w3 = bk({ checkIn: "2026-10-27", nights: 3 });
  assert.equal(placed(planAutoAssign(TWO, [moved, w3], [w3]), w3.id), false);
  const sp = planAutoAssign(TWO, [moved, w3], [w3], { allowSplit: true, maxSegments: 3 });
  assertNoDouble(applyAll([moved, w3], sp));
});

// ───────── 대실 ─────────
test("같은 날 대실이 있는 방에는 숙박을 자동으로 넣지 않아요 (입실 시각과 겹침 · 연박 중간날)", () => {
  const overlapping = du({ roomId: "r101", checkIn: "2026-10-27", startTime: "13:00", endTime: "18:00" }); // 기본 입실 시각 뒤까지
  const w1 = bk({ checkIn: "2026-10-27", nights: 1 });
  const p1 = planAutoAssign(ONE, [overlapping, w1], [w1]);
  assert.equal(placed(p1, w1.id), false);
  assert.equal(p1.skipped[0].reason, "full");
  const mid = du({ roomId: "r101", checkIn: "2026-10-28", startTime: "10:00", endTime: "14:00" });
  const w3 = bk({ checkIn: "2026-10-27", nights: 3 });
  assert.equal(placed(planAutoAssign(ONE, [mid, w3], [w3]), w3.id), false);
  // 입실 시각 전에 끝나는 입실일 대실은 실제로 겹치지 않으니 허용
  const early = du({ roomId: "r101", checkIn: "2026-10-27", startTime: "08:00", endTime: "10:00" });
  const w2 = bk({ checkIn: "2026-10-27", nights: 1 });
  assert.equal(extraBlock(ONE, [early], w2, "r101", "2026-10-27", 1), null);
  assert.equal(roomOf(planAutoAssign(ONE, [early, w2], [w2]), w2.id), "r101");
  // 다른 방의 대실은 상관없음
  const other = du({ roomId: "r102", checkIn: "2026-10-27", startTime: "13:00", endTime: "18:00" });
  assert.equal(roomOf(planAutoAssign(TWO, [other, w1], [w1]), w1.id), "r101");
  // 취소된 대실은 방을 안 잡아요
  const cancelled = du({ roomId: "r101", checkIn: "2026-10-27", startTime: "13:00", endTime: "18:00", status: "cancelled" });
  assert.equal(roomOf(planAutoAssign(ONE, [cancelled, w1], [w1]), w1.id), "r101");
});

test("같은 손님 예외는 자동 배정에 적용하지 않아요 (이름·번호가 같아도 대실 방은 제외)", () => {
  const d = du({ roomId: "r101", checkIn: "2026-10-27", startTime: "13:00", endTime: "18:00", guestName: "홍길동", guestPhone: "010-1111-2222" });
  const w = bk({ checkIn: "2026-10-27", nights: 1, guestName: "홍길동", guestPhone: "010-1111-2222" });
  assert.equal(placed(planAutoAssign(ONE, [d, w], [w]), w.id), false);
});

// ───────── 임시 마감 ─────────
test("임시 마감된 방에는 마감 기간이 하루라도 겹치면 배정 안 함 (퇴실일에 시작하는 마감은 허용)", () => {
  const w = bk({ checkIn: "2026-10-27", nights: 3 }); // 27~29박, 30일 퇴실
  for (const [from, to] of [["2026-10-27", "2026-10-27"], ["2026-10-29", "2026-10-29"], ["2026-10-25", "2026-10-28"], ["2026-10-29", "2026-11-05"]]) {
    const s = withHolds(ONE, [{ roomId: "r101", from, to }]);
    assert.equal(placed(planAutoAssign(s, [w], [w]), w.id), false, `${from}~${to}`);
  }
  for (const [from, to] of [["2026-10-30", "2026-11-05"], ["2026-10-20", "2026-10-26"]]) {
    const s = withHolds(ONE, [{ roomId: "r101", from, to }]);
    assert.equal(roomOf(planAutoAssign(s, [w], [w]), w.id), "r101", `${from}~${to}`);
  }
});

// ───────── 가예약 ─────────
test("가예약(tentative)도 방을 잡고 있어요 → 겹치면 배정 안 함", () => {
  const tent = bk({ roomId: "r101", checkIn: "2026-10-27", nights: 2, tentative: true });
  const w = bk({ checkIn: "2026-10-28", nights: 1 });
  assert.equal(placed(planAutoAssign(ONE, [tent, w], [w]), w.id), false);
  assert.ok(revalidateItem(ONE, [tent, w], { bookingId: w.id, roomId: "r101", segments: null }));
});

// ───────── 퇴실 처리 ─────────
test("퇴실처리된 숙박이 아직 그 밤을 장부에 잡고 있으면 자동으로는 안 넣어요 (수동은 덮어쓰기 확인)", () => {
  const out = bk({ roomId: "r101", checkIn: "2026-10-26", nights: 3, checkedOutAt: "2026-10-27T09:00:00Z" }); // 장부상 26~28박
  const w = bk({ checkIn: "2026-10-27", nights: 1 });
  const p = planAutoAssign(ONE, [out, w], [w]);
  assert.equal(placed(p, w.id), false);
  assert.match(revalidateItem(ONE, [out, w], { bookingId: w.id, roomId: "r101", segments: null }) ?? "", /퇴실처리/);
  // 퇴실일 이후부터면 문제없음
  const w2 = bk({ checkIn: "2026-10-29", nights: 1 });
  assert.equal(roomOf(planAutoAssign(ONE, [out, w2], [w2]), w2.id), "r101");
  // 이미 끝난(겹치지 않는) 퇴실처리 숙박은 상관없음
  const old = bk({ roomId: "r101", checkIn: "2026-10-20", nights: 2, checkedOutAt: "2026-10-22T09:00:00Z" });
  assert.equal(roomOf(planAutoAssign(ONE, [old, w], [w]), w.id), "r101");
});

// ───────── 중도 퇴실 ─────────
test("중도 퇴실(earlyOut)로 풀린 밤은 배정 가능, 실제 쓴 밤은 막아요", () => {
  const ex = bk({ roomId: "r101", checkIn: "2026-10-25", nights: 5, earlyOut: "2026-10-27" }); // 25·26박만 사용
  const free = bk({ checkIn: "2026-10-27", nights: 2 });
  assert.equal(roomOf(planAutoAssign(ONE, [ex, free], [free]), free.id), "r101");
  const used = bk({ checkIn: "2026-10-26", nights: 2 });
  assert.equal(placed(planAutoAssign(ONE, [ex, used], [used]), used.id), false);
});

// ───────── 같은 묶음 ─────────
test("같은 묶음의 미배정끼리도 겹치면 둘째는 못 받아요 (연달아는 둘 다)", () => {
  const a = bk({ checkIn: "2026-10-27", nights: 2 });
  const b = bk({ checkIn: "2026-10-28", nights: 2 }); // 28일 겹침
  const p = planAutoAssign(ONE, [a, b], [a, b]);
  assert.equal(p.items.length, 1);
  assert.equal(p.skipped.length, 1);
  assertNoDouble(applyAll([a, b], p));
  const c = bk({ checkIn: "2026-10-29", nights: 1 }); // a 퇴실일에 입실
  const p2 = planAutoAssign(ONE, [a, c], [a, c]);
  assert.equal(p2.items.length, 2);
  assertNoDouble(applyAll([a, c], p2));
  // 방이 둘이면 서로 다른 방으로
  const p3 = planAutoAssign(TWO, [a, b], [a, b]);
  assert.notEqual(roomOf(p3, a.id), roomOf(p3, b.id));
});

// ───────── 자기 자신 ─────────
test("자기 자신과는 겹침으로 보지 않고, 같은 예약을 두 번 넘겨도 한 번만 배정해요", () => {
  const w = bk({ checkIn: "2026-10-27", nights: 2 });
  const p = planAutoAssign(ONE, [w], [w, w]);
  assert.equal(p.items.length, 1);
  assert.equal(p.skipped.length, 0);
  assert.equal(revalidateItem(ONE, [w], { bookingId: w.id, roomId: "r101", segments: null }), null);
});

// ───────── 저장 직전 재검증 ─────────
test("revalidateItem: 그 사이 바뀐 최신 장부에서 겹침·마감·대실·퇴실처리·다른 타입을 모두 거부", () => {
  const w = bk({ checkIn: "2026-10-27", nights: 2 });
  const item = { bookingId: w.id, roomId: "r101", segments: null };
  assert.equal(revalidateItem(ONE, [w], item), null);
  const taken = bk({ roomId: "r101", checkIn: "2026-10-28", nights: 1 });
  assert.match(revalidateItem(ONE, [w, taken], item) ?? "", /겹쳐/);
  assert.match(revalidateItem(withHolds(ONE, [{ roomId: "r101", from: "2026-10-28", to: "2026-10-28" }]), [w], item) ?? "", /임시마감/);
  const d = du({ roomId: "r101", checkIn: "2026-10-28", startTime: "10:00", endTime: "12:00" });
  assert.match(revalidateItem(ONE, [w, d], item) ?? "", /대실/);
  const out = bk({ roomId: "r101", checkIn: "2026-10-27", nights: 1, checkedOutAt: "2026-10-27T09:00:00Z" });
  assert.match(revalidateItem(ONE, [w, out], item) ?? "", /퇴실처리/);
  const other = normalizeSettings({
    types: [{ id: "s", name: "S" }, { id: "t", name: "T" }],
    platforms: [{ id: "p", name: "p", abbr: "p" }],
    floors: [{ id: "f", name: "f", rooms: [{ id: "r101", no: "101", typeId: "s" }, { id: "r201", no: "201", typeId: "t" }] }],
  });
  assert.match(revalidateItem(other, [w], { bookingId: w.id, roomId: "r201", segments: null }) ?? "", /타입/);
  // 이미 배정됨·취소됨
  assert.ok(revalidateItem(ONE, [{ ...w, roomId: "r101" }], item));
  assert.ok(revalidateItem(ONE, [{ ...w, status: "cancelled" }], item));
  // 구간 배정의 각 구간도 검사
  const segItem = { bookingId: w.id, roomId: "r101", segments: [{ roomId: "r101", nights: 1 }, { roomId: "r102", nights: 1 }] };
  const take2 = bk({ roomId: "r102", checkIn: "2026-10-28", nights: 1 });
  assert.equal(revalidateItem(TWO, [w], segItem), null);
  assert.match(revalidateItem(TWO, [w, take2], segItem) ?? "", /겹쳐/);
});

// ───────── 무작위 속성 검사 ─────────
test("무작위 장부 600판: 어떤 계획도 겹침·마감·다른 타입·퇴실처리·대실 방을 만들지 않아요", () => {
  let seed = 20261027;
  const rnd = (k: number) => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return Math.floor((seed / 4294967296) * k);
  };
  const s0 = normalizeSettings({
    types: [{ id: "s", name: "S" }, { id: "t", name: "T" }],
    platforms: [{ id: "p", name: "p", abbr: "p" }],
    floors: [
      { id: "f1", name: "1", rooms: [101, 102, 103].map((x) => ({ id: `r${x}`, no: `${x}`, typeId: "s" })) },
      { id: "f2", name: "2", rooms: [201, 202].map((x) => ({ id: `r${x}`, no: `${x}`, typeId: "s" })).concat([{ id: "r203", no: "203", typeId: "t" }]) },
    ],
  });
  const roomIds = allRooms(s0).map((r) => r.id);
  const day = (o: number) => addDays("2026-10-25", o);
  for (let it = 0; it < 600; it++) {
    const holds = rnd(2) ? [{ roomId: roomIds[rnd(roomIds.length)], from: day(rnd(8)), to: day(rnd(10)) }].filter((h) => h.to >= h.from) : [];
    const s = withHolds(s0, holds);
    const list: Booking[] = [];
    for (let i = 0, k = rnd(9); i < k; i++) {
      const kind = rnd(5) === 0 ? "dayuse" : "stay";
      const roomId = roomIds[rnd(roomIds.length)];
      const nights = 1 + rnd(4);
      const ci = day(rnd(8));
      if (kind === "dayuse") { list.push(du({ roomId, checkIn: ci, startTime: "09:00", endTime: rnd(2) ? "13:00" : "20:00" })); continue; }
      const b = bk({ roomId, checkIn: ci, nights, typeId: roomId === "r203" ? "t" : "s" });
      if (rnd(6) === 0) b.checkedOutAt = "2026-10-26T09:00:00Z";
      if (rnd(6) === 0) b.tentative = true;
      if (rnd(6) === 0 && nights > 1) b.earlyOut = addDays(ci, 1 + rnd(nights - 1));
      if (rnd(6) === 0 && nights > 1) b.segments = [{ roomId, nights: 1 }, { roomId: roomIds[rnd(roomIds.length)], nights: nights - 1 }];
      if (rnd(8) === 0) b.status = "cancelled";
      list.push(b);
    }
    // 기존 장부는 이미 겹칠 수 있으니(수동 허용) 새로 배정된 것이 기존 것을 더 늘리지 않는지만 본다
    const targets: Booking[] = [];
    for (let i = 0, k = 1 + rnd(5); i < k; i++) targets.push(bk({ checkIn: day(rnd(8)), nights: 1 + rnd(4), typeId: rnd(5) === 0 ? "t" : "s" }));
    const all = [...list, ...targets];
    const plan = planAutoAssign(s, all, targets, { allowSplit: !!rnd(2), maxSegments: 3 });
    const after = applyAll(all, plan);
    for (const item of plan.items) {
      const b = after.find((x) => x.id === item.bookingId)!;
      const others = after.filter((x) => x.id !== b.id);
      const what = JSON.stringify({ it, item, b: { ci: b.checkIn, n: b.nights } });
      // 새로 배정된 숙박의 각 구간은 다른 어떤 점유 예약과도 겹치지 않음
      assert.deepEqual(legConflicts(others, b).map((x) => x.roomId + x.checkIn), [], `겹침 ${what}`);
      for (const l of legsOf(b)) {
        assert.equal(roomsHeldForStay(s.roomHolds ?? [], l.checkIn, l.nights).has(l.roomId!), false, `마감 ${what}`);
        assert.equal(allRooms(s).find((r) => r.id === l.roomId)?.typeId, b.typeId, `타입 ${what}`);
        assert.equal(extraBlock(s, others, b, l.roomId!, l.checkIn, l.nights), null, `대실/퇴실처리 ${what}`);
      }
      assert.equal(revalidateItem(s, all, item), null, `재검증 ${what}`);
    }
  }
});
