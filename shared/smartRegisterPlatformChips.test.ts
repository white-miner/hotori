/**
 * ≥30 verification cases: settings platform chips · forced isolated readers · 야놀자 checkIn+nights.
 * Source of truth for /internal/smart-register-30-verify.md — keep case ids stable.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeSettings } from "./ledger.ts";
import {
  HYPOTHESIS_FIXTURES,
  YANOLJA_UNIFIED_CARD_PASTE_FIXTURE_PATH,
  buildPreviewRows,
  looksLikeYanoljaCardPaste,
  matchProfileForHotelPlatform,
  parseForcedHotelPlatform,
  parsePasteTable,
  parseYanoljaCardPaste,
  profileById,
} from "./smartRegister.ts";
import { agodaPartnerSignature, validatePasteTemplate } from "./pasteTemplate.ts";
import { AGODA_FULL_A, agodaFullText } from "./testFixtures/agodaPartnerFull.ts";

const settings = normalizeSettings({
  platforms: [
    { id: "p-ya", name: "야놀자", abbr: "야" },
    { id: "p-ye", name: "여기어때", abbr: "여" },
    { id: "p-ag", name: "아고다", abbr: "아" },
    { id: "p-air", name: "에어비앤비", abbr: "에" },
    { id: "p-walk", name: "현장·전화", abbr: "현", onsite: true },
  ],
  types: [
    { id: "std", name: "스탠다드" },
    { id: "dlx", name: "디럭스" },
    { id: "ondol", name: "온돌" },
    { id: "twin", name: "트윈" },
  ],
});

const sotRaw = readFileSync(fileURLToPath(YANOLJA_UNIFIED_CARD_PASTE_FIXTURE_PATH), "utf8");
const sotChrome = `필터\t특\t직접관리\t예약완료\n${sotRaw}`;
const agodaRaw = agodaFullText(AGODA_FULL_A);

function forcedYa(text = sotRaw) {
  return parseForcedHotelPlatform(text, "p-ya", settings);
}

function previewForced(text: string, platId: string) {
  const hit = parseForcedHotelPlatform(text, platId, settings);
  assert.ok(hit, `forced ${platId} must parse`);
  return buildPreviewRows(hit.table, hit.profile, settings, [], platId);
}

/** —— (1) platform chips from settings —— */
test("C01 matchProfileForHotelPlatform: 야놀자 name → yanolja", () => {
  assert.equal(matchProfileForHotelPlatform({ id: "p-ya", name: "야놀자", abbr: "야" })?.id, "yanolja");
});
test("C02 matchProfileForHotelPlatform: 여기어때 → yeogi", () => {
  assert.equal(matchProfileForHotelPlatform({ id: "p-ye", name: "여기어때" })?.id, "yeogi");
});
test("C03 matchProfileForHotelPlatform: 아고다 → agoda", () => {
  assert.equal(matchProfileForHotelPlatform({ id: "p-ag", name: "아고다", abbr: "아" })?.id, "agoda");
});
test("C04 matchProfileForHotelPlatform: abbr 야 alone → yanolja", () => {
  assert.equal(matchProfileForHotelPlatform({ id: "x", name: "채널A", abbr: "야" })?.id, "yanolja");
});
test("C05 matchProfileForHotelPlatform: 에어비앤비 → no seed profile", () => {
  assert.equal(matchProfileForHotelPlatform({ id: "p-air", name: "에어비앤비", abbr: "에" }), undefined);
});
test("C05b 동네예약 abbr 동 must not match naver via 「네」 substring", () => {
  assert.equal(matchProfileForHotelPlatform({ id: "p-x", name: "동네예약", abbr: "동" }), undefined);
});
test("C06 chip ids are hotel platforms[].id not hardcoded profile ids", () => {
  const ids = settings.platforms.map((p) => p.id);
  assert.deepEqual(ids, ["p-ya", "p-ye", "p-ag", "p-air", "p-walk"]);
  assert.equal(ids.includes("yanolja"), false);
  assert.equal(ids.includes("agoda"), false);
});
test("C07 empty settings platforms → forced parse null (no phantom chips)", () => {
  const empty = normalizeSettings({ platforms: [], types: settings.types });
  assert.equal(parseForcedHotelPlatform(sotRaw, "p-ya", empty), null);
});
test("C08 unknown hotel platform id → forced null", () => {
  assert.equal(parseForcedHotelPlatform(sotRaw, "no-such", settings), null);
});
test("C09 onsite 현장·전화 is listed in settings chips source", () => {
  assert.ok(settings.platforms.some((p) => p.id === "p-walk" && p.onsite));
  assert.equal(matchProfileForHotelPlatform(settings.platforms.find((p) => p.id === "p-walk")!), undefined);
});
test("C10 settings platform count drives chip count (≥1 when registered)", () => {
  assert.equal(settings.platforms.length >= 1, true);
  assert.equal(settings.platforms.every((p) => typeof p.name === "string" && p.name.length > 0), true);
});

