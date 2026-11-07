import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeSettings, type Booking } from "./ledger.ts";
import {
  BUILTIN_AGODA_TEMPLATE,
  agodaPartnerSignature,
  extractLabeledPaste,
  loadPasteTemplates,
  parseAgodaLabeledTable,
  parseManualLabeledTable,
  pasteTemplateStorageKey,
  readPasteTemplateStore,
  serializePasteTemplateStore,
  validatePasteTemplate,
} from "./pasteTemplate.ts";
import {
  buildPreviewRows,
  detectProfile,
  enteredNightRates,
  parsePasteTable,
  pathADraftFromPreview,
  profileById,
  HYPOTHESIS_FIXTURES,
} from "./smartRegister.ts";

/** 구조만 같고 이름·예약번호는 가상이다. */
const AGODA_SHAPE = [
  "예약 번호:",
  "",
  "1000000001",
  "",
  "확정된 예약",
  "",
  "athena-symbol-user",
  "투숙객",
  "Mina Park",
  "",
  "성인 2명",
  "athena-calendar-calendar",
  "체크인",
  "2026년 11월 7일",
  "",
  "(16:00)",
  "athena-calendar-calendar",
  "체크아웃",
  "2026년 11월 9일",
  "",
  "(12:00)",
  "athena-promotion-money",
  "기준 판매 요금(세금 및 수수료 포함)",
  "KRW 210,000",
].join("\n");

const settings = normalizeSettings({
  platforms: [
    { id: "p-ya", name: "야놀자", abbr: "야" },
    { id: "p-ye", name: "여기어때", abbr: "여" },
    { id: "p-ag", name: "아고다", abbr: "아" },
  ],
  types: [
    { id: "std", name: "스탠다드" },
    { id: "dlx", name: "디럭스" },
  ],
  stayTimes: { checkIn: "16:00", checkOut: "12:00" },
});

function previewOf(text: string, templates?: Parameters<typeof parsePasteTable>[1]) {
  const table = parsePasteTable(text, templates)!;
  const det = detectProfile(table.headers, text);
  const profile = profileById(det.profileId ?? "agoda")!;
  const rows = buildPreviewRows(table, profile, settings, [], profile.id === "agoda" ? "p-ag" : "p-ya");
  return { table, det, profile, row: rows[0]!, rows };
}

test("아고다 붙여넣기 형식: 예약번호·성인·시각·판매총액만 읽고 결제·박별 금액은 만들지 않는다", () => {
  assert.equal(agodaPartnerSignature(AGODA_SHAPE), true);
  const { det, row } = previewOf(AGODA_SHAPE);
  assert.equal(det.confident, true);
  assert.equal(det.profileId, "agoda");
  assert.equal(row.reservationId, "1000000001");
  assert.equal(row.guestName, "Mina Park");
  assert.equal(row.guests, 2);
  assert.equal(row.checkIn, "2026-11-07");
  assert.equal(row.checkInTime, "16:00");
  assert.equal(row.checkOutTime, "12:00");
  assert.equal(row.nights, 2);
  assert.equal(row.currency, "KRW");
  assert.equal(row.amount, 210000);
  assert.equal(row.priceUnset, false);
  assert.equal(row.typeRaw, "");
  assert.equal(row.typeId, null);
  assert.equal(row.guestPhone, "");
  assert.equal(row.statusRaw, "확정된 예약");
  assert.equal(row.pasteCancel, false);
  assert.equal(row.rowStatus, "need_fix");
  assert.equal(row.nightAmounts, undefined);
  assert.equal(enteredNightRates(row), null);
  assert.match(row.warnings?.join("\n") ?? "", /결제로 넣지 않아요/);
  assert.match(row.warnings?.join("\n") ?? "", /박마다 나누지 않아요/);

  const draft = pathADraftFromPreview(
    { ...row, typeId: "std", rowStatus: "ok" },
    { platformId: "p-ag", platformLabel: "아고다", id: "b-ag", nowIso: "2026-11-01T00:00:00.000Z" },
  );
  assert.equal(draft.price, 210000);
  assert.equal(draft.guests, 2);
  assert.equal(draft.arrived, false);
  assert.equal(draft.earlyIn ?? null, null);
  assert.equal(draft.lateOut ?? null, null);
  assert.equal(draft.nightRates, null);
  assert.equal(draft.payments, undefined);
  assert.equal(draft.status, "active");
  assert.match(draft.memo ?? "", /예약번호 1000000001/);
  assert.match(draft.memo ?? "", /상태 확정된 예약/);
  assert.match(draft.memo ?? "", /입실 16:00/);
  assert.match(draft.memo ?? "", /성인 2/);
  assert.doesNotMatch(draft.memo ?? "", /수납|결제완료|입금/);
});

