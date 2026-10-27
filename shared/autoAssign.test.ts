// 미배정 자동 배정: 타입 고정 · 쪼개짐 최소화 · 연박 · 단체 같은 층 · 임시마감 · 불가 사유 · 저장 직전 재검증
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking, legsOf, normalizeSettings, type HotelSettings } from "./ledger";
import { planAutoAssign, revalidateItem } from "./autoAssign";

const rooms = (floor: string, typeId: string, nos: string[]) => nos.map((no) => ({ id: `r${no}`, no, typeId }));
const S: HotelSettings = normalizeSettings({
  types: [{ id: "s", name: "S" }, { id: "t", name: "T" }],
  platforms: [{ id: "p", name: "야놀자", abbr: "야" }],
  floors: [
    { id: "f2", name: "2층", rooms: [...rooms("f2", "s", ["201", "202", "203"]), ...rooms("f2", "t", ["204"])] },
    { id: "f3", name: "3층", rooms: rooms("f3", "s", ["301", "302", "303", "304", "305"]) },
  ],
});
const withHolds = (holds: { roomId: string; from: string; to: string }[]): HotelSettings => ({
  ...S,
  roomHolds: holds.map((h, i) => ({ id: `h${i}`, note: null, createdAt: "2026-10-01T00:00:00Z", ...h })),
});

