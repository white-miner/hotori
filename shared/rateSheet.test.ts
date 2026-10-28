// 판매 캘린더 요금 설정 시트: 요일별 · 시즌 · 특별일 · 설정 카드와 같은 데이터
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings } from "./ledger";
import { normalizeTypeRates, resolveNightRate, setTypeDateRate, setTypeRateDefaults } from "./salesCalendar";
import { GRID_DAYS, applyRateDraft, dowFallback, draftFromSettings, isDraftChanged, sourceTag } from "./rateSheet";
import { slotRows, roomSlots } from "./groupRates";

const mk = () =>
  normalizeSettings({
    types: [{ id: "std", name: "스탠다드" }, { id: "dlx", name: "디럭스" }],
    platforms: [{ id: "p", name: "현장", abbr: "현" }],
    floors: [{ id: "f", name: "1층", rooms: [{ id: "a", no: "101", typeId: "std" }, { id: "b", no: "102", typeId: "dlx" }] }],
    typeRates: { std: { weekday: 60_000, weekend: 80_000 }, dlx: { flat: 100_000 } },
    weekendDays: [5, 6],
  });
// 10/22 목 · 10/23 금 · 10/24 토 · 10/25 일 · 10/26 월

test("화면 열 순서는 월~일", () => {
  assert.deepEqual(GRID_DAYS, [1, 2, 3, 4, 5, 6, 0]);
});

test("요일별 요금: 정한 요일만 바뀌고 나머지는 평일/주말을 따라요", () => {
  const s = mk();
  const d = draftFromSettings(s, "std");
  d.dow[0] = 70_000; // 일요일만 7만
  const { next, error } = applyRateDraft(s, "std", d);
  assert.equal(error, null);
  assert.equal(resolveNightRate(next, "std", "2026-10-25").amount, 70_000); // 일
  assert.equal(resolveNightRate(next, "std", "2026-10-26").amount, 60_000); // 월 = 평일
  assert.equal(resolveNightRate(next, "std", "2026-10-24").amount, 80_000); // 토 = 주말
  assert.equal(resolveNightRate(next, "dlx", "2026-10-25").amount, 100_000); // 다른 타입 영향 없음
  assert.equal(dowFallback(d, 5, [5, 6]), 80_000);
  assert.equal(dowFallback(d, 1, [5, 6]), 60_000);
});

test("우선순위: 특별일 > 시즌 > 요일별 > 평일/주말 > 기본", () => {
  let s = mk();
  const d = draftFromSettings(s, "std");
  d.dow[6] = 90_000; // 토
  d.seasons = [{ id: "z1", name: "성수기", from: "2026-10-24", to: "2026-10-26", weekday: 120_000, weekend: 150_000 }];
  s = applyRateDraft(s, "std", d).next;
  assert.equal(resolveNightRate(s, "std", "2026-10-23").amount, 80_000); // 금: 주말
  assert.equal(resolveNightRate(s, "std", "2026-10-24").source, "season"); // 토: 시즌이 요일별보다 먼저
  assert.equal(resolveNightRate(s, "std", "2026-10-24").amount, 150_000);
  assert.equal(resolveNightRate(s, "std", "2026-10-26").amount, 120_000);
  s = setTypeDateRate(s, "std", "2026-10-24", 200_000);
  const r = resolveNightRate(s, "std", "2026-10-24");
  assert.deepEqual([r.amount, r.source], [200_000, "date"]);
  assert.equal(sourceTag(r.source)?.text, "특별일");
  assert.equal(sourceTag("season")?.text, "시즌");
  assert.equal(sourceTag("weekend")?.text, "주말");
  assert.equal(sourceTag("weekday"), null);
  // 요일별만(시즌 밖): 출처는 평일/주말
  const s2 = applyRateDraft(mk(), "std", { ...draftFromSettings(mk(), "std"), dow: [null, null, null, null, null, null, 90_000] }).next;
  const t = resolveNightRate(s2, "std", "2026-10-24");
  assert.deepEqual([t.amount, t.source], [90_000, "weekend"]);
});