test("빈 줄·CRLF·NBSP·콜론 생략·아이콘·앞자리 0을 견디고 엉뚱한 금액은 집지 않는다", () => {
  const text = [
    "예약\u00a0번호",
    "",
    "0001000001",
    "확정된 예약",
    "athena-promotion-money",
    "투숙객",
    "Mina\u00a0Park",
    "성인 2명",
    "체크인",
    "2026년 11월 7일",
    "(16:00)",
    "체크아웃",
    "2026년 11월 9일",
    "(12:00)",
    "기준 판매 요금",
    "KRW 210,000",
    "객실 요금 105,000",
  ].join("\r\n");
  const row = previewOf(text).row;
  assert.equal(row.reservationId, "0001000001");
  assert.equal(row.guestName, "Mina Park");
  assert.equal(row.amount, 210000);
  assert.equal(row.nights, 2);
  assert.notEqual(row.amount, 105000);
});

test("잘못된 날짜·시각·금액·서로 다른 글자·없는 칸은 비우고 짐작하지 않는다", () => {
  const badDate = AGODA_SHAPE.replace("2026년 11월 7일", "2026년 13월 40일");
  const dateRow = previewOf(badDate).row;
  assert.equal(dateRow.checkIn, null);
  assert.equal(dateRow.nights, null);
  assert.match(dateRow.warnings?.join("\n") ?? "", /체크인 날짜를 읽지 못했어요/);

  const badTime = AGODA_SHAPE.replace("(16:00)", "(25:99)");
  const timeRow = previewOf(badTime).row;
  assert.equal(timeRow.checkIn, "2026-11-07");
  assert.equal(timeRow.checkInTime, null);
  assert.match(timeRow.warnings?.join("\n") ?? "", /체크인 시각을 읽지 못했어요/);

  const noTime = AGODA_SHAPE.replace("(16:00)", "").replace("(12:00)", "");
  const bare = previewOf(noTime).row;
  assert.equal(bare.checkInTime, null);
  assert.equal(bare.checkOutTime, null);
  assert.equal(bare.checkIn, "2026-11-07");

  const ambiguous = AGODA_SHAPE.replace("KRW 210,000", "KRW 210,000 10,000");
  const money = previewOf(ambiguous).row;
  assert.equal(money.amount, null);
  assert.equal(money.priceUnset, true);
  assert.match(money.warnings?.join("\n") ?? "", /하나로 정할 수 없어요/);

  const usd = AGODA_SHAPE.replace("KRW 210,000", "USD 210");
  const foreign = previewOf(usd).row;
  assert.equal(foreign.amount, null);
  assert.equal(foreign.currency, "USD");

  const bareNumber = AGODA_SHAPE.replace("KRW 210,000", "210,000");
  assert.equal(previewOf(bareNumber).row.amount, null);

  const conflict = `${AGODA_SHAPE}\n체크인\n2026년 12월 1일`;
  const conflicted = previewOf(conflict).row;
  assert.equal(conflicted.checkIn, null);
  assert.match(conflicted.warnings?.join("\n") ?? "", /체크인 글자가 서로 달라/);

  const both = AGODA_SHAPE.replace("확정된 예약", "확정된 예약\n예약취소");
  const mixed = previewOf(both).row;
  assert.equal(mixed.statusRaw, "");
  assert.equal(mixed.pasteCancel, false);
  assert.match(mixed.warnings?.join("\n") ?? "", /예약 상태가 서로 달라/);
});

test("저장된 양식은 그 플랫폼에만 쓰이고, 비면 기본 양식으로 돌아간다", () => {
  const custom = validatePasteTemplate({
    platformId: "agoda",
    labels: { ...BUILTIN_AGODA_TEMPLATE.labels, guestName: "Guest" },
  });
  assert.equal(custom.ok, true);
  if (!custom.ok) return;
  const customText = AGODA_SHAPE.replace("투숙객", "Guest");
  const used = previewOf(customText, { templates: [custom.template] }).row;
  assert.equal(used.guestName, "Mina Park");

  const missed = validatePasteTemplate({
    platformId: "agoda",
    labels: {
      reservationId: "없는번호",
      guestName: "없는이름",
      checkIn: "없는입실",
      checkOut: "없는퇴실",
      salesTotal: "없는요금",
    },
  });
  assert.equal(missed.ok, true);
  if (!missed.ok) return;
  const fellBack = previewOf(AGODA_SHAPE, { templates: [missed.template] }).row;
  assert.equal(fellBack.reservationId, "1000000001");
  assert.equal(fellBack.guestName, "Mina Park");
  assert.equal(fellBack.amount, 210000);

  const yanoljaLabels = validatePasteTemplate({
    platformId: "yanolja",
    labels: { ...BUILTIN_AGODA_TEMPLATE.labels },
  });
  assert.equal(yanoljaLabels.ok, true);
  if (!yanoljaLabels.ok) return;
  const stillAgoda = previewOf(AGODA_SHAPE, { templates: [yanoljaLabels.template] });
  assert.equal(stillAgoda.det.profileId, "agoda");
  assert.equal(stillAgoda.row.guestName, "Mina Park");
  const yanolja = parsePasteTable(HYPOTHESIS_FIXTURES.yanolja, { templates: [custom.template, yanoljaLabels.template] });
  assert.equal(yanolja?.headers[0], "야놀자예약번호");
  assert.equal(detectProfile(yanolja!.headers, HYPOTHESIS_FIXTURES.yanolja).profileId, "yanolja");
  assert.equal(parseManualLabeledTable(AGODA_SHAPE, "yanolja", [yanoljaLabels.template]), null);
});

