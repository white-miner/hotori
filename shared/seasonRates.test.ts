// 시즌 · 주말 요일 · 요금 우선순위(특별일 요금 > 시즌 > 평일/주말 > 기본) · 영업일 · 일반/특수 추가요금
import { test } from "node:test";
import assert from "node:assert/strict";
import { businessDate, normalizeSettings } from "./ledger";
import {
  type RateSeason,
  copySeasonTo,
  isWeekendNightIn,
  normalizeTypeSeasons,
  normalizeWeekendDays,
  seasonOn,
  upsertSeason,
  validateSeason,
  validateSeasonList,
} from "./seasonRates";
import { resolveNightRate, resolveStayRates } from "./salesCalendar";
import { isPeakNight, surchargeOf } from "./surcharge";
import { autoNightRates, autoStayRates } from "./autoRate";

const season = (p: Partial<RateSeason> = {}): RateSeason => ({ id: "z1", name: "성수기", from: "2026-07-20", to: "2026-08-20", weekday: 150000, weekend: 200000, ...p });
const base = {
  typeRates: { s: { weekday: 80000, weekend: 100000, flat: 70000 }, f: { weekday: null, weekend: null, flat: 60000 } },
  typeRateOverrides: {} as Record<string, Record<string, number>>,
  typeStopSell: {},
  specialDates: [] as string[],
  typeSeasons: {} as Record<string, RateSeason[]>,
  weekendDays: [5, 6],
};

test("주말 요일: 기본은 금·토 밤, 호텔이 바꿀 수 있고 특별일은 항상 주말", () => {
  assert.deepEqual(normalizeWeekendDays(undefined), [5, 6]);
  assert.deepEqual(normalizeWeekendDays([6, 5, 5, 9, "x", -1]), [5, 6]);
  assert.deepEqual(normalizeWeekendDays([]), [5, 6]); // 비면 기본
  assert.equal(isWeekendNightIn("2026-10-23", [], [5, 6]), true); // 금
  assert.equal(isWeekendNightIn("2026-10-25", [], [5, 6]), false); // 일
  assert.equal(isWeekendNightIn("2026-10-25", [], [0, 5, 6]), true); // 일 추가
  assert.equal(isWeekendNightIn("2026-10-23", [], [6]), false); // 금 제외
  assert.equal(isWeekendNightIn("2026-10-21", ["2026-10-21"], [5, 6]), true); // 특별일 수
  assert.equal(isPeakNight("2026-10-25", [], [0]), true);
  assert.equal(isPeakNight("2026-10-23"), true); // 기본값 호환
});

test("시즌 검사: 이름·날짜·요금·겹침을 한국어로 알려줌", () => {
  assert.equal(validateSeason(season(), []), null);
  assert.match(validateSeason(season({ name: " " }), [])!, /이름/);
  assert.match(validateSeason(season({ from: "" }), [])!, /시작일/);
  assert.match(validateSeason(season({ from: "2026-08-21" }), [])!, /빨라요/);
  assert.match(validateSeason(season({ to: "2028-01-01" }), [])!, /1년/);
  assert.match(validateSeason(season({ weekday: null, weekend: null }), [])!, /요금/);
  assert.equal(validateSeason(season({ weekday: null }), []), null); // 주말만도 OK
});

test("시즌 겹침: 하루라도 겹치면 안 됨, 맞닿는 건(다음날 시작) OK", () => {
  const a = season({ id: "a", from: "2026-07-20", to: "2026-08-20" });
  const err = validateSeason(season({ id: "b", name: "휴가철", from: "2026-08-20", to: "2026-08-30" }), [a])!;
  assert.match(err, /‘성수기’\(7\/20~8\/20\)과 기간이 겹쳐요/);
  assert.equal(validateSeason(season({ id: "b", from: "2026-08-21", to: "2026-08-30" }), [a]), null);
  assert.equal(validateSeason(a, [a]), null); // 자기 자신은 제외
  assert.ok(validateSeasonList([a, season({ id: "b", from: "2026-08-01", to: "2026-08-02" })]));
  assert.equal(validateSeasonList([a, season({ id: "b", from: "2026-09-01", to: "2026-09-02" })]), null);
});

test("upsertSeason: 겹치면 거절하고 원래 목록 유지, 정상이면 날짜순", () => {
  const a = season({ id: "a", from: "2026-09-01", to: "2026-09-10" });
  const r1 = upsertSeason([a], season({ id: "b", from: "2026-09-10", to: "2026-09-12" }));
  assert.ok(r1.error);
  assert.deepEqual(r1.list, [a]);
  const r2 = upsertSeason([a], season({ id: "b", from: "2026-07-01", to: "2026-07-05" }));
  assert.equal(r2.error, null);
  assert.deepEqual(r2.list.map((x) => x.id), ["b", "a"]);
  // 같은 id 수정은 자기 자신과 겹쳐도 OK
  assert.equal(upsertSeason([a], { ...a, to: "2026-09-20" }).error, null);
});