test("특별일로 켠 날은 요일별 값 대신 주말 요금", () => {
  const s = { ...mk(), specialDates: ["2026-10-26"] }; // 월요일을 특별일로
  const d = draftFromSettings(s, "std");
  d.dow[1] = 55_000;
  const n = applyRateDraft(s, "std", d).next;
  assert.equal(resolveNightRate(n, "std", "2026-10-26").amount, 80_000);
  assert.equal(resolveNightRate(n, "std", "2026-10-19").amount, 55_000);
});

test("시즌 겹침·이름 없음은 저장 막고 설정은 그대로", () => {
  const s = mk();
  const d = draftFromSettings(s, "std");
  d.seasons = [
    { id: "a", name: "여름", from: "2026-07-20", to: "2026-08-20", weekday: 100_000, weekend: null },
    { id: "b", name: "휴가", from: "2026-08-10", to: "2026-08-30", weekday: 110_000, weekend: null },
  ];
  const r = applyRateDraft(s, "std", d);
  assert.match(r.error ?? "", /겹쳐요/);
  assert.equal(r.next, s);
  d.seasons = [{ id: "c", name: "", from: "2026-07-20", to: "2026-08-20", weekday: 100_000, weekend: null }];
  assert.match(applyRateDraft(s, "std", d).error ?? "", /이름/);
  // 완전히 빈 새 줄은 무시
  d.seasons = [{ id: "e", name: "", from: "", to: "", weekday: null, weekend: null }];
  const ok = applyRateDraft(s, "std", d);
  assert.equal(ok.error, null);
  assert.equal(ok.next.typeSeasons.std, undefined);
});

test("설정 › 객실 요금과 같은 데이터: 설정에서 고친 평일 요금이 시트에, 시트의 시즌이 설정에 보여요 · 요일별은 평일 수정에도 유지", () => {
  let s = mk();
  const d = draftFromSettings(s, "std");
  d.dow[0] = 70_000;
  d.seasons = [{ id: "z", name: "성수기", from: "2026-07-20", to: "2026-08-20", weekday: 150_000, weekend: 200_000 }];
  s = applyRateDraft(s, "std", d).next;
  // 설정 카드: setTypeRateDefaults({...cur, weekday}) 형태로 평일만 바꿔도 요일별 유지
  const cur = s.typeRates.std!;
  s = setTypeRateDefaults(s, "std", { ...cur, weekday: 65_000 });
  const back = draftFromSettings(s, "std");
  assert.equal(back.weekday, 65_000);
  assert.equal(back.dow[0], 70_000);
  assert.equal(back.seasons[0]!.name, "성수기");
  assert.equal(isDraftChanged(s, "std", back), false);
  // 평일 요금 지우기만 하는 호출도 요일별 유지 (dow 생략 시 보존)
  const s3 = setTypeRateDefaults(s, "std", { weekday: null, weekend: 80_000, flat: null });
  assert.equal(s3.typeRates.std!.dow![0], 70_000);
  // 정규화(저장→읽기)에서도 보존
  assert.deepEqual(normalizeTypeRates(s.typeRates).std!.dow, [70_000, null, null, null, null, null, null]);
  assert.equal(normalizeTypeRates({ x: { weekday: 0, dow: [0, "x", null] } }).x, undefined);
});

test("요금 설정을 바꿔도 이미 만든 예약 요금은 그대로 (설정 저장은 요금표만 바꿔요)", () => {
  const s = mk();
  const booking = { id: "bk", price: 240_000, nightRates: { flat: 80_000, nights: { "2026-10-25": 80_000, "2026-10-26": 80_000, "2026-10-27": 80_000 } } };
  const snap = JSON.stringify(booking);
  const d = draftFromSettings(s, "std");
  d.weekday = 99_000;
  d.weekend = 150_000;
  const { next } = applyRateDraft(s, "std", d);
  assert.equal(JSON.stringify(booking), snap);
  // 바뀐 건 요금표 필드뿐
  const keys = Object.keys(next).filter((k) => JSON.stringify((next as never)[k]) !== JSON.stringify((s as never)[k]));
  assert.deepEqual(keys.sort(), ["typeRates", "typeSeasons"].filter((k) => k === "typeRates"));
  // 새 예약의 제안은 새 요금표를 따르되, 방마다 수정한 값이 우선
  const slots = roomSlots(["a"], () => ({ typeId: "std", label: "101호", sub: "" }));
  assert.equal(slotRows(next, slots, {}, "2026-10-25", 2)[0]!.subtotal, 99_000 + 99_000);
});