test("양식 저장은 칸 이름만 담고 손님 글·결제 글자·깨진 저장은 거절한다", () => {
  const payment = validatePasteTemplate({ platformId: "agoda", labels: { salesTotal: "결제금액" } });
  assert.equal(payment.ok, false);
  const payout = validatePasteTemplate({ platformId: "agoda", labels: { salesTotal: "입금예정가" } });
  assert.equal(payout.ok, false);
  const status = validatePasteTemplate({ platformId: "agoda", labels: { guestName: "확정된 예약" } });
  assert.equal(status.ok, false);
  const dup = validatePasteTemplate({
    platformId: "agoda",
    labels: { guestName: "투숙객", checkIn: "투숙객" },
  });
  assert.equal(dup.ok, false);

  const ok = validatePasteTemplate({ platformId: "agoda", labels: { guestName: "Guest" } });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  const stored = serializePasteTemplateStore([ok.template]);
  assert.equal(stored.includes("Mina Park"), false);
  assert.equal(stored.includes("1000000001"), false);
  assert.deepEqual(readPasteTemplateStore(stored), [ok.template]);
  assert.deepEqual(readPasteTemplateStore("{"), []);
  assert.deepEqual(readPasteTemplateStore("[]"), []);
  assert.deepEqual(readPasteTemplateStore("x".repeat(8001)), []);
  assert.deepEqual(
    readPasteTemplateStore(JSON.stringify({ version: 0, templates: [ok.template, { platformId: "agoda", labels: { salesTotal: "수납" } }] })),
    [ok.template],
  );

  const keyA = pasteTemplateStorageKey("hotel-a", "user-a");
  const keyB = pasteTemplateStorageKey("hotel-a", "user-b");
  const keyC = pasteTemplateStorageKey("hotel-b", "user-a");
  assert.ok(keyA && keyB && keyC);
  assert.notEqual(keyA, keyB);
  assert.notEqual(keyA, keyC);
  const mem = new Map<string, string>();
  mem.set(keyA!, stored);
  assert.deepEqual(loadPasteTemplates((k) => mem.get(k) ?? null, "hotel-a", "user-a"), [ok.template]);
  assert.deepEqual(loadPasteTemplates((k) => mem.get(k) ?? null, "hotel-a", "user-b"), []);
  assert.deepEqual(loadPasteTemplates((k) => mem.get(k) ?? null, "hotel-b", "user-a"), []);
  assert.equal(pasteTemplateStorageKey("", "user-a"), null);
  assert.equal(pasteTemplateStorageKey("hotel a", "user-a"), null);

  const literal = validatePasteTemplate({ platformId: "agoda", labels: { guestName: ".*" } });
  assert.equal(literal.ok, true);
  if (!literal.ok) return;
  const extracted = extractLabeledPaste("투숙객\nMina Park\n", literal.template);
  assert.equal(extracted[0]?.guestName ?? null, null);
});

test("이미 있는 예약번호는 새로 만들지 않고, 확정은 취소·입실이 아니다", () => {
  const table = parsePasteTable(AGODA_SHAPE)!;
  const existing = {
    id: "b1",
    platformId: "p-ag",
    memo: "[스마트등록] 아고다 예약번호 1000000001",
    status: "active" as const,
    arrived: false,
    checkedOutAt: null,
    guestName: "Mina Park",
    checkIn: "2026-11-07",
    nights: 2,
    typeId: "std",
  } satisfies Partial<Booking>;
  const rows = buildPreviewRows(table, profileById("agoda")!, settings, [existing], "p-ag");
  assert.equal(rows[0]!.dup, true);
  assert.equal(rows[0]!.rowStatus, "dup");
  assert.equal(rows[0]!.skip, true);
  assert.equal(parseAgodaLabeledTable(HYPOTHESIS_FIXTURES.yanolja), null);
  assert.equal(parseAgodaLabeledTable(HYPOTHESIS_FIXTURES.yeogi), null);
});

test("붙여넣기 인식 코드는 네트워크 AI를 부르지 않는다", () => {
  const src = readFileSync(fileURLToPath(new URL("./pasteTemplate.ts", import.meta.url)), "utf8");
  assert.equal(/\bfetch\s*\(|openai|anthropic|generative|llm/i.test(src), false);
  assert.equal(/\beval\s*\(|new Function\s*\(/.test(src), false);
});