/** —— (2) forced chip → isolated reader only —— */
test("C11 chip=야놀자 + SoT card → yanolja-card + platformId p-ya", () => {
  const hit = forcedYa();
  assert.ok(hit);
  assert.equal(hit!.kind, "yanolja-card");
  assert.equal(hit!.profile.id, "yanolja");
  assert.equal(hit!.platformId, "p-ya");
});
test("C12 chip=야놀자 + tab chrome → still yanolja-card (no yeogi/agoda)", () => {
  assert.equal(looksLikeYanoljaCardPaste(sotChrome), true);
  const hit = forcedYa(sotChrome);
  assert.ok(hit);
  assert.equal(hit!.kind, "yanolja-card");
  assert.equal(hit!.platformId, "p-ya");
});
test("C13 chip=아고다 + 야놀자 SoT → null (no cross rewrite)", () => {
  assert.equal(parseForcedHotelPlatform(sotRaw, "p-ag", settings), null);
  assert.equal(parseForcedHotelPlatform(sotChrome, "p-ag", settings), null);
});
test("C14 chip=여기어때 + 야놀자 SoT → null (no generic garbage)", () => {
  assert.equal(parseForcedHotelPlatform(sotRaw, "p-ye", settings), null);
});
test("C15 chip=에어비앤비 + 야놀자 SoT → null", () => {
  assert.equal(parseForcedHotelPlatform(sotRaw, "p-air", settings), null);
});
test("C16 chip=야놀자 + 아고다 partner → null (no Agoda under 야놀자)", () => {
  assert.equal(agodaPartnerSignature(agodaRaw), true);
  assert.equal(parseForcedHotelPlatform(agodaRaw, "p-ya", settings), null);
});
test("C17 chip=아고다 + 아고다 partner → agoda kind + p-ag", () => {
  const hit = parseForcedHotelPlatform(agodaRaw, "p-ag", settings);
  assert.ok(hit);
  assert.equal(hit!.kind, "agoda");
  assert.equal(hit!.platformId, "p-ag");
  assert.equal(hit!.profile.id, "agoda");
});
test("C18 chip=여기어때 + 여기어때 TSV → yeogi table", () => {
  const hit = parseForcedHotelPlatform(HYPOTHESIS_FIXTURES.yeogi, "p-ye", settings);
  assert.ok(hit);
  assert.equal(hit!.profile.id, "yeogi");
  assert.equal(hit!.platformId, "p-ye");
  assert.equal(hit!.kind, "table");
});
test("C19 chip=야놀자 + 야놀자 TSV hypothesis → table fits yanolja", () => {
  const hit = parseForcedHotelPlatform(HYPOTHESIS_FIXTURES.yanolja, "p-ya", settings);
  assert.ok(hit);
  assert.equal(hit!.profile.id, "yanolja");
  assert.equal(hit!.platformId, "p-ya");
});
test("C20 chip=여기어때 + 아고다 partner → null", () => {
  assert.equal(parseForcedHotelPlatform(agodaRaw, "p-ye", settings), null);
});
test("C21 chip=에어비앤비 + 아고다 → null (unknown never steals agoda)", () => {
  assert.equal(parseForcedHotelPlatform(agodaRaw, "p-air", settings), null);
});
test("C22 chip=에어비앤비 + saved template only that platform", () => {
  const v = validatePasteTemplate({
    platformId: "p-air",
    labels: { reservationId: "확인코드", guestName: "게스트", checkIn: "도착일", nights: "숙박수", salesTotal: "총요금" },
  });
  assert.equal(v.ok, true);
  if (!v.ok) return;
  const paste = ["확인코드", "AB-99", "게스트", "Taylor", "도착일", "2026년 11월 10일", "숙박수", "2", "총요금", "₩150,000"].join("\n");
  const hit = parseForcedHotelPlatform(paste, "p-air", settings, { templates: [v.template] });
  assert.ok(hit);
  assert.equal(hit!.kind, "saved");
  assert.equal(hit!.platformId, "p-air");
  const rows = buildPreviewRows(hit!.table, hit!.profile, settings, [], "p-air");
  assert.equal(rows[0]!.reservationId, "AB-99");
  assert.equal(rows[0]!.guestName, "Taylor");
  assert.equal(rows[0]!.platformId, "p-air");
});
test("C23 auto cascade (unforced) still reads 야놀자 card", () => {
  const t = parsePasteTable(sotChrome);
  assert.ok(t);
  assert.equal(t!.rows.length, 12);
});
test("C24 auto cascade still reads 아고다 partner", () => {
  const t = parsePasteTable(agodaRaw);
  assert.ok(t);
  assert.ok(t!.rows.length >= 1);
});

