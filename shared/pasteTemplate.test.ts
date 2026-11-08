import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeSettings, type Booking } from "./ledger.ts";
import {
  BUILTIN_AGODA_TEMPLATE,
  agodaPartnerSignature,
  PASTE_FIELD_LABELS,
  PASTE_TEMPLATE_FIELDS,
  choiceFitsField,
  extractLabeledPaste,
  keepTemplateDraft,
  listPasteChoices,
  loadPasteTemplates,
  readFieldValue,
  lineIndexForSelection,
  readPasteLines,
  ruleForPickedLine,
  parseAgodaLabeledTable,
  parseSharedLabeledTable,
  learnPasteLabel,
  forgetPasteLabel,
  learnedLabelEntries,
  mentionedPlatformId,
  platformByLearnedLabels,
  pickableForField,
  parseBestSavedTemplate,
  parseManualLabeledTable,
  pasteTemplateStorageKey,
  readPasteTemplateStore,
  serializePasteTemplateStore,
  validatePasteTemplate,
} from "./pasteTemplate.ts";
import {
  CANONICAL_FIELDS,
  SMART_REGISTER_TEMPLATE_COLUMNS,
  buildPreviewRows,
  detectProfile,
  enteredNightRates,
  parsePasteTable,
  pathADraftFromPreview,
  yanoljaCardSlots,
  yanoljaGuestSlots,
  profileById,
  HYPOTHESIS_FIXTURES,
} from "./smartRegister.ts";
import { AGODA_FULL_A, AGODA_FULL_B, agodaFullText, agodaScreenText, type AgodaScreenLanguage } from "./testFixtures/agodaPartnerFull.ts";

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
  assert.doesNotMatch(row.warnings?.join("\n") ?? "", /결제로 넣지 않아요|박마다 나누지 않아요/);

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

test("아고다 상세 글: 같은 줄의 요일·시각, 객실 한 줄, 금액·인원·연락처는 비운다", () => {
  const text = [
    "예약 번호",
    "1000000001",
    "",
    "확정된 예약",
    "",
    "투숙객 이름",
    "Mina Park",
    "",
    "투숙객 거주 국가",
    "대한민국",
    "",
    "연락처 정보",
    "체크인",
    "2026년 11월 7일 토요일, 16:00",
    "",
    "체크아웃",
    "2026년 11월 9일 월요일, 12:00",
    "",
    "예약 로그",
    "",
    "예약 생성일(방콕, UTC+7)",
    "2026년 11월 7일 토요일, 00:52",
    "",
    "최종 변경:",
    "2026년 11월 7일 토요일, 00:53",
    "",
    "객실 및 투숙 인원",
    "",
    "객실 종류 및 혜택",
    "1 X 스탠다드 스타일러 (1000000999)",
    "",
    "무료 Wi-Fi, 식수/생수",
  ].join("\n");
  const { det, row, rows } = previewOf(text);
  assert.equal(det.profileId, "agoda");
  assert.equal(det.confident, true);
  assert.equal(rows.length, 1);
  assert.equal(row.reservationId, "1000000001");
  assert.equal(row.guestName, "Mina Park");
  assert.equal(row.guests ?? null, null);
  assert.equal(row.guestPhone, "");
  assert.equal(row.checkIn, "2026-11-07");
  assert.equal(row.checkInTime, "16:00");
  assert.equal(row.checkOutTime, "12:00");
  assert.equal(row.nights, 2);
  assert.equal(row.amount, null);
  assert.equal(row.priceUnset, true);
  assert.equal(row.pasteCancel, false);
  assert.equal(row.statusRaw, "확정된 예약");
  assert.equal(row.typeRaw, "1 X 스탠다드 스타일러 (1000000999)");
  assert.notEqual(row.checkInTime, "00:52");
  assert.doesNotMatch(row.warnings?.join("\n") ?? "", /결제로 넣지 않아요|거주 국가|박마다 나누지/);
  const draft = pathADraftFromPreview(
    { ...row, typeId: row.typeId ?? "std" },
    { platformId: "p-ag", platformLabel: "아고다", id: "b-detail", nowIso: "2026-11-01T00:00:00.000Z" },
  );
  assert.equal(draft.price, 0);
  assert.equal(draft.priceUnset, true);
  assert.equal(draft.guests ?? null, null);
  assert.equal(draft.payments, undefined);
  assert.equal(draft.nightRates, null);
  assert.equal(draft.arrived, false);
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
    labels: { guestName: "투숙객", adults: "성인", nights: "성인", checkIn: "체크인", checkInTime: "체크인" },
  });
  assert.equal(dup.ok, true);

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

