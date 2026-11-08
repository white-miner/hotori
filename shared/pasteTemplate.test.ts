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
  assert.match(row.warnings?.join("\n") ?? "", /결제로 넣지 않아요/);
  assert.match(row.warnings?.join("\n") ?? "", /거주 국가 대한민국/);
  assert.doesNotMatch(row.warnings?.join("\n") ?? "", /박마다 나누지/);
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

test("붙여넣기 인식 코드는 네트워크 AI를 부르지 않는다", () => {
  const src = readFileSync(fileURLToPath(new URL("./pasteTemplate.ts", import.meta.url)), "utf8");
  assert.equal(/\bfetch\s*\(|openai|anthropic|generative|llm/i.test(src), false);
  assert.equal(/\beval\s*\(|new Function\s*\(/.test(src), false);
});