test("copySeasonTo: 겹치는 타입은 건너뛰고 이유를 알려줌", () => {
  const map: Record<string, RateSeason[]> = { b: [season({ id: "x", from: "2026-08-01", to: "2026-08-05" })] };
  let n = 0;
  const r = copySeasonTo(map, season(), ["a", "b"], () => `n${++n}`);
  assert.deepEqual(r.copied, ["a"]);
  assert.equal(r.skipped[0].typeId, "b");
  assert.match(r.skipped[0].reason, /겹쳐요/);
  assert.equal(r.map.a[0].id, "n1");
  assert.equal(r.map.b.length, 1);
  assert.equal(map.a, undefined); // 원본 불변
});

test("normalize: 잘못된 줄은 버리고, 겹치면 빠른 시즌만 남김", () => {
  const m = normalizeTypeSeasons({
    s: [season({ id: "late", from: "2026-08-10", to: "2026-08-30" }), season({ id: "early", from: "2026-07-20", to: "2026-08-15" }), { id: "bad" }, null],
    t: "x",
  });
  assert.deepEqual(m.s.map((x) => x.id), ["early"]);
  assert.equal(m.t, undefined);
  assert.deepEqual(normalizeTypeSeasons(undefined), {});
  const hs = normalizeSettings({ typeSeasons: { s: [season()] }, weekendDays: [0, 6] });
  assert.equal(hs.typeSeasons.s[0].name, "성수기");
  assert.deepEqual(hs.weekendDays, [0, 6]);
  assert.deepEqual(normalizeSettings({}).weekendDays, [5, 6]);
  assert.deepEqual(normalizeSettings({}).typeSeasons, {});
});

test("요금 우선순위: 특별일 요금 > 시즌 > 평일/주말 > 기본", () => {
  const s = { ...base, typeSeasons: { s: [season()] }, typeRateOverrides: { s: { "2026-07-24": 300000 } } };
  // 시즌 밖: 평일/주말
  assert.deepEqual(pick(resolveNightRate(s, "s", "2026-10-19")), [80000, "weekday"]); // 월
  assert.deepEqual(pick(resolveNightRate(s, "s", "2026-10-23")), [100000, "weekend"]); // 금
  // 시즌 안: 평일(월) / 주말(금)
  assert.deepEqual(pick(resolveNightRate(s, "s", "2026-07-20")), [150000, "season"]); // 월
  assert.deepEqual(pick(resolveNightRate(s, "s", "2026-07-25")), [200000, "season"]); // 토
  assert.equal(resolveNightRate(s, "s", "2026-07-25").seasonName, "성수기");
  // 특별일 요금(날짜별 금액)이 시즌보다 우선
  assert.deepEqual(pick(resolveNightRate(s, "s", "2026-07-24")), [300000, "date"]);
  // 시즌 경계: 시작/끝날 포함, 다음날은 제외
  assert.equal(resolveNightRate(s, "s", "2026-08-20").source, "season");
  assert.equal(resolveNightRate(s, "s", "2026-08-21").source, "weekend"); // 8/21(금) 시즌 다음날: 평소 주말 요금
  assert.equal(resolveNightRate(s, "s", "2026-08-24").source, "weekday");
  assert.equal(resolveNightRate(s, "s", "2026-07-19").source, "weekday"); // 7/19(일)은 시즌 직전 평일 밤
});

test("시즌 안에서도 특별일(주말 요금일)은 시즌 주말 요금", () => {
  const s = { ...base, typeSeasons: { s: [season()] }, specialDates: ["2026-07-22"] }; // 수
  assert.equal(resolveNightRate(s, "s", "2026-07-22").amount, 200000);
  assert.equal(resolveNightRate(s, "s", "2026-07-21").amount, 150000);
});

test("시즌 주말이 비면 시즌 평일 요금, 시즌 평일이 비면 평일 밤은 기본 요금으로", () => {
  const s1 = { ...base, typeSeasons: { s: [season({ weekend: null })] } };
  assert.equal(resolveNightRate(s1, "s", "2026-07-25").amount, 150000);
  const s2 = { ...base, typeSeasons: { s: [season({ weekday: null })] } };
  assert.equal(resolveNightRate(s2, "s", "2026-07-20").source, "weekday"); // 시즌에 평일 요금 없음 → 평소 요금
  assert.equal(resolveNightRate(s2, "s", "2026-07-25").amount, 200000);
});