let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`, kind: "stay", status: "active", platformId: "p", price: 100000, guestName: `손님${n}`, typeId: "s", roomId: null,
  checkIn: "2026-10-27", nights: 1, startTime: null, endTime: null, arrived: false, memo: null, cancelledAt: null,
  createdAt: `2026-10-01T00:00:${String(n % 60).padStart(2, "0")}Z`, updatedAt: "2026-10-01T00:00:00Z", segments: null, ...p,
});
const roomOf = (plan: ReturnType<typeof planAutoAssign>, id: string) => plan.items.find((i) => i.bookingId === id)?.roomId;
const reasonOf = (plan: ReturnType<typeof planAutoAssign>, id: string) => plan.skipped.find((i) => i.bookingId === id)?.reason;

test("다른 타입으로는 절대 자동 배정하지 않아요 (T 방이 꽉 차도 S 방에 넣지 않음)", () => {
  const taken = bk({ typeId: "t", roomId: "r204", checkIn: "2026-10-27", nights: 2 });
  const want = bk({ typeId: "t", checkIn: "2026-10-27", nights: 1 });
  const plan = planAutoAssign(S, [taken, want], [want]);
  assert.equal(plan.items.length, 0);
  assert.equal(reasonOf(plan, want.id), "full");
  // 타입이 맞는 방에만
  const s1 = bk({ typeId: "s" });
  assert.match(roomOf(planAutoAssign(S, [s1], [s1]), s1.id)!, /^r(20[123]|30\d)$/);
  const t1 = bk({ typeId: "t" });
  assert.equal(roomOf(planAutoAssign(S, [t1], [t1]), t1.id), "r204");
});

test("쪼개짐 최소화: 앞 예약 바로 뒤에 붙는 방을 먼저 채워요 (통째로 빈 방은 아껴요)", () => {
  const prev = bk({ roomId: "r202", checkIn: "2026-10-25", nights: 2 }); // 10/27 퇴실
  const want = bk({ checkIn: "2026-10-27", nights: 2 });
  const plan = planAutoAssign(S, [prev, want], [want]);
  assert.equal(roomOf(plan, want.id), "r202");
});
test("뒤 예약 바로 앞에 끝나는 방도 선호 · 이미 배정된 예약은 건드리지 않음", () => {
  const next = bk({ roomId: "r303", checkIn: "2026-10-29", nights: 2 });
  const want = bk({ checkIn: "2026-10-27", nights: 2 });
  const plan = planAutoAssign(S, [next, want], [want, next]);
  assert.equal(roomOf(plan, want.id), "r303");
  assert.equal(plan.items.some((i) => i.bookingId === next.id), false);
});

test("연박은 한 방에 통째로: 중간이 막힌 방은 건너뛰어요", () => {
  const blockers = ["r201", "r202", "r301", "r302", "r303", "r304"].map((r) => bk({ roomId: r, checkIn: "2026-10-29", nights: 1 }));
  const want = bk({ checkIn: "2026-10-27", nights: 4 });
  const plan = planAutoAssign(S, [...blockers, want], [want]);
  assert.equal(plan.items.length, 1);
  const it = plan.items[0];
  assert.equal(it.segments, null);
  assert.ok(["r203", "r305"].includes(it.roomId));
});

test("연박: 한 방으로 안 되면 기본은 불가(fragmented) · 방 나눠 배정을 켜면 구간으로", () => {
  // 모든 S 방이 어느 밤엔가 막혀 있어요 → 4박 통째로는 없음
  const blocks = [
    ["r201", "2026-10-27"], ["r202", "2026-10-28"], ["r203", "2026-10-29"],
    ["r301", "2026-10-27"], ["r302", "2026-10-28"], ["r303", "2026-10-29"], ["r304", "2026-10-30"], ["r305", "2026-10-27"],
  ].map(([r, d]) => bk({ roomId: r, checkIn: d, nights: 1 }));
  const want = bk({ checkIn: "2026-10-27", nights: 4 });
  const off = planAutoAssign(S, [...blocks, want], [want]);
  assert.equal(off.items.length, 0);
  assert.equal(reasonOf(off, want.id), "fragmented");
  const on = planAutoAssign(S, [...blocks, want], [want], { allowSplit: true });
  assert.equal(on.items.length, 1);
  const it = on.items[0];
  assert.ok(it.segments && it.segments.length >= 2 && it.segments.length <= 3);
  assert.equal(it.segments!.reduce((a, x) => a + x.nights, 0), 4);
  assert.equal(it.roomId, it.segments![0].roomId);
  // 구간 결과가 실제로 충돌 없음
  const merged = { ...want, roomId: it.roomId, segments: it.segments };
  assert.equal(revalidateItem(S, [...blocks, want], { bookingId: want.id, roomId: it.roomId, segments: it.segments }), null);
  assert.equal(legsOf(merged).length, it.segments!.length);
});

test("단체: 같은 층에 연속 호실로 모아요 (2층은 2칸뿐이라 3층으로)", () => {
  const busy = bk({ roomId: "r202", checkIn: "2026-10-27", nights: 2 });
  const g = ["a", "b", "c"].map(() => bk({ groupId: "g1", groupName: "한빛", checkIn: "2026-10-27", nights: 2 }));
  const plan = planAutoAssign(S, [busy, ...g], g);
  assert.equal(plan.items.length, 3);
  const nos = plan.items.map((i) => i.roomId).sort();
  assert.deepEqual(nos, ["r301", "r302", "r303"]);
  assert.ok(plan.items.every((i) => !i.scattered));
});

test("단체: 이미 배정된 같은 단체 방이 있으면 그 층부터", () => {
  const peer = bk({ groupId: "g1", roomId: "r303", checkIn: "2026-10-27", nights: 2 });
  const g = [bk({ groupId: "g1", checkIn: "2026-10-27", nights: 2 }), bk({ groupId: "g1", checkIn: "2026-10-27", nights: 2 })];
  const plan = planAutoAssign(S, [peer, ...g], g);
  const ids = plan.items.map((i) => i.roomId).sort();
  assert.deepEqual(ids, ["r301", "r302"]); // 같은 3층 · 303과 이어지는 호실
});

test("단체: 한 층에 다 못 모으면 흩어 배정하고 표시해요", () => {
  const busy = ["r201", "r202", "r302", "r303", "r304"].map((r) => bk({ roomId: r, checkIn: "2026-10-27", nights: 2 }));
  // 빈 S 방: 203(2층 1개), 301·305(3층 2개 — 연속 아님이지만 같은 층엔 2개뿐) → 3명은 한 층 불가
  const g = [1, 2, 3].map(() => bk({ groupId: "g9", checkIn: "2026-10-27", nights: 2 }));
  const plan = planAutoAssign(S, [...busy, ...g], g);
  assert.equal(plan.items.length, 3);
  assert.ok(plan.items.every((i) => i.scattered));
});

test("단체: 다른 타입이 섞여도 각자 자기 타입 방에, 같은 층 우선", () => {
  const g = [bk({ groupId: "g2", typeId: "s", checkIn: "2026-10-27", nights: 1 }), bk({ groupId: "g2", typeId: "t", checkIn: "2026-10-27", nights: 1 })];
  const plan = planAutoAssign(S, [...g], g);
  assert.equal(roomOf(plan, g[1].id), "r204");
  assert.match(roomOf(plan, g[0].id)!, /^r20[123]$/); // 2층 안에서
  assert.ok(plan.items.every((i) => !i.scattered));
});

test("임시마감(holds): 겹치는 방은 쓰지 않아요 · 모두 막히면 held", () => {
  const want = bk({ typeId: "t", checkIn: "2026-10-27", nights: 2 });
  const hs = withHolds([{ roomId: "r204", from: "2026-10-28", to: "2026-10-28" }]);
  const plan = planAutoAssign(hs, [want], [want]);
  assert.equal(plan.items.length, 0);
  assert.equal(reasonOf(plan, want.id), "held");
  // S 타입: 201만 마감 → 202로
  const w2 = bk({ checkIn: "2026-10-27", nights: 1 });
  const hs2 = withHolds(["r201", "r203", "r301", "r302", "r303", "r304", "r305"].map((roomId) => ({ roomId, from: "2026-10-20", to: "2026-11-30" })));
  assert.equal(roomOf(planAutoAssign(hs2, [w2], [w2]), w2.id), "r202");
});

test("불가 사유: 타입 없음 · 그 타입 객실 없음 · 입실일/박수 이상 · 만실", () => {
  const noType = bk({ typeId: "" });
  const ghost = bk({ typeId: "zzz" });
  const bad = bk({ nights: null });
  const taken = bk({ typeId: "t", roomId: "r204", nights: 3 });
  const full = bk({ typeId: "t", nights: 1 });
  const plan = planAutoAssign(S, [taken, noType, ghost, bad, full], [noType, ghost, bad, full]);
  assert.equal(plan.items.length, 0);
  assert.equal(reasonOf(plan, noType.id), "no-type");
  assert.equal(reasonOf(plan, ghost.id), "no-rooms-of-type");
  assert.equal(reasonOf(plan, bad.id), "invalid");
  assert.equal(reasonOf(plan, full.id), "full");
  assert.ok(plan.skipped.every((x) => x.detail.length > 0));
});

test("이미 배정됐거나 취소·퇴실한 예약은 대상에서 빠져요 · 입력은 바뀌지 않음", () => {
  const placed = bk({ roomId: "r201" });
  const cancelled = bk({ status: "cancelled" as Booking["status"] });
  const out = bk({ checkedOutAt: "2026-10-27T10:00:00Z" });
  const ok = bk({});
  const all = [placed, cancelled, out, ok];
  const snap = JSON.stringify(all);
  const plan = planAutoAssign(S, all, all);
  assert.deepEqual(plan.items.map((i) => i.bookingId), [ok.id]);
  assert.equal(plan.skipped.length, 0);
  assert.equal(JSON.stringify(all), snap);
});

test("같은 방을 두 건이 겹쳐 받지 않아요 (같은 밤 3건 · 방 3개짜리 타입)", () => {
  const taken = bk({ roomId: "r301", nights: 3 });
  const many = [1, 2, 3, 4, 5, 6, 7, 8].map(() => bk({ nights: 2 }));
  const plan = planAutoAssign(S, [taken, ...many], many);
  const used = plan.items.map((i) => i.roomId);
  assert.equal(new Set(used).size, used.length);
  assert.equal(used.includes("r301"), false);
  assert.equal(plan.items.length, 7); // S 방 8개 − 301
  assert.equal(plan.skipped.length, 1);
});

test("revalidateItem: 문제 없음 · 그 사이 배정됨 · 방이 겹침 · 임시마감", () => {
  const want = bk({ checkIn: "2026-10-27", nights: 2 });
  const item = { bookingId: want.id, roomId: "r201", segments: null };
  assert.equal(revalidateItem(S, [want], item), null);
  assert.match(revalidateItem(S, [{ ...want, roomId: "r202" }], item)!, /이미 배정/);
  const other = bk({ roomId: "r201", checkIn: "2026-10-28", nights: 1 });
  assert.match(revalidateItem(S, [want, other], item)!, /겹쳐요/);
  assert.match(revalidateItem(withHolds([{ roomId: "r201", from: "2026-10-27", to: "2026-10-27" }]), [want], item)!, /임시마감/);
  assert.match(revalidateItem(S, [], item)!, /찾을 수 없/);
  assert.match(revalidateItem(S, [want], { ...item, roomId: "nope" })!, /방 정보/);
  assert.match(revalidateItem(S, [{ ...want, status: "cancelled" as Booking["status"] }], item)!, /상태/);
});