test("값을 고르면 칸 이름만 남고, 다음 예약의 다른 손님도 그 양식으로 읽는다", () => {
  const choices = listPasteChoices(AGODA_SHAPE);
  const guest = choices.find((c) => c.value === "Mina Park");
  const checkIn = choices.find((c) => c.value.includes("2026년 11월 7일") && c.value.includes("16:00"));
  const money = choices.find((c) => c.value.includes("210,000"));
  assert.equal(guest?.label, "투숙객");
  assert.equal(checkIn?.label, "체크인");
  assert.equal(money?.label, "기준 판매 요금(세금 및 수수료 포함)");
  assert.equal(choiceFitsField("salesTotal", "확정된 예약"), false);
  assert.equal(choiceFitsField("salesTotal", "KRW 210,000"), true);
  assert.equal(choiceFitsField("checkIn", "2026년 11월 7일 16:00"), true);
  const lines = readPasteLines(AGODA_SHAPE);
  assert.ok(lines.some((l) => l.text === "Mina Park" && l.label === "투숙객"));
  assert.equal(readFieldValue(AGODA_SHAPE, "checkIn", "체크인"), "2026-11-07 16:00");
  assert.equal(readFieldValue(AGODA_SHAPE, "guestName", "투숙객"), "Mina Park");
  assert.equal(readFieldValue(AGODA_SHAPE, "salesTotal", "기준 판매 요금"), "KRW 210000");

  const saved = validatePasteTemplate({
    platformId: "p-book",
    labels: { reservationId: "예약 번호", guestName: "투숙객", checkIn: "체크인", checkOut: "체크아웃" },
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const stored = serializePasteTemplateStore([saved.template]);
  assert.equal(stored.includes("Mina Park"), false);
  assert.equal(stored.includes("1000000001"), false);
  const custom = ["예약 번호", "2000000002", "투숙객", "Ari Stone", "체크인", "2026년 11월 7일", "체크아웃", "2026년 11월 9일"].join("\n");
  const hit = parseBestSavedTemplate(custom, [saved.template]);
  assert.equal(hit?.platformId, "p-book");
  const row = buildPreviewRows(hit!.table, profileById("yanolja")!, settings, [], hit!.platformId)[0]!;
  assert.equal(row.guestName, "Ari Stone");
  assert.equal(row.reservationId, "2000000002");
  assert.equal(row.checkIn, "2026-11-07");
  assert.equal(row.nights, 2);
  assert.equal(row.amount, null);
  assert.equal(normalizeSettings({ pasteTemplates: [{ labels: { guestName: "투숙객" } }] }).pasteTemplates.length, 0);
  assert.equal(normalizeSettings({ pasteTemplates: [saved.template] }).pasteTemplates[0]?.labels.guestName, "투숙객");
});

test("양식 설정 항목은 스마트등록이 읽는 칸 전부와 일대일이다", () => {
  assert.deepEqual(
    SMART_REGISTER_TEMPLATE_COLUMNS.map((col) => col.id).sort(),
    [...CANONICAL_FIELDS].sort(),
  );
  assert.deepEqual(
    SMART_REGISTER_TEMPLATE_COLUMNS.map((col) => [col.id === "amount" ? "salesTotal" : col.id, col.label]),
    PASTE_TEMPLATE_FIELDS.map((id) => [id, PASTE_FIELD_LABELS[id]]),
  );
  assert.deepEqual(
    SMART_REGISTER_TEMPLATE_COLUMNS.filter((col) => col.preview).map((col) => col.label),
    ["상태", "이름", "전화", "타입", "입실", "박수", "판매금", "예약번호"],
  );
  assert.equal(SMART_REGISTER_TEMPLATE_COLUMNS.find((col) => col.id === "adults")?.label, "인원");
  assert.equal((PASTE_TEMPLATE_FIELDS as readonly string[]).includes("company"), false);
  assert.equal(readFieldValue(AGODA_SHAPE, "adults", "성인"), "2");
  assert.equal(readFieldValue(AGODA_SHAPE, "checkInTime", "체크인"), "16:00");
  const kept = keepTemplateDraft({ guestName: "투숙객", adults: "성인" }, {}, true);
  assert.deepEqual(kept, { guestName: "투숙객", adults: "성인" });
  assert.deepEqual(keepTemplateDraft({ guestName: "투숙객" }, {}, false), { guestName: "투숙객" });
  assert.deepEqual(keepTemplateDraft({}, { guestName: "투숙객", adults: "성인" }, false), { guestName: "투숙객", adults: "성인" });
  const stripped = validatePasteTemplate({ platformId: "p-ag", labels: { guestName: "투숙객", company: "빠진회사" } });
  assert.equal(stripped.ok, true);
  if (!stripped.ok) return;
  assert.equal(stripped.template.labels.guestName, "투숙객");
  assert.equal("company" in stripped.template.labels, false);
  const statusLabel = validatePasteTemplate({ platformId: "agoda", labels: { statusRaw: "확정된 예약" } });
  assert.equal(statusLabel.ok, true);
  assert.equal(readFieldValue(AGODA_SHAPE, "statusRaw", "확정된 예약"), "확정된 예약");
  assert.equal(choiceFitsField("statusRaw", "확정된 예약"), true);
  const nightsText = ["박수", "2", "체크인", "2026년 11월 7일", "체크아웃", "2026년 11월 9일"].join("\n");
  assert.equal(readFieldValue(nightsText, "nights", "박수"), "2");
  const saved = validatePasteTemplate({
    platformId: "p-book",
    profileId: "agoda",
    labels: { guestName: "투숙객", checkIn: "체크인", salesTotal: "기준 판매 요금", statusRaw: "확정된 예약", reservationId: "예약 번호" },
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const stored = serializePasteTemplateStore([saved.template]);
  assert.equal(stored.includes("Mina Park"), false);
  assert.equal(stored.includes("1000000001"), false);
  assert.equal(stored.includes("210"), false);
  const again = readPasteTemplateStore(stored)[0]!;
  assert.equal(again.labels.guestName, "투숙객");
  assert.equal(again.labels.checkIn, "체크인");
  assert.equal(again.labels.salesTotal, "기준 판매 요금");
  assert.equal(again.labels.statusRaw, "확정된 예약");
  assert.equal(readFieldValue(AGODA_SHAPE, "guestName", again.labels.guestName!), "Mina Park");
  assert.equal(readFieldValue(AGODA_SHAPE, "checkIn", again.labels.checkIn!), "2026-11-07 16:00");
  const second = ["예약 번호", "2000000002", "확정된 예약", "투숙객", "Ari Stone", "체크인", "2026년 12월 1일", "16:00", "체크아웃", "2026년 12월 3일", "12:00"].join("\n");
  assert.equal(readFieldValue(second, "guestName", again.labels.guestName!), "Ari Stone");
  assert.equal(readFieldValue(second, "reservationId", again.labels.reservationId!), "2000000002");
  assert.equal(readFieldValue(second, "checkIn", again.labels.checkIn!), "2026-12-01 16:00");
  assert.equal(readFieldValue(second, "statusRaw", again.labels.statusRaw!), "확정된 예약");
});

test("같은 예약번호의 요약과 상세는 한 건이고 아동은 인원에 더하지 않는다", () => {
  const text = [
    "예약 번호",
    "1000000001",
    "확정된 예약",
    "투숙객",
    "Mina Park",
    "성인 2명",
    "체크인",
    "2026년 11월 7일 (16:00)",
    "체크아웃",
    "2026년 11월 9일 (12:00)",
    "기준 판매 요금(세금 및 수수료 포함)",
    "KRW 210,000",
    "예약 번호",
    "1000000001",
    "투숙객 이름",
    "Mina Park",
    "연락처 정보",
    "보기",
    "체크인",
    "2026년 11월 7일 토요일, 16:00",
    "체크아웃",
    "2026년 11월 9일 월요일, 12:00",
    "객실 종류 및 혜택",
    "1 X 스탠다드 (1000000999)",
    "숙박 기간",
    "2",
    "성인",
    "2",
    "아동",
    "0",
    "간이침대",
    "0",
  ].join("\n");
  const { row, rows } = previewOf(text);
  assert.equal(rows.length, 1);
  assert.equal(row.guestName, "Mina Park");
  assert.equal(row.reservationId, "1000000001");
  assert.equal(row.guests, 2);
  assert.equal(row.amount, 210000);
  assert.equal(row.typeRaw, "1 X 스탠다드 (1000000999)");
  assert.equal(row.checkIn, "2026-11-07");
  assert.equal(row.checkInTime, "16:00");
  assert.equal(row.nights, 2);
  assert.equal(row.guestPhone, "");
  assert.match(row.warnings?.join("\n") ?? "", /연락처를 읽지 못했어요/);
  const draft = pathADraftFromPreview(
    { ...row, typeId: "std", rowStatus: "ok" },
    { platformId: "p-ag", platformLabel: "아고다", id: "b", nowIso: "2026-11-08T00:00:00.000Z" },
  );
  assert.equal(draft.guests, 2);
  assert.equal(draft.payments, undefined);
  assert.equal(draft.guestPhone, null);
  const two = text.replace("예약 번호\n1000000001\n투숙객 이름", "예약 번호\n2000000002\n투숙객 이름").replace("Mina Park\n연락처", "Ari Stone\n연락처");
  const split = previewOf(two);
  assert.equal(split.rows.length, 2);
  assert.equal(split.rows[0]?.reservationId, "1000000001");
  assert.equal(split.rows[1]?.reservationId, "2000000002");
  assert.equal(split.rows[1]?.guestName, "Ari Stone");
  const clash = text.replace("KRW 210,000", "KRW 210,000\n기준 판매 요금\nKRW 180,000");
  const money = previewOf(clash).row;
  assert.equal(money.amount, null);
  assert.match(money.warnings?.join("\n") ?? "", /판매 총액 글자가 서로 달라/);
  const bare = readPasteLines("Mina Park\n2026-11-07");
  assert.equal(ruleForPickedLine(bare, 0, "guestName"), null);
  const saved = validatePasteTemplate({
    platformId: "p-book",
    labels: { guestName: "예약자", adults: "성인", checkIn: "입실일", reservationId: "예약번호", salesTotal: "판매금" },
    rules: { adults: { label: "성인", occurrence: 0 } },
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const stored = serializePasteTemplateStore([saved.template]);
  assert.equal(stored.includes("Mina Park"), false);
  const custom = ["예약번호", "3000000003", "예약자", "Mina Park", "성인", "2명", "입실일", "2026년 11월 7일 (16:00)", "판매금", "KRW 210,000"].join("\n");
  const again = custom.replace("Mina Park", "Ari Stone").replace("3000000003", "3000000004").replace("2명", "4명").replace("210,000", "180,000");
  const hit = parseBestSavedTemplate(again, [saved.template]);
  assert.equal(hit?.platformId, "p-book");
  const reused = buildPreviewRows(hit!.table, profileById("yanolja")!, settings, [], "p-book")[0]!;
  assert.equal(reused.guestName, "Ari Stone");
  assert.equal(reused.guests, 4);
  assert.equal(reused.amount, 180000);
  assert.equal(reused.checkInTime, "16:00");
});

test("등록되지 않은 한글 이름·객실명도 위 줄을 칸 이름으로 연결한다", () => {
  const text = [
    "예약 번호",
    "HOTORI-UI-TEST-20261108",
    "투숙객 이름",
    "테스트손님",
    "성인",
    "2",
    "체크인",
    "2026년 12월 1일 (16:00)",
    "체크아웃",
    "2026년 12월 3일 (11:00)",
    "기준 판매 요금",
    "KRW 180,000",
    "객실 종류 및 혜택",
    "테스트 객실",
  ].join("\n");
  const lines = readPasteLines(text);
  const name = lines.find((line) => line.text === "테스트손님");
  const room = lines.find((line) => line.text === "테스트 객실");
  assert.equal(name?.label, "투숙객 이름");
  assert.equal(room?.label, "객실 종류 및 혜택");
  const nameRule = ruleForPickedLine(lines, lines.findIndex((line) => line.text === "테스트손님"), "guestName");
  const roomRule = ruleForPickedLine(lines, lines.findIndex((line) => line.text === "테스트 객실"), "typeRaw");
  assert.equal(nameRule?.label, "투숙객 이름");
  assert.equal(roomRule?.label, "객실 종류 및 혜택");
  assert.equal(readFieldValue(text, "guestName", nameRule!.label, nameRule!.occurrence), "테스트손님");
  assert.equal(readFieldValue(text, "typeRaw", roomRule!.label, roomRule!.occurrence), "테스트 객실");
  const renamed = text.replace("투숙객 이름", "예약자 이름").replace("테스트손님", "다른손님").replace("테스트 객실", "다른 객실");
  assert.equal(readFieldValue(renamed, "guestName", "예약자 이름"), "다른손님");
  assert.equal(readFieldValue(renamed, "typeRaw", "객실 종류 및 혜택"), "다른 객실");
  const saved = validatePasteTemplate({
    platformId: "p-ya",
    labels: { guestName: "예약자 이름", typeRaw: "객실 종류 및 혜택", adults: "성인", salesTotal: "기준 판매 요금", checkIn: "체크인" },
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(serializePasteTemplateStore([saved.template]).includes("테스트손님"), false);
  assert.equal(serializePasteTemplateStore([saved.template]).includes("다른손님"), false);
  const orphan = readPasteLines("테스트손님");
  assert.equal(ruleForPickedLine(orphan, 0, "guestName"), null);
  const underAdult = ["투숙객", "김민수", "성인 2명", "체크인", "2026년 12월 1일"].join("\n");
  const adultLines = readPasteLines(underAdult);
  const picked = adultLines.find((line) => line.text === "김민수");
  assert.equal(picked?.label, "투숙객");
  assert.notEqual(picked?.label, picked?.text);
  const adultRule = ruleForPickedLine(adultLines, adultLines.findIndex((line) => line.text === "김민수"), "guestName");
  assert.equal(adultRule?.label, "투숙객");
  assert.equal(readFieldValue(underAdult, "guestName", adultRule!.label, adultRule!.occurrence), "김민수");
});

test("같은 줄의 한글 값과 반복된 숫자는 고른 위치만 다시 읽는다", () => {
  const text = [
    "예약자: 홍길동",
    "객실 종류: 디럭스 더블",
    "도착일: 2026-12-05",
    "판매가: KRW 90,000",
    "숙박 기간: 2",
    "성인: 2",
    "안내 사항",
    "이 예약은 변경할 수 없습니다",
    "객실 설명",
    "디럭스 더블",
    "바다 전망",
    "조식 포함",
  ].join("\n");
  const lines = readPasteLines(text);
  assert.equal(lines.find((line) => line.text === "홍길동")?.label, "예약자");
  assert.equal(lines.find((line) => line.text === "디럭스 더블" && line.label === "객실 종류")?.label, "객실 종류");
  const nameAt = lines.findIndex((line) => line.text === "홍길동");
  const partial = lineIndexForSelection(lines, lines[nameAt]!.valueStart + 1, lines[nameAt]!.valueEnd);
  assert.equal(partial, nameAt);
  const twos = lines.filter((line) => line.text === "2");
  assert.equal(twos.length, 2);
  assert.notEqual(twos[0]!.label, twos[1]!.label);
  const adultAt = lines.findIndex((line) => line.text === "2" && line.label === "성인");
  const adultRule = ruleForPickedLine(lines, adultAt, "adults");
  assert.equal(adultRule?.label, "성인");
  assert.equal(lineIndexForSelection(lines, lines[adultAt]!.valueStart, lines[adultAt]!.valueEnd), adultAt);
  const roomAt = lines.findIndex((line) => line.text === "디럭스 더블" && line.label === "객실 종류");
  const roomRule = ruleForPickedLine(lines, roomAt, "typeRaw");
  const nameRule = ruleForPickedLine(lines, nameAt, "guestName");
  const saved = validatePasteTemplate({
    platformId: "p-other",
    labels: { guestName: nameRule!.label, typeRaw: roomRule!.label, checkIn: "도착일", salesTotal: "판매가", adults: "성인" },
    rules: { guestName: nameRule!, typeRaw: roomRule!, adults: adultRule! },
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const stored = serializePasteTemplateStore([saved.template]);
  assert.equal(stored.includes("홍길동"), false);
  assert.equal(stored.includes("디럭스"), false);
  assert.equal(stored.includes("변경할 수 없습니다"), false);
  const next = ["예약자: 김테스트", "객실 종류: 온돌", "도착일: 2027-01-02", "판매가: KRW 70,000", "성인: 3"].join("\n");
  assert.equal(readFieldValue(next, "guestName", "예약자"), "김테스트");
  assert.equal(readFieldValue(next, "typeRaw", "객실 종류"), "온돌");
  assert.equal(readFieldValue(next, "checkIn", "도착일"), "2027-01-02");
  assert.equal(readFieldValue(next, "salesTotal", "판매가"), "KRW 70000");
  assert.equal(readFieldValue(next, "adults", "성인"), "3");
  const repeated = ["성인", "2", "성인", "5"].join("\n");
  const repeatedLines = readPasteLines(repeated);
  const second = ruleForPickedLine(repeatedLines, repeatedLines.findIndex((line) => line.text === "5"), "adults");
  assert.equal(second?.occurrence, 1);
  assert.equal(readFieldValue(["성인", "4", "성인", "9"].join("\n"), "adults", "성인", 1), "9");
  assert.equal(ruleForPickedLine(readPasteLines("홍길동"), 0, "guestName"), null);
});

test("야놀자 카드 스캔이 읽은 줄은 양식 칸에 연결되고 성인·통화·시각은 만들지 않는다", () => {
  const text = [
    "2610151829300184",
    "김민수",
    "0503-0000-0001",
    "온돌",
    "숙박",
    "/ 2박",
    "2026.12.01(화) 16:00",
    "2026.12.03(목) 11:00",
    "예약완료",
    "판매가 90,000원",
  ].join("\n");
  const lines = readPasteLines(text);
  const slots = yanoljaCardSlots(text, lines);
  const byField = Object.fromEntries(slots.map((slot) => [slot.field, slot]));
  assert.equal(byField.reservationId?.value, "2610151829300184");
  assert.equal(lines[byField.reservationId!.lineIndex]?.text, "2610151829300184");
  assert.equal(byField.guestName?.value, "김민수");
  assert.equal(byField.guestPhone?.value, "0503-0000-0001");
  assert.equal(byField.typeRaw?.value, "온돌");
  assert.equal(byField.nights?.value, "2");
  assert.equal(lines[byField.nights!.lineIndex]?.text, "/ 2박");
  assert.equal(byField.checkIn?.value, "2026.12.01(화) 16:00");
  assert.equal(byField.checkOut?.value, "2026.12.03(목) 11:00");
  assert.equal(byField.statusRaw?.value, "예약완료");
  assert.equal(byField.salesTotal?.value, "90000");
  assert.equal(slots.some((slot) => slot.field === ("adults" as never) || slot.field === ("currency" as never) || slot.field === ("checkInTime" as never)), false);
  const linked = lines.map((line, i) => {
    const slot = slots.find((item) => item.lineIndex === i);
    return slot ? { ...line, label: slot.label } : line;
  });
  assert.equal(ruleForPickedLine(linked, byField.guestPhone!.lineIndex, "guestPhone")?.label, "연락처");
  assert.equal(ruleForPickedLine(linked, byField.salesTotal!.lineIndex, "salesTotal")?.label, "판매금액");
  assert.equal(ruleForPickedLine(linked, byField.checkIn!.lineIndex, "checkIn")?.label, "체크인");
  assert.equal(ruleForPickedLine(linked, byField.statusRaw!.lineIndex, "statusRaw")?.label, "상태");
});

test("야놀자 카드의 한글 이름은 칸 이름이 없어도 기존 스캔의 예약자 줄이다", () => {
  const text = [
    "2610151829300184",
    "김민수",
    "0503-0000-0001",
    "온돌",
    "숙박",
    "/ 1박",
    "2026.12.01(화) 16:00",
    "2026.12.02(수) 12:00",
    "예약완료",
    "판매가 90,000원",
  ].join("\n");
  const lines = readPasteLines(text);
  const slots = yanoljaGuestSlots(text, lines);
  assert.equal(slots.length, 1);
  assert.equal(slots[0]?.name, "김민수");
  assert.equal(lines[slots[0]!.lineIndex]?.text, "김민수");
  assert.equal(ruleForPickedLine(lines, slots[0]!.lineIndex, "guestName"), null);
  const linked = lines.map((line, i) => (i === slots[0]!.lineIndex ? { ...line, label: "예약자" } : line));
  assert.deepEqual(ruleForPickedLine(linked, slots[0]!.lineIndex, "guestName"), { label: "예약자", occurrence: 0 });
  const saved = validatePasteTemplate({ platformId: "p-ya", labels: { guestName: "예약자" }, rules: { guestName: { label: "예약자", occurrence: 0 } } });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(serializePasteTemplateStore([saved.template]).includes("김민수"), false);
});

test("고른 값 하나만 있으면 다른 위치와 없는 두번째 값으로 경고하지 않는다", () => {
  const text = ["체크인", "2026년 11월 7일", "체크인", "2026년 11월 9일 토요일, 16:00", "판매가 KRW 90,000", "판매가 KRW 10,000"].join("\n");
  const rows = extractLabeledPaste(text, {
    platformId: "p-ag",
    version: 1,
    labels: { checkIn: "체크인", salesTotal: "판매가" },
    rules: { checkIn: { label: "체크인", occurrence: 0 }, salesTotal: { label: "판매가", occurrence: 0 } },
  });
  const warn = rows[0]?.warnings.join("\n") ?? "";
  assert.equal(warn.includes("번째 값이 없어요"), false);
  assert.equal(warn.includes("다른 위치 값이 달라"), false);
  assert.equal(warn.includes("하나로 정할 수 없어요"), false);
  assert.equal(rows[0]?.checkIn, "2026-11-07");
  assert.equal(rows[0]?.salesTotal, 90000);
});

test("붙여넣기 인식 코드는 네트워크 AI를 부르지 않는다", () => {
  const src = readFileSync(fileURLToPath(new URL("./pasteTemplate.ts", import.meta.url)), "utf8");
  assert.equal(/\bfetch\s*\(|openai|anthropic|generative|llm/i.test(src), false);
  assert.equal(/\beval\s*\(|new Function\s*\(/.test(src), false);
});

test("아고다 화면 전체 복사: 요약·상세가 같은 날을 달리 적어도 읽고, 경고 없이 바로 쓸 수 있다", () => {
  const { det, row, rows } = previewOf(agodaFullText(AGODA_FULL_A));
  assert.equal(det.profileId, "agoda");
  assert.equal(rows.length, 1);
  assert.equal(row.reservationId, "1000000001");
  assert.equal(row.guestName, "Mina Park");
  assert.equal(row.guestPhone, "");
  assert.equal(row.typeId, "std");
  assert.equal(row.checkIn, "2026-11-07");
  assert.equal(row.checkInTime, "16:00");
  assert.equal(row.nights, 2);
  assert.equal(row.amount, 210000);
  assert.equal(row.guests, 2);
  assert.equal(row.rowStatus, "ok");
  assert.deepEqual(row.warnings ?? [], []);
});

test("아고다 화면 전체 복사: 칸 이름·구역 제목·값을 나눠 읽는다", () => {
  const lines = readPasteLines(agodaFullText(AGODA_FULL_A));
  const labelOf = (text: string, nth = 0) => lines.filter((l) => l.text === text)[nth]?.label;
  for (const section of ["결제 및 요금", "SmartFlex", "투숙객 세부 사항 및 날짜 정보", "예약 로그", "요청 사항 및 참고 사항"]) {
    assert.equal(labelOf(section), section);
  }
  assert.equal(labelOf("대한민국"), "투숙객 거주 국가");
  assert.equal(labelOf("연락처 정보"), "연락처 정보");
  assert.equal(labelOf("2026년 11월 7일 토요일, 00:52"), "예약 생성일(방콕, UTC+7)");
  assert.equal(labelOf("1000000001", 0), "예약 번호");
  assert.equal(labelOf("1000000001", 1), "예약 번호");
  assert.equal(labelOf("Mina Park", 0), "투숙객");
  assert.equal(labelOf("Mina Park", 1), "투숙객 이름");
  assert.equal(lines.some((l) => l.text === "예약 번호:"), false);
});

test("아고다 화면 전체 복사: 고른 값으로 양식을 저장하면 다음 예약은 새 값으로 읽는다", () => {
  const first = agodaFullText(AGODA_FULL_A);
  const lines = readPasteLines(first);
  const at = (text: string, label?: string) => lines.findIndex((l) => l.text === text && (!label || l.label === label));
  const picks = {
    guestName: at("Mina Park", "투숙객 이름"),
    typeRaw: at(AGODA_FULL_A.room),
    checkIn: at("2026년 11월 7일 토요일, 16:00"),
    nights: at("2", "숙박 기간"),
    salesTotal: at("KRW 210,000"),
    reservationId: at("1000000001"),
  } as const;
  const labels: Record<string, string> = {};
  const rules: Record<string, { label: string; occurrence: number }> = {};
  for (const [field, index] of Object.entries(picks)) {
    assert.notEqual(index, -1, field);
    const rule = ruleForPickedLine(lines, index, field as keyof typeof picks);
    assert.ok(rule, field);
    labels[field] = rule!.label;
    rules[field] = rule!;
  }
  assert.deepEqual(rules.guestName, { label: "투숙객 이름", occurrence: 0 });
  assert.deepEqual(rules.checkIn, { label: "체크인", occurrence: 0 });
  assert.equal(readFieldValue(first, "guestName", rules.guestName!.label, rules.guestName!.occurrence), "Mina Park");
  assert.equal(readFieldValue(first, "checkIn", rules.checkIn!.label, rules.checkIn!.occurrence), "2026-11-07 16:00");
  assert.equal(readFieldValue(first, "nights", rules.nights!.label, rules.nights!.occurrence), "2");

  const saved = validatePasteTemplate({ platformId: "p-ag", profileId: "agoda", labels, rules });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const stored = serializePasteTemplateStore([saved.template]);
  for (const secret of ["Mina Park", "1000000001", "210,000", "1000000999"]) assert.equal(stored.includes(secret), false, secret);

  const next = previewOf(agodaFullText(AGODA_FULL_B), { templates: [saved.template] });
  assert.equal(next.rows.length, 1);
  assert.equal(next.row.reservationId, "2000000002");
  assert.equal(next.row.guestName, "Ari Stone");
  assert.equal(next.row.typeId, "dlx");
  assert.equal(next.row.checkIn, "2026-12-01");
  assert.equal(next.row.nights, 3);
  assert.equal(next.row.amount, 330000);
  assert.equal(next.row.guests, 1);
  assert.equal(next.row.rowStatus, "ok");
  assert.deepEqual(next.row.warnings ?? [], []);
});

/** 운영 호텔에 남아 있던, 영어 화면을 크롬 번역으로 보고 저장한 아고다 양식(칸 이름만). */
const TRANSLATED_SAVED = validatePasteTemplate({
  platformId: "p3",
  profileId: "agoda",
  labels: {
    adults: "성인",
    nights: "체류 기간",
    checkIn: "체크인",
    typeRaw: "객실 유형 및 혜택",
    checkOut: "점검",
    guestName: "손님",
    salesTotal: "참조 판매 포함",
    checkInTime: "체크인",
    checkOutTime: "점검",
    reservationId: "투숙객 정보 및 날짜",
  },
  rules: {
    adults: { label: "성인", occurrence: 0 },
    nights: { label: "체류 기간", occurrence: 0 },
    checkIn: { label: "체크인", occurrence: 0 },
    typeRaw: { label: "객실 유형 및 혜택", occurrence: 0 },
    checkOut: { label: "점검", occurrence: 0 },
    guestName: { label: "손님", occurrence: 0 },
    salesTotal: { label: "참조 판매 포함", occurrence: 0 },
    checkInTime: { label: "체크인", occurrence: 1 },
    checkOutTime: { label: "점검", occurrence: 1 },
    reservationId: { label: "투숙객 정보 및 날짜", occurrence: 0 },
  },
});

const LANGS: AgodaScreenLanguage[] = ["ko", "en", "ko-translated"];
const langSettings = normalizeSettings({
  platforms: [{ id: "p3", name: "아고다", abbr: "아" }],
  types: [
    { id: "std", name: "스탠다드" },
    { id: "dlx", name: "디럭스" },
  ],
  typeAliases: [
    { id: "ta1", platformId: "p3", platformTypeName: "1 X Standard Styler (1000000999)", typeId: "std" },
    { id: "ta2", platformId: "p3", platformTypeName: "1 X Deluxe Double (2000000999)", typeId: "dlx" },
  ],
  stayTimes: { checkIn: "16:00", checkOut: "12:00" },
});

function agodaRow(text: string, templates: Parameters<typeof parsePasteTable>[1] = {}) {
  const table = parsePasteTable(text, templates);
  assert.ok(table, "표를 못 읽음");
  const det = detectProfile(table!.headers, text);
  assert.equal(det.profileId, "agoda");
  return buildPreviewRows(table!, profileById("agoda")!, langSettings, [], "p3")[0]!;
}

function assertReads(row: ReturnType<typeof agodaRow>, want: typeof AGODA_FULL_A, label: string) {
  const nights = Number(want.nights);
  const amount = Number(want.money.replace(/\D/g, ""));
  assert.equal(row.reservationId, want.id, `${label} 예약번호`);
  assert.equal(row.guestName, want.name, `${label} 이름`);
  assert.ok(row.typeId, `${label} 타입`);
  assert.equal(row.checkIn, want === AGODA_FULL_A ? "2026-11-07" : "2026-12-01", `${label} 입실`);
  assert.equal(row.checkInTime, "16:00", `${label} 입실 시각`);
  assert.equal(row.checkOutTime, "12:00", `${label} 퇴실 시각`);
  assert.equal(row.nights, nights, `${label} 박수`);
  assert.equal(row.amount, amount, `${label} 판매금`);
  assert.equal(row.guests, Number(want.adults), `${label} 성인`);
  assert.equal(row.guestPhone, "", `${label} 전화`);
  assert.equal(row.rowStatus, "ok", `${label} 상태`);
  assert.deepEqual(row.warnings ?? [], [], `${label} 경고`);
}

test("아고다 한국어·영어·크롬 번역 화면을 양식 없이 같은 값으로 읽는다", () => {
  for (const lang of LANGS) {
    assertReads(agodaRow(agodaScreenText(AGODA_FULL_A, lang)), AGODA_FULL_A, lang);
    assertReads(agodaRow(agodaScreenText(AGODA_FULL_B, lang)), AGODA_FULL_B, `${lang} B`);
  }
});

test("번역 화면으로 저장된 운영 양식이 있어도 세 화면 모두 읽는다", () => {
  assert.equal(TRANSLATED_SAVED.ok, true);
  if (!TRANSLATED_SAVED.ok) return;
  for (const lang of LANGS) {
    assertReads(agodaRow(agodaScreenText(AGODA_FULL_A, lang), { templates: [TRANSLATED_SAVED.template] }), AGODA_FULL_A, lang);
  }
});

const PICKS: { field: Parameters<typeof ruleForPickedLine>[2]; value: (s: typeof AGODA_FULL_A, lang: AgodaScreenLanguage) => RegExp }[] = [
  { field: "reservationId", value: (s) => new RegExp(`^${s.id}$`) },
  { field: "guestName", value: (s) => new RegExp(`^${s.name}$`) },
  { field: "typeRaw", value: () => /^1 X /u },
  { field: "checkIn", value: (_s, lang) => (lang === "en" ? /^Saturday, November 7, 2026/u : /^2026년 11월 7일 토요일/u) },
  { field: "nights", value: (s) => new RegExp(`^${s.nights}$`) },
  { field: "salesTotal", value: (s) => new RegExp(`^${s.money}$`) },
];

test("아고다 세 화면 모두: 원하는 값이 목록에 보이고, 누르면 그 값이 칸에 읽힌다", () => {
  for (const lang of LANGS) {
    const text = agodaScreenText(AGODA_FULL_A, lang);
    const lines = readPasteLines(text);
    for (const { field, value } of PICKS) {
      const at = lines.findIndex((l, i) => value(AGODA_FULL_A, lang).test(l.text) && (field !== "nights" || /숙박|체류|length/iu.test(lines[i]!.label)));
      assert.notEqual(at, -1, `${lang} ${field} 줄 없음`);
      assert.equal(pickableForField(lines[at]!, field), true, `${lang} ${field} 목록에 안 보임`);
      const rule = ruleForPickedLine(lines, at, field);
      assert.ok(rule, `${lang} ${field} 칸 이름 없음`);
      assert.notEqual(readFieldValue(text, field, rule!.label, rule!.occurrence), "", `${lang} ${field} 읽힘 없음`);
    }
  }
});

test("한 화면 언어로 저장한 양식으로 다른 언어 화면의 다음 예약도 읽는다", () => {
  for (const from of LANGS) {
    const text = agodaScreenText(AGODA_FULL_A, from);
    const lines = readPasteLines(text);
    const labels: Record<string, string> = {};
    const rules: Record<string, { label: string; occurrence: number }> = {};
    for (const { field, value } of PICKS) {
      const at = lines.findIndex((l, i) => value(AGODA_FULL_A, from).test(l.text) && (field !== "nights" || /숙박|체류|length/iu.test(lines[i]!.label)));
      const rule = ruleForPickedLine(lines, at, field)!;
      labels[field] = rule.label;
      rules[field] = rule;
    }
    const saved = validatePasteTemplate({ platformId: "p3", profileId: "agoda", labels, rules });
    assert.equal(saved.ok, true, from);
    if (!saved.ok) continue;
    assert.equal(serializePasteTemplateStore([saved.template]).includes(AGODA_FULL_A.id), false);
    for (const to of LANGS) {
      assertReads(agodaRow(agodaScreenText(AGODA_FULL_B, to), { templates: [saved.template] }), AGODA_FULL_B, `${from}→${to}`);
    }
  }
});

test("영어·번역 날짜, 오전/오후 시각, 영어 인원, ₩ 금액을 읽는다", () => {
  assert.equal(choiceFitsField("checkIn", "Saturday, November 7, 2026 4:00 PM"), true);
  assert.equal(choiceFitsField("checkIn", "Nov 7, 2026"), true);
  assert.equal(choiceFitsField("checkIn", "7 November 2026"), true);
  assert.equal(choiceFitsField("checkIn", "2026년 11월 7일 토요일 오후 4:00"), true);
  assert.equal(readFieldValue("Check-in\nSat, Nov 7, 2026 at 4:00 PM", "checkIn", "Check-in"), "2026-11-07 16:00");
  assert.equal(readFieldValue("체크인\n2026년 11월 7일 토요일 오후 12:00", "checkIn", "체크인"), "2026-11-07 12:00");
  assert.equal(readFieldValue("체크인\n2026년 11월 7일 토요일 오전 12:30", "checkIn", "체크인"), "2026-11-07 00:30");
  assert.equal(readFieldValue("Adults\n2 Adults", "adults", "Adults"), "2");
  assert.equal(readFieldValue("판매\n₩210,000", "salesTotal", "판매"), "KRW 210000");
  assert.equal(readFieldValue("판매\nKRW 210,000.00", "salesTotal", "판매"), "KRW 210000");
  assert.equal(choiceFitsField("checkIn", "Booking date 13:00"), false);
});

import { AIRBNB_KO, BOOKING_EN, DOMESTIC_KO, UNKNOWN_LABELS_A, UNKNOWN_LABELS_B } from "./testFixtures/otherPlatforms.ts";

function sharedRow(text: string, saved?: Parameters<typeof parseSharedLabeledTable>[1]) {
  const table = parseSharedLabeledTable(text, saved);
  assert.ok(table, "공용 판독 실패");
  return Object.fromEntries(table!.headers.map((h, i) => [h, table!.rows[0]![i]])) as Record<string, string>;
}

test("공용 칸 이름: 에어비앤비·Booking.com·국내 사이트 화면을 플랫폼 양식 없이 읽는다", () => {
  const air = sharedRow(AIRBNB_KO);
  assert.equal(air["예약번호"], "HMABCD1234");
  assert.equal(air["투숙객"], "Mina Park");
  assert.equal(air["객실타입"], "오션뷰 더블");
  assert.equal(air["체크인"], "2026-11-07");
  assert.equal(air["입실 시각"], "16:00");
  assert.equal(air["퇴실 시각"], "11:00");
  assert.equal(air["박수"], "2");
  assert.equal(air["판매금액"], "", "게스트 결제 금액·호스트 수령액은 판매금이 아니다");
  assert.equal(air["안내"], "");

  const bk = sharedRow(BOOKING_EN);
  assert.equal(bk["예약번호"], "4000000004");
  assert.equal(bk["투숙객"], "Ari Stone");
  assert.equal(bk["객실타입"], "Deluxe Double Room");
  assert.equal(bk["체크인"], "2026-12-01");
  assert.equal(bk["박수"], "3");
  assert.equal(bk["판매금액"], "330000", "Total price만 판매금, Commission은 아니다");

  const kr = sharedRow(DOMESTIC_KO);
  assert.equal(kr["예약번호"], "2026110700001");
  assert.equal(kr["투숙객"], "Ara Min Lee");
  assert.equal(kr["연락처"], "050-1234-5678");
  assert.equal(kr["객실타입"], "스탠다드 더블");
  assert.equal(kr["입실 시각"], "15:00");
  assert.equal(kr["판매금액"], "180000");
});

test("공용 판독은 표·짧은 글·칸 이름 없는 글을 예약으로 만들지 않는다", () => {
  assert.equal(parseSharedLabeledTable("예약번호\t이름\t체크인\t체크아웃\n1\t2\t3\t4"), null);
  assert.equal(parseSharedLabeledTable("체크인\n2026-11-07"), null);
  assert.equal(parseSharedLabeledTable("안녕하세요\n내일 갈게요"), null);
});

test("처음 보는 칸 이름은 한 번 고르면 플랫폼 상관없이 다음 예약에서 읽는다", () => {
  const before = sharedRow(UNKNOWN_LABELS_B);
  assert.equal(before["예약번호"], "");
  assert.equal(before["투숙객"], "");

  const lines = readPasteLines(UNKNOWN_LABELS_A);
  let templates = [] as Parameters<typeof learnPasteLabel>[0];
  for (const [field, text] of [["reservationId", "ZX1000000001"], ["guestName", "Mina Park"]] as const) {
    const at = lines.findIndex((l) => l.text === text);
    assert.equal(pickableForField(lines[at]!, field), true);
    const rule = ruleForPickedLine(lines, at, field)!;
    const learned = learnPasteLabel(templates, "p-x", field, rule);
    assert.equal(learned.ok, true);
    if (learned.ok) templates = learned.templates;
  }
  assert.deepEqual(templates[0]?.labels, { reservationId: "주문 코드", guestName: "방문자" });
  const stored = serializePasteTemplateStore(templates);
  assert.equal(stored.includes("ZX1000000001") || stored.includes("Mina Park"), false);

  const after = sharedRow(UNKNOWN_LABELS_B, templates);
  assert.equal(after["예약번호"], "ZX2000000002");
  assert.equal(after["투숙객"], "Ari Stone");
  assert.equal(after["체크인"], "2026-12-01");
  assert.equal(after["판매금액"], "330000");
  assert.equal(platformByLearnedLabels(UNKNOWN_LABELS_B, templates), "p-x");

  const again = learnPasteLabel(templates, "p-x", "guestName", { label: "방문자", occurrence: 0 });
  assert.equal(again.ok && again.changed, false, "같은 칸 이름은 다시 저장하지 않는다");
});

test("받은 돈·구역 제목·상태 글자는 공용 칸 이름으로 배우지 않는다", () => {
  assert.equal(learnPasteLabel([], "p-x", "salesTotal", { label: "게스트 결제 금액", occurrence: 0 }).ok, false);
  assert.equal(TRANSLATED_SAVED.ok, true);
  if (!TRANSLATED_SAVED.ok) return;
  const learned = learnedLabelEntries([TRANSLATED_SAVED.template]);
  assert.equal(learned.some((e) => e.label === "투숙객 정보 및 날짜"), false);
  assert.equal(platformByLearnedLabels(DOMESTIC_KO, [TRANSLATED_SAVED.template]), null, "아고다 공용 표기만 있는 양식은 플랫폼을 정하지 않는다");
  const kr = sharedRow(DOMESTIC_KO, [TRANSLATED_SAVED.template]);
  assert.equal(kr["예약번호"], "2026110700001");
});

test("글에 이름이 나오는 호텔 플랫폼이 하나면 그 플랫폼", () => {
  const plats = [
    { id: "p1", name: "야놀자" },
    { id: "p3", name: "아고다" },
    { id: "p-air", name: "에어비앤비" },
  ];
  assert.equal(mentionedPlatformId("Airbnb 예약 확정", plats), "p-air");
  assert.equal(mentionedPlatformId("아고다 예약", plats), "p3");
  assert.equal(mentionedPlatformId("야놀자 아고다", plats), null);
  assert.equal(mentionedPlatformId("예약 번호 1", plats), null);
});

test("배운 칸 이름 지우기: 그 칸만 지우고, 남은 칸이 없으면 플랫폼 양식도 지운다", () => {
  assert.equal(TRANSLATED_SAVED.ok, true);
  if (!TRANSLATED_SAVED.ok) return;
  const once = forgetPasteLabel([TRANSLATED_SAVED.template], "p3", "reservationId");
  assert.equal(once[0]?.labels.reservationId, undefined);
  assert.equal(once[0]?.rules?.reservationId, undefined);
  assert.equal(once[0]?.labels.guestName, "손님");
  assert.equal(validatePasteTemplate(once[0]).ok, true);
  const single = learnPasteLabel([], "p-x", "guestName", { label: "방문자", occurrence: 0 });
  assert.equal(single.ok, true);
  if (single.ok) assert.deepEqual(forgetPasteLabel(single.templates, "p-x", "guestName"), []);
});