/** —— (3) Yanolja paste fills checkIn+nights (+ id/name/type/amount) —— */
test("C25 chip=야놀자 SoT row0: id/name/type/checkIn/nights/amount", () => {
  const rows = previewForced(sotRaw, "p-ya");
  const r = rows[0]!;
  assert.equal(r.platformId, "p-ya");
  assert.equal(r.reservationId, "2610151829300184");
  assert.equal(r.guestName, "김테스트");
  assert.match(r.typeRaw, /Family Room/);
  assert.equal(r.checkIn, "2026-10-26");
  assert.equal(r.nights, 2);
  assert.equal(r.amount, 200000);
});
test("C26 chip=야놀자 SoT row1 cancel: checkIn+nights filled", () => {
  const r = previewForced(sotRaw, "p-ya")[1]!;
  assert.equal(r.reservationId, "2610152133600141");
  assert.equal(r.checkIn, "2026-10-26");
  assert.equal(r.nights, 1);
  assert.equal(r.pasteCancel, true);
});
test("C27 chip=야놀자 SoT row2: checkIn+nights+amount", () => {
  const r = previewForced(sotRaw, "p-ya")[2]!;
  assert.equal(r.checkIn, "2026-10-26");
  assert.equal(r.nights, 1);
  assert.equal(r.amount, 90000);
});
test("C28 chip=야놀자 chrome SoT: same checkIn+nights as clean", () => {
  const clean = previewForced(sotRaw, "p-ya")[0]!;
  const chrome = previewForced(sotChrome, "p-ya")[0]!;
  assert.equal(chrome.checkIn, clean.checkIn);
  assert.equal(chrome.nights, clean.nights);
  assert.equal(chrome.reservationId, clean.reservationId);
  assert.equal(chrome.amount, clean.amount);
});
test("C29 chip=야놀자: every SoT row has checkIn and nights≥1", () => {
  const rows = previewForced(sotRaw, "p-ya");
  assert.equal(rows.length, 12);
  for (const r of rows) {
    assert.ok(r.checkIn && /^\d{4}-\d{2}-\d{2}$/.test(r.checkIn), `${r.reservationId} checkIn`);
    assert.ok(r.nights != null && r.nights >= 1, `${r.reservationId} nights`);
    assert.ok(r.reservationId, "reservationId");
    assert.ok(r.guestName, "guestName");
    assert.ok(r.amount != null && r.amount > 0, `${r.reservationId} amount`);
  }
});
test("C30 chip=야놀자: bare N박 without slash still fills nights+checkIn", () => {
  const block = [
    "2610999000000001",
    "홍길동",
    "010-0000-0001",
    "차량",
    "스탠다드",
    "(객실 타입 ID: 1)",
    "숙박",
    "2박",
    "2026.11.01(토) 15:00",
    "2026.11.03(월) 11:00",
    "예약완료",
    "판매가 110,000원",
  ].join("\n");
  const rows = previewForced(block, "p-ya");
  assert.equal(rows[0]!.checkIn, "2026-11-01");
  assert.equal(rows[0]!.nights, 2);
  assert.equal(rows[0]!.amount, 110000);
  assert.equal(rows[0]!.guestName, "홍길동");
});
test("C31 chip=야놀자 TSV hypothesis: checkIn+nights", () => {
  const rows = previewForced(HYPOTHESIS_FIXTURES.yanolja, "p-ya");
  assert.ok(rows[0]!.checkIn);
  assert.ok(rows[0]!.nights != null && rows[0]!.nights >= 1);
  assert.equal(rows[0]!.platformId, "p-ya");
});
test("C32 parseYanoljaCardPaste SoT still exposes date cells before normalize", () => {
  const card = parseYanoljaCardPaste(sotRaw);
  assert.ok(card);
  assert.match(card!.rows[0]![4]!, /^2026\.10\.26/);
  assert.equal(card!.rows[0]![6], "2");
});
test("C33 chip=아고다 fills checkIn+nights from partner page", () => {
  const rows = previewForced(agodaRaw, "p-ag");
  assert.equal(rows[0]!.checkIn, "2026-11-07");
  assert.equal(rows[0]!.nights, 2);
  assert.equal(rows[0]!.platformId, "p-ag");
  assert.equal(rows[0]!.reservationId, "1000000001");
});
test("C34 live owner 야놀자 sample (if present): chip force fills checkIn+nights", () => {
  const live = "/cursor/stores/bc-fc855f4a-4cd7-41f6-8016-26e7dc29c864/internal/yanolja-unified-drag-paste-sample.txt";
  if (!existsSync(live)) return;
  const rows = previewForced(readFileSync(live, "utf8"), "p-ya");
  assert.ok(rows.length >= 1);
  assert.ok(rows[0]!.checkIn);
  assert.ok(rows[0]!.nights != null && rows[0]!.nights >= 1);
  assert.equal(rows[0]!.platformId, "p-ya");
});
test("C35 profileById seed labels stay available for chip→reader map", () => {
  assert.equal(profileById("yanolja")?.label, "야놀자");
  assert.equal(profileById("agoda")?.label, "아고다");
  assert.equal(profileById("yeogi")?.label, "여기어때");
});