test("주말 요일을 바꾸면 요금도 따라감, 요금이 없으면 0 / none", () => {
  const s = { ...base, weekendDays: [0] }; // 일요일 밤만 주말
  assert.equal(resolveNightRate(s, "s", "2026-10-23").amount, 80000); // 금: 평일 요금
  assert.equal(resolveNightRate(s, "s", "2026-10-25").amount, 100000); // 일: 주말 요금
  assert.deepEqual(pick(resolveNightRate(base, "f", "2026-10-23")), [60000, "flat"]);
  assert.deepEqual(pick(resolveNightRate(base, "none", "2026-10-23")), [0, "none"]);
});

test("영업일 새벽 6시: 새벽 5:30 도착은 전날 밤 요금", () => {
  const s = { ...base, typeSeasons: { s: [season({ from: "2026-10-26", to: "2026-10-26", weekday: 111000, weekend: 111000 })] } };
  const early = businessDate(new Date("2026-10-26T20:30:00Z")); // KST 10/27 05:30
  const later = businessDate(new Date("2026-10-26T21:30:00Z")); // KST 10/27 06:30
  assert.equal(early, "2026-10-26");
  assert.equal(later, "2026-10-27");
  assert.equal(resolveStayRates(s, "s", early, 1)[0].amount, 111000);
  assert.equal(resolveStayRates(s, "s", later, 1)[0].amount, 80000);
});

test("박별 합계: 금토일 3박이 시즌 경계를 넘어도 박마다 계산", () => {
  const s = { ...base, typeSeasons: { s: [season({ from: "2026-10-24", to: "2026-10-24", weekday: 150000, weekend: 200000 })] } };
  const r = resolveStayRates(s, "s", "2026-10-23", 3);
  assert.deepEqual(r.map((x) => [x.date, x.amount, x.source]), [
    ["2026-10-23", 100000, "weekend"],
    ["2026-10-24", 200000, "season"],
    ["2026-10-25", 80000, "weekday"],
  ]);
});

test("자동 요금: 타입×방수×박 합계 · 직접 고친 박이 우선 · 없는 타입은 ready=false", () => {
  const s = { ...base, typeSeasons: { s: [season({ from: "2026-10-24", to: "2026-10-24" })] } };
  const a = autoStayRates(s, [{ typeId: "s", count: 2 }], "2026-10-23", 3);
  assert.equal(a.total, (100000 + 200000 + 80000) * 2);
  assert.equal(a.ready, true);
  assert.equal(a.nightMap["2026-10-24"], 400000);
  const m = autoStayRates(s, [{ typeId: "s", count: 1 }], "2026-10-23", 3, { s: { "2026-10-25": 50000 } });
  assert.equal(m.total, 100000 + 200000 + 50000);
  assert.equal(m.lines[0].nights[2].source, "manual");
  const none = autoStayRates(s, [{ typeId: "s", count: 1 }, { typeId: "zz", count: 1 }], "2026-10-23", 1);
  assert.equal(none.ready, false);
  assert.deepEqual(none.missingTypeIds, ["zz"]);
  assert.equal(autoStayRates(s, [], "2026-10-23", 1).ready, false);
  // 저장용 행렬: 합계 보존
  const nr = autoNightRates(a, 3);
  assert.equal(Object.values(nr.nights!).reduce((x, y) => x + y, 0), a.total);
});

const SS = normalizeSettings({
  types: [
    { id: "s", name: "일반", baseGuests: 2, maxGuests: 4 },
    { id: "h", name: "독채", baseGuests: 4, maxGuests: 8, tierId: "house" },
  ],
  platforms: [{ id: "p", name: "현장", abbr: "현" }],
  floors: [{ id: "f", name: "2층", rooms: [{ id: "r1", no: "201", typeId: "s" }, { id: "rh", no: "펜션", typeId: "h" }] }],
  weekendDays: [0, 5], // 일·금 밤
});
const bkg = (typeId: string, roomId: string) => ({ kind: "stay" as const, checkIn: "2026-10-23", nights: 3, roomId, segments: null, typeId });

test("일반/특수 인원 추가요금도 호텔의 주말 요일을 따라감", () => {
  // 일반(1만/2만): 금(주말)·토(평일)·일(주말), 4명 → 추가 2명
  const x = surchargeOf(SS, bkg("s", "r1"), 4);
  assert.equal(x.total, 2 * 20000 + 2 * 10000 + 2 * 20000);
  // 특수(독채 tier house): 기본/추가금은 기존 규칙, 주말 판정만 바뀜
  const y = surchargeOf(SS, bkg("h", "rh"), 6);
  const dflt = surchargeOf({ ...SS, weekendDays: [5, 6] }, bkg("h", "rh"), 6);
  assert.equal(dflt.nights.map((n) => n.peak).join(), "true,true,false"); // 기본 금·토
  assert.equal(y.nights.map((n) => n.peak).join(), "true,false,true");
});

function pick(r: { amount: number; source: string }) {
  return [r.amount, r.source];
}
