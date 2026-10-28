import { test } from "node:test";
import assert from "node:assert/strict";
import { type StayNightRates } from "./nightrates";
import { shiftMemberRates, shiftDays, shiftDifferences, shiftNightRates } from "./nightShift";

const edited: StayNightRates = { flat: 80_000, nights: { "2026-11-06": 100_000, "2026-11-07": 150_000, "2026-11-08": 60_000 }, extras: [{ name: "이불", amount: 10_000 }] };

test("옮기기: 고친 요금이 몇 번째 박인지를 따라가요", () => {
  const r = shiftNightRates(edited, "2026-11-06", 3, "2026-11-07", 3, "move");
  assert.deepEqual(r.nights, { "2026-11-07": 100_000, "2026-11-08": 150_000, "2026-11-09": 60_000 });
  assert.equal(r.extras?.[0]?.amount, 10_000);
});

test("그대로 두기: 겹치는 날짜는 기존 요금, 새 날짜는 기본 요금", () => {
  const r = shiftNightRates(edited, "2026-11-06", 3, "2026-11-07", 3, "keep");
  assert.equal(r.nights?.["2026-11-07"], 150_000);
  assert.equal(r.nights?.["2026-11-08"], 60_000);
  assert.equal(r.nights?.["2026-11-09"], 80_000);
});

test("박 수가 줄거나 늘어도 고친 요금을 합계로 나누지 않아요", () => {
  const shorter = shiftNightRates(edited, "2026-11-06", 3, "2026-11-10", 2, "move");
  assert.deepEqual(shorter.nights, { "2026-11-10": 100_000, "2026-11-11": 150_000 });
  const longer = shiftNightRates(edited, "2026-11-06", 3, "2026-11-10", 4, "move");
  assert.equal(longer.nights?.["2026-11-12"], 60_000);
  assert.equal(longer.nights?.["2026-11-13"], 80_000);
});

test("모든 박이 같은 요금이면 물어볼 필요가 없어요", () => {
  const same: StayNightRates = { flat: 90_000, nights: { "2026-11-06": 90_000, "2026-11-07": 90_000 } };
  assert.deepEqual(shiftDifferences(same, "2026-11-06", 2, "2026-11-08", 2), []);
  assert.equal(shiftDifferences(edited, "2026-11-06", 3, "2026-11-07", 3).length > 0, true);
  assert.deepEqual(shiftDifferences(edited, "2026-11-06", 3, "2026-11-06", 3), []);
});

test("shiftDays", () => {
  assert.equal(shiftDays("2026-11-06", "2026-11-09"), 3);
  assert.equal(shiftDays("2026-11-06", "2026-11-04"), -2);
});

test("단체 입실일 이동: 방마다 고친 요금이 그대로 따라가고 판매가는 박별 합이에요", () => {
  const m = { kind: "stay" as const, price: 320_000 + 10_000, nights: 3, checkIn: "2026-11-06", nightRates: edited, extraFee: 0, earlyIn: false, lateOut: false, timeFee: 0, arrival: null, carFee: 0, walkOff: 0 };
  const r = shiftMemberRates(m as never, "2026-11-08", 3, "move")!;
  assert.deepEqual(r.nightRates.nights, { "2026-11-08": 100_000, "2026-11-09": 150_000, "2026-11-10": 60_000 });
  assert.equal(r.price, 320_000);
  assert.equal(shiftMemberRates({ ...m, nightRates: null } as never, "2026-11-08", 3, "move"), null);
  const up = shiftMemberRates(m as never, "2026-11-08", 5, "move")!;
  assert.equal(up.price, m.price);
  assert.equal(Object.keys(up.nightRates.nights ?? {}).length, 3);
});
