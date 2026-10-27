// 단체/객실 추가 · 박별 요금표와 이용 기간 미정이 저장 초안에 그대로 실려요
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings } from "./ledger";
import { groupDrafts } from "./group";
import { withTotal, withNight } from "./nightTable";
import { openStayFields } from "./openStay";
import { sumNightAmounts } from "./nightrates";

const S = normalizeSettings({
  types: [{ id: "s", name: "S" }],
  platforms: [{ id: "p", name: "현장", abbr: "현" }],
  floors: [{ id: "f5", name: "5층", rooms: [{ id: "r501", no: "501", typeId: "s" }, { id: "r502", no: "502", typeId: "s" }] }],
});
const base = { groupId: "g", groupName: "한빛", platformId: "p", checkIn: "2026-10-25", s: S } as const;

test("방별 박별 요금표: 방 금액 = 박별 합, 방마다 달라도 돼요", () => {
  const t1 = withTotal("2026-10-25", 3, 690_000 / 3 * 3); // 3박 합 690,000 → 230,000씩
  const t2 = withNight("2026-10-25", 3, withTotal("2026-10-25", 3, 240_000), 0, "2026-10-26", 100_000);
  const list = groupDrafts({ ...base, nights: 3, roomIds: ["r501", "r502"], prices: [0, 0], memberNightRates: [t1, t2] });
  assert.equal(list[0]!.price, 690_000);
  assert.equal(list[0]!.nightRates?.nights?.["2026-10-25"], 230_000);
  assert.equal(list[1]!.price, sumNightAmounts(t2.nights));
  assert.equal(list[1]!.nightRates?.nights?.["2026-10-26"], 100_000);
});

test("박별 표가 없으면 1박 단가로 (기존 동작)", () => {
  const list = groupDrafts({ ...base, nights: 2, roomIds: ["r501", "r502"], prices: [160_000, 160_000], memberRates: [80_000, 80_000], memberNightRates: [null, undefined] });
  assert.equal(list[0]!.price, 160_000);
  assert.equal(list[1]!.nightRates?.nights?.["2026-10-26"], 80_000);
});

test("이용 기간 미정: 모든 멤버에 openEnded/holdAhead가 실려요 (502호 추가 포함)", () => {
  const f = openStayFields("2026-10-25", "2026-10-27", 1);
  const list = groupDrafts({ ...base, nights: f.nights, roomIds: ["r502"], prices: [80_000], arrived: true, openHold: f.holdAhead });
  assert.equal(f.nights, 4);
  assert.equal(list[0]!.openEnded, true);
  assert.equal(list[0]!.holdAhead, 1);
  assert.equal(list[0]!.roomId, "r502");
});

test("미정이 아니면 openEnded를 건드리지 않아요", () => {
  const list = groupDrafts({ ...base, nights: 1, roomIds: ["r501"], prices: [1] });
  assert.equal(list[0]!.openEnded, undefined);
});
