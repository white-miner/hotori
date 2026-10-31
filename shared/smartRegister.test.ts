import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isActive, normalizeSettings, stockTable, type Booking } from "./ledger.ts";
import {
  HYPOTHESIS_FIXTURES,
  PLATFORM_PROFILES,
  type PreviewRow,
  YANOLJA_DRAG_COPY_COLLAPSED_LINE_FIXTURE,
  YANOLJA_DRAG_COPY_HTML_FIXTURE,
  YANOLJA_DRAG_COPY_MULTISPACE_FIXTURE,
  YANOLJA_DRAG_COPY_SINGLE_SPACE_FIXTURE,
  YANOLJA_DRAG_COPY_VERTICAL_CELLS_FIXTURE,
  YANOLJA_CANCEL_MISS_CARD_FIXTURE_PATH,
  YANOLJA_CANCEL_CHROME_COMPLETE_CARD_FIXTURE_PATH,
  YANOLJA_NESTED_AGODA_CARD_FIXTURE_PATH,
  YANOLJA_NESTED_CTRIP_CARD_FIXTURE_PATH,
  YANOLJA_NESTED_GMARKET_CARD_FIXTURE_PATH,
  YANOLJA_NESTED_TIDESQUARE_CARD_FIXTURE_PATH,
  YANOLJA_TRIPLE_CHROME_CARD_FIXTURE_PATH,
  YANOLJA_UNIFIED_CARD_PASTE_FIXTURE_PATH,
  buildPreviewRows,
  cancelDraftFromMatch,
  detectProfile,
  findActiveBookingByReservationId,
  htmlTableToPlain,
  smartClipboardText,
  isAlreadyCancelledReservation,
  isCancelGuardBlocked,
  isCancelStatus,
  isDuplicateReservation,
  isKnownNestedChannelLabel,
  isOccupancyOrPlanChrome,
  looksLikeGuestNameLine,
  looksLikeYanoljaCardPaste,
  looksLikeYanoljaCardPhoneLine,
  lookupTypeAlias,
  mapColumns,
  matchPlatformByLabel,
  matchPlatformId,
  matchTypeId,
  matchTypeIdNested,
  importedTypeSuggestion,
  previewTypeMismatch,
  recomputeRowStatus,
  smartImportInfo,
  normalizeRow,
  normTypeName,
  typeRawBilingualTail,
  typeRawForAliasMatch,
  parseAmount,
  parseLooseDate,
  parseNightsCell,
  parsePasteTable,
  parseYanoljaCardPaste,
  pathACancelDraftFromPreview,
  pathADraftFromPreview,
  enteredNightRates,
  nightRatesDiff,
  suggestedNightAmounts,
  previewNightDates,
  profileById,
  removeTypeAlias,
  isExistingReservationRow,
  isFixBlockingRow,
  isFixLabelRow,
  previewRowStatusLabel,
  reservationIdFromMemo,
  reservationMemo,
  upsertTypeAlias,
} from "./smartRegister.ts";

const settings = normalizeSettings({
  platforms: [
    { id: "p-ya", name: "야놀자", abbr: "야" },
    { id: "p-ye", name: "여기어때", abbr: "여" },
    { id: "p-ag", name: "아고다", abbr: "아" },
    { id: "p-walk", name: "현장·전화", abbr: "현", onsite: true },
  ],
  types: [
    { id: "std", name: "스탠다드" },
    { id: "dlx", name: "디럭스" },
    { id: "ondol", name: "온돌" },
    { id: "twin", name: "트윈" },
  ],
});

test("parsePasteTable: TSV header + body", () => {
  const t = parsePasteTable(HYPOTHESIS_FIXTURES.yanolja);
  assert.ok(t);
  assert.equal(t!.delimiter, "tab");
  assert.equal(t!.headers[0], "야놀자예약번호");
  assert.equal(t!.rows.length, 2);
  assert.equal(t!.rows[0]![0], "YN-1001");
});

test("parsePasteTable: YANOLJA_DRAG_COPY_MULTISPACE_FIXTURE (chrome + 2+ spaces)", () => {
  const t = parsePasteTable(YANOLJA_DRAG_COPY_MULTISPACE_FIXTURE);
  assert.ok(t, "must accept multi-space 통합내역 drag-copy");
  assert.equal(t!.delimiter, "space");
  assert.equal(t!.headers[0], "야놀자예약번호");
  assert.equal(t!.headers.includes("객실상품"), true);
  assert.equal(t!.rows.length, 2);
  assert.equal(t!.rows[0]![0], "YN-1001");
  assert.equal(t!.rows[0]![1], "김테스트");
  assert.equal(t!.rows[1]![0], "YN-1002");
});

test("htmlTableToPlain + parsePasteTable: YANOLJA_DRAG_COPY_HTML_FIXTURE", () => {
  const plain = htmlTableToPlain(YANOLJA_DRAG_COPY_HTML_FIXTURE);
  assert.ok(plain);
  assert.match(plain!, /\t/);
  const t = parsePasteTable(YANOLJA_DRAG_COPY_HTML_FIXTURE);
  assert.ok(t);
  assert.equal(t!.delimiter, "tab");
  assert.equal(t!.headers[0], "야놀자예약번호");
  assert.equal(t!.rows.length, 2);
  assert.equal(t!.rows[0]![3], "스탠다드");
});

test("detectProfile: multi-space yanolja drag-copy confident", () => {
  const t = parsePasteTable(YANOLJA_DRAG_COPY_MULTISPACE_FIXTURE)!;
  const d = detectProfile(t.headers, YANOLJA_DRAG_COPY_MULTISPACE_FIXTURE);
  assert.equal(d.confident, true);
  assert.equal(d.profileId, "yanolja");
});

test("yanolja multi-space fixture → preview Path A fields", () => {
  const profile = profileById("yanolja")!;
  const t = parsePasteTable(YANOLJA_DRAG_COPY_MULTISPACE_FIXTURE)!;
  const preview = buildPreviewRows(t, profile, settings, [], "p-ya");
  assert.equal(preview.length, 2);
  assert.equal(preview[0]!.guestName, "김테스트");
  assert.equal(preview[0]!.reservationId, "YN-1001");
  assert.equal(preview[0]!.amount, 120000);
  assert.equal(preview[0]!.rowStatus, "ok");
  assert.equal(preview[1]!.rowStatus, "cancel");
  assert.equal(preview[1]!.matchBookingId, null);
  assert.equal(preview[1]!.skip, false);
});

/** Hypothesis shapes that returned null under #143 (2+ space / HTML only). */
test("parsePasteTable: YANOLJA_DRAG_COPY_SINGLE_SPACE_FIXTURE (#143 miss → harden)", () => {
  const t = parsePasteTable(YANOLJA_DRAG_COPY_SINGLE_SPACE_FIXTURE);
  assert.ok(t, "must accept single-space 통합내역 drag-copy");
  assert.equal(t!.delimiter, "space");
  assert.equal(t!.headers[0], "야놀자예약번호");
  assert.equal(t!.rows.length, 2);
  assert.equal(t!.rows[0]![0], "YN-1001");
  assert.equal(t!.rows[0]![1], "김테스트");
  assert.equal(t!.rows[1]![0], "YN-1002");
});

test("parsePasteTable: YANOLJA_DRAG_COPY_VERTICAL_CELLS_FIXTURE (#143 miss → harden)", () => {
  const t = parsePasteTable(YANOLJA_DRAG_COPY_VERTICAL_CELLS_FIXTURE);
  assert.ok(t, "must reassemble one-cell-per-line paste");
  assert.equal(t!.delimiter, "tab");
  assert.equal(t!.headers[0], "야놀자예약번호");
  assert.equal(t!.headers.length, 9);
  assert.equal(t!.rows.length, 2);
  assert.equal(t!.rows[0]![0], "YN-1001");
  assert.equal(t!.rows[0]![3], "스탠다드");
  assert.equal(t!.rows[1]![0], "YN-1002");
});

test("parsePasteTable: YANOLJA_DRAG_COPY_COLLAPSED_LINE_FIXTURE (#143 miss → harden)", () => {
  const t = parsePasteTable(YANOLJA_DRAG_COPY_COLLAPSED_LINE_FIXTURE);
  assert.ok(t, "must reassemble collapsed single-line paste");
  assert.equal(t!.headers[0], "야놀자예약번호");
  assert.equal(t!.rows.length, 2);
  assert.equal(t!.rows[0]![0], "YN-1001");
  assert.equal(t!.rows[1]![8], "취소");
});

test("yanolja single-space / vertical / collapsed → preview Path A", () => {
  const profile = profileById("yanolja")!;
  for (const raw of [
    YANOLJA_DRAG_COPY_SINGLE_SPACE_FIXTURE,
    YANOLJA_DRAG_COPY_VERTICAL_CELLS_FIXTURE,
    YANOLJA_DRAG_COPY_COLLAPSED_LINE_FIXTURE,
  ]) {
    const t = parsePasteTable(raw)!;
    const d = detectProfile(t.headers, raw);
    assert.equal(d.confident, true);
    assert.equal(d.profileId, "yanolja");
    const preview = buildPreviewRows(t, profile, settings, [], "p-ya");
    assert.equal(preview.length, 2);
    assert.equal(preview[0]!.guestName, "김테스트");
    assert.equal(preview[0]!.reservationId, "YN-1001");
    assert.equal(preview[0]!.amount, 120000);
    assert.equal(preview[0]!.rowStatus, "ok");
    assert.equal(preview[1]!.rowStatus, "cancel");
    assert.equal(preview[1]!.matchBookingId, null);
  }
});

test("parseYanoljaCardPaste: anonymized unified card SoT fixture", () => {
  const raw = readFileSync(fileURLToPath(YANOLJA_UNIFIED_CARD_PASTE_FIXTURE_PATH), "utf8");
  assert.equal(looksLikeYanoljaCardPaste(raw), true);
  const card = parseYanoljaCardPaste(raw);
  assert.ok(card);
  assert.equal(card!.rows.length, 12);
  assert.equal(card!.headers[0], "야놀자예약번호");
  assert.equal(card!.rows[0]![0], "2610151829300184");
  assert.equal(card!.rows[0]![1], "김테스트");
  assert.equal(card!.rows[0]![2], "0503-0000-0001");
  assert.match(card!.rows[0]![3]!, /Family Room/);
  assert.match(card!.rows[0]![4]!, /^2026\.10\.26/);
  assert.equal(card!.rows[0]![6], "2");
  assert.equal(card!.rows[0]![7], "200000");
  assert.equal(card!.rows[0]![8], "예약완료");
  // 안심번호 만료 → empty phone; 예약취소
  assert.equal(card!.rows[1]![0], "2610152133600141");
  assert.equal(card!.rows[1]![2], "");
  assert.equal(card!.rows[1]![8], "예약취소");
  assert.match(card!.rows[1]![3]!, /온돌/);
  // 도보 · 연박 4박
  assert.equal(card!.rows[5]![6], "4");
  assert.equal(card!.rows[5]![7], "250000");

  const viaPaste = parsePasteTable(raw);
  assert.ok(viaPaste);
  assert.equal(viaPaste!.rows.length, 12);
  const d = detectProfile(viaPaste!.headers, raw);
  assert.equal(d.confident, true);
  assert.equal(d.profileId, "yanolja");

  const profile = profileById("yanolja")!;
  const preview = buildPreviewRows(viaPaste!, profile, settings, [], "p-ya");
  assert.equal(preview.length, 12);
  assert.equal(preview[0]!.guestName, "김테스트");
  assert.equal(preview[0]!.checkIn, "2026-10-26");
  assert.equal(preview[0]!.nights, 2);
  assert.equal(preview[0]!.amount, 200000);
  assert.equal(preview[0]!.reservationId, "2610151829300184");
  assert.equal(preview[1]!.pasteCancel, true);
  assert.equal(preview[1]!.rowStatus, "cancel");
  assert.equal(preview[1]!.matchBookingId, null);
  assert.equal(preview[1]!.guestPhone, "");
  assert.equal(preview[2]!.typeId, "ondol");
  assert.equal(preview[4]!.typeId, "std"); // Standardㅣ스탠다드…
  assert.equal(preview[5]!.nights, 4);
  assert.equal(preview[7]!.typeId, "dlx"); // Deluxe Twinㅣ디럭스…
});

test("parseYanoljaCardPaste: live owner sample if present", () => {
  const live = "/cursor/stores/bc-fc855f4a-4cd7-41f6-8016-26e7dc29c864/internal/yanolja-unified-drag-paste-sample.txt";
  if (!existsSync(live)) return;
  const raw = readFileSync(live, "utf8");
  assert.equal(looksLikeYanoljaCardPaste(raw), true);
  const t = parsePasteTable(raw);
  assert.ok(t, "must recognize live 통합내역 drag-copy");
  assert.equal(t!.rows.length, 12);
  assert.equal(t!.rows[0]![0], "2610151829300184");
  assert.equal(t!.rows[1]![2], ""); // 안심번호 만료
  assert.equal(t!.rows[1]![8], "예약취소");
  assert.equal(detectProfile(t!.headers, raw).profileId, "yanolja");
});

test("yanolja cancel-miss: 예약취소+고객취소 + 입실완료 chrome → 예약취소", () => {
  const profile = profileById("yanolja")!;
  const raw = readFileSync(fileURLToPath(YANOLJA_CANCEL_MISS_CARD_FIXTURE_PATH), "utf8");
  const t = parsePasteTable(raw);
  assert.ok(t);
  assert.equal(t!.rows.length, 1);
  assert.equal(t!.rows[0]![8], "예약취소");
  assert.equal(isCancelStatus(t!.rows[0]![8]!, profile), true);

  const preview = buildPreviewRows(t!, profile, settings, [], "p-ya");
  assert.equal(preview[0]!.pasteCancel, true);
  assert.equal(preview[0]!.rowStatus, "cancel");
  assert.equal(preview[0]!.matchBookingId, null);
  assert.equal(preview[0]!.statusRaw, "예약취소");

  // Exact owner miss sample (PII) when present on disk
  const ownerMiss =
    "/cursor/stores/bc-fc855f4a-4cd7-41f6-8016-26e7dc29c864/internal/yanolja-cancel-miss-sample.txt";
  if (existsSync(ownerMiss)) {
    const live = parsePasteTable(readFileSync(ownerMiss, "utf8"))!;
    assert.equal(live.rows[0]![8], "예약취소");
    const livePreview = buildPreviewRows(live, profile, settings, [], "p-ya");
    assert.equal(livePreview[0]!.rowStatus, "cancel");
    assert.equal(livePreview[0]!.pasteCancel, true);
  }
});

test("yanolja card status: cancel wins over 예약완료 / 고객취소-only / chrome", () => {
  const profile = profileById("yanolja")!;
  const base = (statusBlock: string) =>
    [
      "2610152133600141",
      "이샘플",
      "안심번호 만료",
      "차량",
      "온돌ㅣVIP",
      "(객실 타입 ID: 14810)",
      "숙박",
      "/ 1박",
      "2026.10.26(월) 17:00",
      "2026.10.27(화) 12:00",
      "2026.10.15(목) 21:33:45",
      "미리예약",
      statusBlock,
      "판매가 90,000원",
      "입금예정가 81,000원",
      "입실완료",
      "입실 호수",
      "실제 입실 인원",
    ].join("\n");

  const cases: { name: string; block: string }[] = [
    { name: "고객취소 only", block: "고객취소\n2026.10.16(금)\n10:01:05" },
    { name: "고객취소 before 예약취소", block: "고객취소\n예약취소" },
    { name: "예약완료 then 예약취소", block: "예약완료\n예약취소\n고객취소" },
    { name: "same line", block: "예약취소 고객취소" },
    { name: "chrome before sale still cancel", block: "예약취소\n고객취소\n입실완료\n입실 호수" },
    // Owner: drag-copy checkbox / 특·직접관리 UI can inject 「예약완료」 after real cancel
    {
      name: "cancel then chrome 예약완료 + 특",
      block: "특\n직접관리\n예약취소\n고객취소\n예약완료",
    },
  ];

  for (const c of cases) {
    const t = parseYanoljaCardPaste(base(c.block));
    assert.ok(t, c.name);
    assert.equal(t!.rows[0]![8], "예약취소", c.name);
    const preview = buildPreviewRows(t!, profile, settings, [], "p-ya");
    assert.equal(preview[0]!.rowStatus, "cancel", c.name);
    assert.equal(preview[0]!.pasteCancel, true, c.name);
  }

  // Active stay: 예약완료 + trailing 입실완료 chrome must stay non-cancel
  const active = parseYanoljaCardPaste(base("예약완료"));
  assert.equal(active!.rows[0]![8], "예약완료");
  assert.equal(isCancelStatus("예약완료", profile), false);
  assert.equal(isCancelStatus("입실완료", profile), false);
  assert.equal(isCancelStatus("고객취소", profile), true);
});

test("yanolja cancel+chrome 예약완료 (특/직접관리): stays cancel", () => {
  const profile = profileById("yanolja")!;
  const raw = readFileSync(fileURLToPath(YANOLJA_CANCEL_CHROME_COMPLETE_CARD_FIXTURE_PATH), "utf8");
  const t = parsePasteTable(raw);
  assert.ok(t);
  assert.equal(t!.rows.length, 1);
  assert.equal(t!.rows[0]![8], "예약취소");
  assert.equal(isCancelStatus(t!.rows[0]![8]!, profile), true);

  const preview = buildPreviewRows(t!, profile, settings, [], "p-ya");
  assert.equal(preview[0]!.pasteCancel, true);
  assert.equal(preview[0]!.rowStatus, "cancel");
  assert.equal(preview[0]!.statusRaw, "예약취소");
});

test("detectProfile: yanolja hypothesis fixture confident", () => {
  const t = parsePasteTable(HYPOTHESIS_FIXTURES.yanolja)!;
  const d = detectProfile(t.headers, HYPOTHESIS_FIXTURES.yanolja);
  assert.equal(d.confident, true);
  assert.equal(d.profileId, "yanolja");
});

test("detectProfile: yeogi hypothesis fixture confident", () => {
  const t = parsePasteTable(HYPOTHESIS_FIXTURES.yeogi)!;
  const d = detectProfile(t.headers, HYPOTHESIS_FIXTURES.yeogi);
  assert.equal(d.confident, true);
  assert.equal(d.profileId, "yeogi");
});

test("detectProfile: weak/unknown headers → not confident", () => {
  const d = detectProfile(["foo", "bar", "baz"], "random paste");
  assert.equal(d.confident, false);
  assert.equal(d.profileId, null);
});

test("inactive agoda never wins auto-detect without allowInactive", () => {
  const headers = ["Booking ID", "Guest name", "Room type", "Check-in", "Check-out", "Amount", "Status"];
  const d = detectProfile(headers, "agoda partner");
  assert.ok(!d.scores.some((s) => s.id === "agoda") || !d.confident || d.profileId !== "agoda");
  const withInactive = detectProfile(headers, "agoda partner", { allowInactive: true });
  assert.ok(withInactive.scores.find((s) => s.id === "agoda")!.score > 0);
});

test("yanolja normalize + preview: cancel without match → create-as-cancelled", () => {
  const profile = profileById("yanolja")!;
  const t = parsePasteTable(HYPOTHESIS_FIXTURES.yanolja)!;
  const col = mapColumns(t.headers, profile);
  const r0 = normalizeRow(t.rows[0]!, col, profile);
  assert.equal(r0.guestName, "김테스트");
  assert.equal(r0.checkIn, "2026-10-20");
  assert.equal(r0.nights, 2);
  assert.equal(r0.amount, 120000);
  assert.equal(r0.reservationId, "YN-1001");
  assert.equal(r0.isCancelStatus, false);

  const r1 = normalizeRow(t.rows[1]!, col, profile);
  assert.equal(r1.isCancelStatus, true);
  assert.equal(r1.skipSuggested, true);

  const preview = buildPreviewRows(t, profile, settings, [], "p-ya");
  assert.equal(preview[0]!.rowStatus, "ok");
  assert.equal(preview[0]!.typeId, "std");
  // cancel row, no Hotori match → 예약취소 (Path A create-as-cancelled)
  assert.equal(preview[1]!.rowStatus, "cancel");
  assert.equal(preview[1]!.matchBookingId, null);
  assert.equal(preview[1]!.skip, false);
  assert.equal(preview[1]!.typeId, "dlx");
});

test("cancel+match → cancel existing draft; cancel+no match → Path A cancelled; stock not deducted", () => {
  const profile = profileById("yanolja")!;
  const t = parsePasteTable(HYPOTHESIS_FIXTURES.yanolja)!;
  const memo = reservationMemo("야놀자", "YN-1002", "디럭스");
  const existing = [
    {
      id: "b-cancel-me",
      platformId: "p-ya",
      memo,
      status: "active" as const,
      arrived: false,
      checkedOutAt: null,
      guestName: "이샘플",
      checkIn: "2026-10-21",
      nights: 1,
      typeId: "dlx",
    },
  ];
  const matchedPreview = buildPreviewRows(t, profile, settings, existing, "p-ya");
  assert.equal(matchedPreview[1]!.rowStatus, "cancel");
  assert.equal(matchedPreview[1]!.matchBookingId, "b-cancel-me");
  const nowIso = "2026-10-25T12:00:00.000Z";
  const live: Booking = {
    id: "b-cancel-me",
    kind: "stay",
    status: "active",
    platformId: "p-ya",
    price: 80000,
    guestName: "이샘플",
    typeId: "dlx",
    roomId: null,
    checkIn: "2026-10-21",
    nights: 1,
    startTime: null,
    endTime: null,
    arrived: false,
    memo,
    cancelledAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const cancelledMatch = cancelDraftFromMatch(live, nowIso);
  assert.equal(cancelledMatch.status, "cancelled");
  assert.equal(isActive(cancelledMatch), false);

  const noMatchPreview = buildPreviewRows(t, profile, settings, [], "p-ya");
  assert.equal(noMatchPreview[1]!.rowStatus, "cancel");
  assert.equal(noMatchPreview[1]!.matchBookingId, null);
  const created = pathACancelDraftFromPreview(noMatchPreview[1]!, {
    platformId: "p-ya",
    platformLabel: "야놀자",
    id: "b-new-cx",
    nowIso,
  });
  assert.equal(created.status, "cancelled");
  assert.equal(created.roomId, null);
  assert.equal(isActive(created), false);
  assert.equal(pathADraftFromPreview(noMatchPreview[1]!, {
    platformId: "p-ya",
    platformLabel: "야놀자",
    id: "b-active",
    nowIso,
  }).status, "cancelled", "취소 원문은 일반 생성 함수에서도 정상 예약으로 저장할 수 없음");

  // stockTable skips !isActive — cancelled Path A must not deduct type-hold
  const dates = ["2026-10-21"];
  const withActive = stockTable(settings, [{ ...created, status: "active", id: "probe-active" }], dates);
  const withCancelled = stockTable(settings, [created], dates);
  const base = stockTable(settings, [], dates);
  assert.equal(withCancelled.get("dlx")?.get("2026-10-21"), base.get("dlx")?.get("2026-10-21"));
  assert.ok((withActive.get("dlx")?.get("2026-10-21") ?? 0) < (base.get("dlx")?.get("2026-10-21") ?? 0));
});

test("cancel no-match missing type → 수정필요; already cancelled → 중복스킵", () => {
  const profile = profileById("yanolja")!;
  const paste = [
    "야놀자예약번호\t예약자\t연락처\t객실상품\t체크인\t체크아웃\t박수\t판매금액\t상태",
    "YN-NO-TYPE\t이없음\t010-0000-0000\t없는타입XYZ\t2026-10-21\t2026-10-22\t1\t80000\t취소",
  ].join("\n");
  const t = parsePasteTable(paste)!;
  const preview = buildPreviewRows(t, profile, settings, [], "p-ya");
  assert.equal(preview[0]!.rowStatus, "need_fix");
  assert.equal(preview[0]!.pasteCancel, true);
  assert.equal(preview[0]!.typeId, null);

  const memo = reservationMemo("야놀자", "YN-NO-TYPE");
  assert.equal(isAlreadyCancelledReservation([{ platformId: "p-ya", memo, status: "cancelled" }], "p-ya", "YN-NO-TYPE"), true);
  const again = buildPreviewRows(
    t,
    profile,
    settings,
    [{ id: "b-cx", platformId: "p-ya", memo, status: "cancelled" as const, arrived: false, checkedOutAt: null, guestName: "이없음", checkIn: "2026-10-21", nights: 1, typeId: "dlx" }],
    "p-ya",
  );
  assert.equal(again[0]!.rowStatus, "dup");
  assert.equal(again[0]!.skip, true);
});

test("isCancelStatus classify: KR/EN tokens", () => {
  const ya = profileById("yanolja")!;
  const ag = profileById("agoda")!;
  assert.equal(isCancelStatus("취소", ya), true);
  assert.equal(isCancelStatus("취소완료", ya), true);
  assert.equal(isCancelStatus("예약확정", ya), false);
  assert.equal(isCancelStatus("cancelled", ag), true);
  assert.equal(isCancelStatus("Canceled", ag), true);
  assert.equal(isCancelStatus("Confirmed", ag), false);
});

test("findActiveBookingByReservationId match + cancel preview", () => {
  const profile = profileById("yanolja")!;
  const memo = reservationMemo("야놀자", "YN-1002", "디럭스");
  const existing = [
    {
      id: "b-cancel-me",
      platformId: "p-ya",
      memo,
      status: "active" as const,
      arrived: false,
      checkedOutAt: null,
      guestName: "이샘플",
      checkIn: "2026-10-21",
      nights: 1,
      typeId: "dlx",
    },
  ];
  assert.equal(findActiveBookingByReservationId(existing, "p-ya", "YN-1002")?.id, "b-cancel-me");
  assert.equal(findActiveBookingByReservationId(existing, "p-ya", "YN-9999"), null);
  assert.equal(findActiveBookingByReservationId(existing, "p-ye", "YN-1002"), null);

  const t = parsePasteTable(HYPOTHESIS_FIXTURES.yanolja)!;
  const preview = buildPreviewRows(t, profile, settings, existing, "p-ya");
  assert.equal(preview[1]!.rowStatus, "cancel");
  assert.equal(preview[1]!.matchBookingId, "b-cancel-me");
  assert.equal(preview[1]!.skip, false);
  assert.equal(preview[1]!.cancelGuard, false);
});

test("cancel guard: arrived / checkedOut blocked by default", () => {
  const profile = profileById("yanolja")!;
  const memo = reservationMemo("야놀자", "YN-1002");
  assert.equal(isCancelGuardBlocked({ arrived: true, checkedOutAt: null }), true);
  assert.equal(isCancelGuardBlocked({ arrived: false, checkedOutAt: "2026-10-22T01:00:00Z" }), true);
  assert.equal(isCancelGuardBlocked({ arrived: false, checkedOutAt: null }), false);

  const arrived = [
    {
      id: "b-in",
      platformId: "p-ya",
      memo,
      status: "active" as const,
      arrived: true,
      checkedOutAt: null,
      guestName: "이샘플",
      checkIn: "2026-10-21",
      nights: 1,
      typeId: "dlx",
    },
  ];
  const t = parsePasteTable(HYPOTHESIS_FIXTURES.yanolja)!;
  const preview = buildPreviewRows(t, profile, settings, arrived, "p-ya");
  assert.equal(preview[1]!.rowStatus, "skip");
  assert.equal(preview[1]!.cancelGuard, true);
  assert.equal(preview[1]!.matchBookingId, "b-in");
  assert.equal(preview[1]!.skip, true);
});

test("cancel + new id in same paste: cancel old + create new", () => {
  const profile = profileById("yanolja")!;
  const paste = [
    "야놀자예약번호\t예약자\t연락처\t객실상품\t체크인\t체크아웃\t박수\t판매금액\t상태",
    "YN-OLD\t김재예약\t010-1111-2222\t스탠다드\t2026-10-20\t2026-10-22\t2\t100000\t취소",
    "YN-NEW\t김재예약\t010-1111-2222\t디럭스\t2026-10-25\t2026-10-27\t2\t180000\t예약확정",
  ].join("\n");
  const t = parsePasteTable(paste)!;
  const existing = [
    {
      id: "b-old",
      platformId: "p-ya",
      memo: reservationMemo("야놀자", "YN-OLD"),
      status: "active" as const,
      arrived: false,
      checkedOutAt: null,
      guestName: "김재예약",
      checkIn: "2026-10-20",
      nights: 2,
      typeId: "std",
    },
  ];
  const preview = buildPreviewRows(t, profile, settings, existing, "p-ya");
  assert.equal(preview[0]!.rowStatus, "cancel");
  assert.equal(preview[0]!.matchBookingId, "b-old");
  assert.equal(preview[1]!.rowStatus, "ok");
  assert.equal(preview[1]!.reservationId, "YN-NEW");
  assert.equal(preview[1]!.typeId, "dlx");
});

test("yeogi normalize: dotted dates + 박 unit", () => {
  const profile = profileById("yeogi")!;
  const t = parsePasteTable(HYPOTHESIS_FIXTURES.yeogi)!;
  const preview = buildPreviewRows(t, profile, settings, [], "p-ye");
  assert.equal(preview[0]!.checkIn, "2026-10-25");
  assert.equal(preview[0]!.nights, 2);
  assert.equal(preview[0]!.typeId, "std"); // 스탠다드룸 fuzzy
  assert.equal(preview[1]!.typeId, "ondol");
});

test("parse helpers: date · amount · nights inclusive 일", () => {
  assert.equal(parseLooseDate("2026-10-20"), "2026-10-20");
  assert.equal(parseLooseDate("2026.10.20"), "2026-10-20");
  assert.equal(parseLooseDate("2026년 10월 20일"), "2026-10-20");
  assert.equal(parseAmount("₩120,000"), 120000);
  assert.equal(parseNightsCell("2박").nights, 2);
  const inc = parseNightsCell("3일");
  assert.equal(inc.nights, 2);
  assert.equal(inc.inclusiveSuspect, true);
});

test("matchPlatformId + type fuzzy", () => {
  assert.equal(matchPlatformId(profileById("yanolja")!, settings), "p-ya");
  assert.equal(matchPlatformId(profileById("yeogi")!, settings), "p-ye");
  assert.equal(matchTypeId("디럭스 더블", settings), "dlx");
  assert.equal(matchTypeId("없는타입", settings), null);
});

test("normTypeName: trim · collapse spaces · casefold · unify ㅣ/|", () => {
  assert.equal(normTypeName("  스탠다드\u00a0더블  "), "스탠다드 더블");
  assert.equal(normTypeName("Deluxe  Twin"), "deluxe twin");
  assert.equal(normTypeName("A\u200bB"), "ab");
  assert.equal(normTypeName("Family RoomㅣVIP"), "family room|vip");
  assert.equal(normTypeName("Family Room|VIP"), "family room|vip");
});

test("typeRawForAliasMatch: strip 객실 타입 ID + trailing amenity (...)", () => {
  assert.equal(
    typeRawForAliasMatch("Family RoomㅣVIP(퀸베드1+이층침대1ㅣ스타일러ㅣ공기청정기ㅣ욕조)"),
    "Family RoomㅣVIP",
  );
  assert.equal(
    typeRawForAliasMatch("Family RoomㅣVIP(퀸베드1+이층침대1ㅣ스타일러ㅣ공기청정기ㅣ욕조)\n(객실 타입 ID: 51833)"),
    "Family RoomㅣVIP",
  );
  assert.equal(typeRawForAliasMatch("온돌ㅣVIP"), "온돌ㅣVIP");
});

test("type alias: lookup + resolve before fuzzy", () => {
  const withAlias = normalizeSettings({
    ...settings,
    typeAliases: [
      {
        id: "ta1",
        platformId: "p-ya",
        platformTypeName: "스탠다드 더블(넷플릭스)",
        typeId: "ondol", // intentional: alias wins over fuzzy→std
      },
    ],
  });
  assert.equal(normTypeName("스탠다드  더블(넷플릭스)"), normTypeName("스탠다드 더블(넷플릭스)"));
  assert.equal(lookupTypeAlias(withAlias.typeAliases, "p-ya", "  스탠다드 더블(넷플릭스) "), "ondol");
  assert.equal(matchTypeId("스탠다드 더블(넷플릭스)", withAlias, "p-ya"), "ondol");
  // other platform → no alias → fuzzy may hit 스탠다드
  assert.equal(matchTypeId("스탠다드 더블(넷플릭스)", withAlias, "p-ye"), "std");
  assert.equal(matchTypeId("완전없는이름XYZ", withAlias, "p-ya"), null);
});

test("type alias: Family RoomㅣVIP + amenity paste → 패밀리룸 (not 수정필요)", () => {
  const withFamily = normalizeSettings({
    ...settings,
    types: [
      ...settings.types,
      { id: "family", name: "패밀리룸" },
    ],
    typeAliases: [
      {
        id: "ta-fam",
        platformId: "p-ya",
        platformTypeName: "Family RoomㅣVIP",
        typeId: "family",
      },
      // shorter prefix must lose to longest
      {
        id: "ta-short",
        platformId: "p-ya",
        platformTypeName: "Family Room",
        typeId: "std",
      },
    ],
  });
  const pasteType =
    "Family RoomㅣVIP(퀸베드1+이층침대1ㅣ스타일러ㅣ공기청정기ㅣ욕조)\n(객실 타입 ID: 51833)";
  assert.equal(lookupTypeAlias(withFamily.typeAliases, "p-ya", pasteType), "family");
  assert.equal(matchTypeId(pasteType, withFamily, "p-ya"), "family");

  // live sample card → preview row not need_fix from type alone
  const samplePath =
    "/cursor/stores/bc-fc855f4a-4cd7-41f6-8016-26e7dc29c864/internal/yanolja-family-room-type-match-sample.txt";
  if (existsSync(samplePath)) {
    const profile = profileById("yanolja")!;
    const t = parsePasteTable(readFileSync(samplePath, "utf8"));
    assert.ok(t);
    assert.match(t!.rows[0]![3]!, /^Family Room/);
    const preview = buildPreviewRows(t!, profile, withFamily, [], "p-ya");
    assert.equal(preview[0]!.typeId, "family");
    assert.notEqual(preview[0]!.rowStatus, "need_fix");
  }
});

test("upsertTypeAlias replaces same normalized name · removeTypeAlias", () => {
  let list = upsertTypeAlias([], { platformId: "p-ya", platformTypeName: "디럭스룸", typeId: "dlx" }, () => "a1");
  assert.equal(list.length, 1);
  list = upsertTypeAlias(list, { platformId: "p-ya", platformTypeName: "  디럭스룸  ", typeId: "std" }, () => "a2");
  assert.equal(list.length, 1);
  assert.equal(list[0]!.typeId, "std");
  assert.equal(list[0]!.platformTypeName, "디럭스룸");
  list = removeTypeAlias(list, list[0]!.id);
  assert.equal(list.length, 0);
});

test("buildPreviewRows uses alias when platformId set", () => {
  const s2 = normalizeSettings({
    ...settings,
    typeAliases: [{ id: "ta", platformId: "p-ya", platformTypeName: "스탠다드", typeId: "dlx" }],
  });
  const profile = profileById("yanolja")!;
  const t = parsePasteTable(HYPOTHESIS_FIXTURES.yanolja)!;
  const preview = buildPreviewRows(t, profile, s2, [], "p-ya");
  // fixture row0 typeRaw=스탠다드 → alias forces dlx (not fuzzy std)
  assert.equal(preview[0]!.typeId, "dlx");
});

test("memo dedupe by platform + 예약번호", () => {
  const memo = reservationMemo("야놀자", "YN-1001", "스탠다드");
  assert.match(memo, /야놀자 예약번호 YN-1001/);
  assert.equal(reservationIdFromMemo(memo), "YN-1001");
  assert.equal(
    isDuplicateReservation([{ platformId: "p-ya", memo, status: "active" }], "p-ya", "YN-1001"),
    true,
  );
  assert.equal(
    isDuplicateReservation([{ platformId: "p-ya", memo, status: "active" }], "p-ya", "YN-9999"),
    false,
  );
  assert.equal(
    isDuplicateReservation([{ platformId: "p-ye", memo, status: "active" }], "p-ya", "YN-1001"),
    false,
  );
});

test("12 known + 1 new → 신규 1 · 기존예약 12 · 수정필요 0", () => {
  const profile = profileById("yanolja")!;
  const knownIds = Array.from({ length: 12 }, (_, i) => `YN-EX${String(i + 1).padStart(2, "0")}`);
  const header =
    "야놀자예약번호\t예약자\t연락처\t객실타입\t체크인\t체크아웃\t박수\t판매금액\t상태";
  const knownLines = knownIds.map(
    (id, i) =>
      `${id}\t기존${i + 1}\t010-0000-${String(1000 + i).slice(-4)}\t스탠다드\t2026.11.01\t2026.11.02\t1\t80000\t예약완료`,
  );
  const newLine =
    "YN-NEW99\t신규손님\t010-9999-0000\t스탠다드\t2026.11.03\t2026.11.04\t1\t90000\t예약완료";
  const t = parsePasteTable([header, ...knownLines, newLine].join("\n"))!;
  const existing = knownIds.map((id, i) => ({
    id: `b-${id}`,
    platformId: "p-ya",
    memo: reservationMemo("야놀자", id, "스탠다드"),
    status: "active" as const,
    arrived: false,
    checkedOutAt: null as string | null,
    guestName: `기존${i + 1}`,
    checkIn: "2026-11-01",
    nights: 1,
    typeId: "std",
  }));
  const preview = buildPreviewRows(t, profile, settings, existing, "p-ya");
  assert.equal(preview.length, 13);
  const existingRows = preview.filter((r) => isExistingReservationRow(r));
  const newRows = preview.filter((r) => r.rowStatus === "ok");
  const fixLabel = preview.filter((r) => isFixLabelRow(r));
  const fixBlock = preview.filter((r) => isFixBlockingRow(r));
  assert.equal(existingRows.length, 12);
  assert.equal(newRows.length, 1);
  assert.equal(fixLabel.length, 0);
  assert.equal(fixBlock.length, 0);
  assert.equal(previewRowStatusLabel(existingRows[0]!), "기존예약");
  assert.equal(previewRowStatusLabel(newRows[0]!), "신규");
  // Must not surface as 수정필요
  for (const r of existingRows) {
    assert.equal(r.rowStatus, "dup");
    assert.equal(r.skip, true);
    assert.notEqual(previewRowStatusLabel(r), "수정필요");
  }
});

test("seed profiles: active = yanolja+yeogi only (hypothesis fixtures)", () => {
  const active = PLATFORM_PROFILES.filter((p) => p.active).map((p) => p.id).sort();
  assert.deepEqual(active, ["yanolja", "yeogi"]);
});

test("isKnownNestedChannelLabel: heuristic — never eat guest names", () => {
  assert.equal(isKnownNestedChannelLabel("아고다"), true);
  assert.equal(isKnownNestedChannelLabel("Agoda"), true);
  assert.equal(isKnownNestedChannelLabel("여기어때"), true);
  assert.equal(isKnownNestedChannelLabel("야놀자"), true);
  assert.equal(isKnownNestedChannelLabel("타이드스퀘어_프리비아"), true);
  assert.equal(isKnownNestedChannelLabel("이베이_G마켓"), true);
  assert.equal(isKnownNestedChannelLabel("Sumi Lee"), false);
  assert.equal(isKnownNestedChannelLabel("김한나"), false);
  assert.equal(isKnownNestedChannelLabel("도보"), false);
  assert.equal(isKnownNestedChannelLabel("Twinㅣ트윈"), false);
  assert.equal(isKnownNestedChannelLabel("0507-0418-4303"), false);
  assert.equal(isKnownNestedChannelLabel("/ 1박"), false);
  // hotel platform name beyond seed
  assert.equal(isKnownNestedChannelLabel("호텔타임", ["호텔타임", "호"]), true);
  assert.equal(isKnownNestedChannelLabel("타이드스퀘어", ["타이드스퀘어", "타"]), true);
  // unknown brand-like (Latin) → nested, not guest
  assert.equal(isKnownNestedChannelLabel("완전모르는채널XYZ"), true);
});

test("yanolja nested 아고다 card: shift fields + platform=아고다 + Twin alias", () => {
  const raw = readFileSync(fileURLToPath(YANOLJA_NESTED_AGODA_CARD_FIXTURE_PATH), "utf8");
  assert.equal(looksLikeYanoljaCardPaste(raw), true);

  const card = parseYanoljaCardPaste(raw);
  assert.ok(card);
  assert.equal(card!.rows.length, 1);
  const row = card!.rows[0]!;
  assert.equal(row[0], "2610211864975519");
  assert.equal(row[1], "Sumi Lee"); // NOT 아고다
  assert.equal(row[2], "0507-0418-4303");
  assert.match(row[3]!, /^Twin/);
  assert.match(row[4]!, /^2026\.10\.28/);
  assert.equal(row[6], "1");
  assert.equal(row[7], "70000");
  assert.equal(row[8], "예약완료");
  assert.equal(row[9], "아고다");

  const viaPaste = parsePasteTable(raw);
  assert.ok(viaPaste);
  assert.equal(detectProfile(viaPaste!.headers, raw).profileId, "yanolja");

  const withTwinAlias = normalizeSettings({
    ...settings,
    typeAliases: [
      {
        id: "ta-ag-twin",
        platformId: "p-ag",
        platformTypeName: "Twinㅣ트윈",
        typeId: "twin",
      },
      // source (야놀자) alias would wrongly map if nested skipped
      {
        id: "ta-ya-twin",
        platformId: "p-ya",
        platformTypeName: "Twinㅣ트윈",
        typeId: "std",
      },
    ],
  });
  assert.equal(matchPlatformByLabel("아고다", withTwinAlias)?.id, "p-ag");
  assert.equal(
    matchTypeIdNested("Twinㅣ트윈(더블1+싱글1ㅣ공기청정기)", withTwinAlias, "p-ag", "p-ya"),
    "twin",
  );

  const profile = profileById("yanolja")!;
  const preview = buildPreviewRows(viaPaste!, profile, withTwinAlias, [], "p-ya");
  assert.equal(preview.length, 1);
  assert.equal(preview[0]!.guestName, "Sumi Lee");
  assert.equal(preview[0]!.guestPhone, "0507-0418-4303");
  assert.equal(preview[0]!.nestedChannelRaw, "아고다");
  assert.equal(preview[0]!.platformId, "p-ag");
  assert.equal(preview[0]!.platformLabel, "아고다");
  assert.equal(preview[0]!.nestedChannelUnmatched, false);
  assert.equal(preview[0]!.typeId, "twin");
  assert.equal(preview[0]!.checkIn, "2026-10-28");
  assert.equal(preview[0]!.nights, 1);
  assert.equal(preview[0]!.amount, 70000);
  assert.equal(preview[0]!.rowStatus, "ok");

  const draft = pathADraftFromPreview(preview[0]!, {
    platformId: preview[0]!.platformId!,
    platformLabel: preview[0]!.platformLabel,
    id: "b-nested",
    nowIso: "2026-10-25T00:00:00.000Z",
  });
  assert.equal(draft.platformId, "p-ag");
  assert.match(draft.memo ?? "", /아고다 예약번호 2610211864975519/);

  // live owner sample path (same bytes) when present
  const live =
    "/cursor/stores/bc-fc855f4a-4cd7-41f6-8016-26e7dc29c864/internal/yanolja-nested-agoda-sample.txt";
  if (existsSync(live)) {
    const liveCard = parseYanoljaCardPaste(readFileSync(live, "utf8"))!;
    assert.equal(liveCard.rows[0]![1], "Sumi Lee");
    assert.equal(liveCard.rows[0]![9], "아고다");
  }
});

test("yanolja nested unknown channel: still shift · keep source platform · raw in memo", () => {
  const block = [
    "2610211864975519",
    "완전모르는채널XYZ",
    "Sumi Lee",
    "0507-0418-4303",
    "도보",
    "Twinㅣ트윈",
    "(객실 타입 ID: 318106)",
    "숙박",
    "/ 1박",
    "2026.10.28(수) 16:00",
    "2026.10.29(목) 12:00",
    "미리예약",
    "예약완료",
    "판매가 70,000원",
  ].join("\n");
  // unknown brand-like → nestedChannelRaw (do not eat guest)
  const card = parseYanoljaCardPaste(block)!;
  assert.equal(card.rows[0]![1], "Sumi Lee");
  assert.equal(card.rows[0]![9], "완전모르는채널XYZ");

  const noAgoda = normalizeSettings({
    platforms: [
      { id: "p-ya", name: "야놀자", abbr: "야" },
      { id: "p-walk", name: "현장·전화", abbr: "현", onsite: true },
    ],
    types: settings.types,
  });
  const agodaBlock = [
    "2610211864975519",
    "아고다",
    "Sumi Lee",
    "0507-0418-4303",
    "도보",
    "Twinㅣ트윈",
    "(객실 타입 ID: 318106)",
    "숙박",
    "/ 1박",
    "2026.10.28(수) 16:00",
    "2026.10.29(목) 12:00",
    "미리예약",
    "예약완료",
    "판매가 70,000원",
  ].join("\n");
  const t = parsePasteTable(agodaBlock)!;
  const preview = buildPreviewRows(t, profileById("yanolja")!, noAgoda, [], "p-ya");
  assert.equal(preview[0]!.guestName, "Sumi Lee");
  assert.equal(preview[0]!.nestedChannelRaw, "아고다");
  assert.equal(preview[0]!.nestedChannelUnmatched, true);
  assert.equal(preview[0]!.platformId, "p-ya");
  assert.equal(preview[0]!.platformLabel, "야놀자");
  const draft = pathADraftFromPreview(preview[0]!, {
    platformId: "p-ya",
    platformLabel: "야놀자",
    id: "b-unk",
    nowIso: "2026-10-25T00:00:00.000Z",
  });
  assert.match(draft.memo ?? "", /야놀자\(아고다\) 예약번호/);
});

test("yanolja nested 타이드스퀘어_프리비아 + 이베이_G마켓 fixtures", () => {
  const tideRaw = readFileSync(fileURLToPath(YANOLJA_NESTED_TIDESQUARE_CARD_FIXTURE_PATH), "utf8");
  const tide = parseYanoljaCardPaste(tideRaw)!;
  assert.equal(tide.rows[0]![1], "김민수");
  assert.equal(tide.rows[0]![9], "타이드스퀘어_프리비아");

  const gmRaw = readFileSync(fileURLToPath(YANOLJA_NESTED_GMARKET_CARD_FIXTURE_PATH), "utf8");
  const gm = parseYanoljaCardPaste(gmRaw)!;
  assert.equal(gm.rows[0]![1], "이수진");
  assert.equal(gm.rows[0]![2], "0507-2222-3333");
  assert.equal(gm.rows[0]![9], "이베이_G마켓");

  // fuzzy: Settings has 프리비아 → match; G마켓 unmatched → source 야놀자 + raw
  const withPrevia = normalizeSettings({
    ...settings,
    platforms: [
      ...settings.platforms,
      { id: "p-pv", name: "프리비아", abbr: "프" },
    ],
  });
  assert.equal(matchPlatformByLabel("타이드스퀘어_프리비아", withPrevia)?.id, "p-pv");
  assert.equal(matchPlatformByLabel("이베이_G마켓", withPrevia), null);

  const tidePreview = buildPreviewRows(
    parsePasteTable(tideRaw)!,
    profileById("yanolja")!,
    withPrevia,
    [],
    "p-ya",
  );
  assert.equal(tidePreview[0]!.guestName, "김민수");
  assert.equal(tidePreview[0]!.platformId, "p-pv");
  assert.equal(tidePreview[0]!.nestedChannelRaw, "타이드스퀘어_프리비아");
  assert.equal(tidePreview[0]!.nestedChannelUnmatched, false);

  const gmPreview = buildPreviewRows(
    parsePasteTable(gmRaw)!,
    profileById("yanolja")!,
    withPrevia,
    [],
    "p-ya",
  );
  assert.equal(gmPreview[0]!.guestName, "이수진");
  assert.equal(gmPreview[0]!.platformId, "p-ya");
  assert.equal(gmPreview[0]!.nestedChannelUnmatched, true);
  assert.equal(gmPreview[0]!.nestedChannelRaw, "이베이_G마켓");
});

test("normal yanolja card unchanged when no nested channel line", () => {
  const block = [
    "2610151829300184",
    "김한나",
    "0503-7330-6938",
    "차량",
    "Family RoomㅣVIP(퀸베드1)",
    "(객실 타입 ID: 51833)",
    "숙박",
    "/ 2박",
    "2026.10.26(월) 17:00",
    "2026.10.28(수) 12:00",
    "미리예약",
    "예약완료",
    "판매가 200,000원",
  ].join("\n");
  const card = parseYanoljaCardPaste(block)!;
  assert.equal(card.rows[0]![1], "김한나");
  assert.equal(card.rows[0]![9], "");
  const preview = buildPreviewRows(card, profileById("yanolja")!, settings, [], "p-ya");
  assert.equal(preview[0]!.platformId, "p-ya");
  assert.equal(preview[0]!.nestedChannelRaw, "");
});

test("yanolja 「트리플」 chrome: guest=CHOISANGYEON not occupancy badge", () => {
  assert.equal(isOccupancyOrPlanChrome("트리플"), true);
  assert.equal(isOccupancyOrPlanChrome("더블"), true);
  assert.equal(isOccupancyOrPlanChrome("싱글"), true);
  assert.equal(looksLikeGuestNameLine("트리플"), false);
  assert.equal(looksLikeGuestNameLine("CHOISANGYEON"), true);
  assert.equal(looksLikeGuestNameLine("김한나"), true);
  assert.equal(isKnownNestedChannelLabel("트리플"), false);
  assert.equal(isKnownNestedChannelLabel("CHOISANGYEON"), false);

  const raw = readFileSync(fileURLToPath(YANOLJA_TRIPLE_CHROME_CARD_FIXTURE_PATH), "utf8");
  const card = parseYanoljaCardPaste(raw);
  assert.ok(card);
  assert.equal(card!.rows.length, 1);
  assert.equal(card!.rows[0]![0], "2610161664459334");
  assert.equal(card!.rows[0]![1], "CHOISANGYEON");
  assert.equal(card!.rows[0]![2], "0503-5083-6164");
  assert.match(card!.rows[0]![3]!, /^Family Room/);
  assert.equal(card!.rows[0]![9], "");

  const withFamily = normalizeSettings({
    ...settings,
    types: [...settings.types, { id: "family", name: "패밀리룸" }],
    typeAliases: [
      {
        id: "ta-fam",
        platformId: "p-ya",
        platformTypeName: "Family RoomㅣVIP",
        typeId: "family",
      },
    ],
  });
  const preview = buildPreviewRows(card!, profileById("yanolja")!, withFamily, [], "p-ya");
  assert.equal(preview[0]!.guestName, "CHOISANGYEON");
  assert.equal(preview[0]!.guestPhone, "0503-5083-6164");
  assert.equal(preview[0]!.reservationId, "2610161664459334");
  assert.equal(preview[0]!.typeId, "family");
  assert.equal(preview[0]!.checkIn, "2026-11-14");
  assert.equal(preview[0]!.nights, 1);
  assert.equal(preview[0]!.amount, 160000);
  assert.notEqual(preview[0]!.guestName, "트리플");
});

test("looksLikeYanoljaCardPhoneLine: Ctrip intl +82…(ext)", () => {
  assert.equal(looksLikeYanoljaCardPhoneLine("+82269178710(745613)"), true);
  assert.equal(looksLikeYanoljaCardPhoneLine("+82269178710(818157)"), true);
  assert.equal(looksLikeYanoljaCardPhoneLine("0507-0418-4303"), true);
  assert.equal(looksLikeYanoljaCardPhoneLine("010-1234-5678"), true);
  assert.equal(looksLikeYanoljaCardPhoneLine("안심번호 만료"), true);
  assert.equal(looksLikeYanoljaCardPhoneLine("Standardㅣ스탠다드"), false);
  assert.equal(looksLikeYanoljaCardPhoneLine("2026.10.29(목) 16:00"), false);
  assert.equal(looksLikeYanoljaCardPhoneLine("JIWOONG KIM"), false);
});

test("typeRawBilingualTail: Standard|스탠다드 · skip Family Room|VIP", () => {
  assert.equal(typeRawBilingualTail("Standardㅣ스탠다드(공기청정기ㅣ스타일러)"), "스탠다드");
  assert.equal(typeRawBilingualTail("Standardㅣ스탠다드 스타일러(공기청정기)"), "스탠다드 스타일러");
  assert.equal(typeRawBilingualTail("Family RoomㅣVIP(퀸베드1)"), "");
  assert.equal(
    lookupTypeAlias(
      [{ id: "a", platformId: "p-ya", platformTypeName: "스탠다드", typeId: "std" }],
      "p-ya",
      "Standardㅣ스탠다드(공기청정기ㅣ스타일러)",
    ),
    "std",
  );
});

test("yanolja nested 씨트립: intl phone → type · 트립닷컴 platform · alias", () => {
  const raw = readFileSync(fileURLToPath(YANOLJA_NESTED_CTRIP_CARD_FIXTURE_PATH), "utf8");
  const card = parseYanoljaCardPaste(raw)!;
  assert.equal(card.rows[0]![1], "JIWOONG KIM");
  assert.equal(card.rows[0]![2], "+82269178710(745613)");
  assert.match(card.rows[0]![3]!, /^Standard/);
  assert.equal(card.rows[0]![9], "씨트립");

  // Hotel registered as 트립닷컴 (not literal 씨트립) + 야놀자 alias 스탠다드
  const withTrip = normalizeSettings({
    ...settings,
    platforms: [
      ...settings.platforms,
      { id: "p-ct", name: "트립닷컴", abbr: "트" },
    ],
    typeAliases: [
      {
        id: "ta-std",
        platformId: "p-ct",
        platformTypeName: "스탠다드",
        typeId: "std",
      },
      {
        id: "ta-std-styler",
        platformId: "p-ct",
        platformTypeName: "스탠다드 스타일러",
        typeId: "std",
      },
    ],
  });
  assert.equal(matchPlatformByLabel("씨트립", withTrip)?.id, "p-ct");
  assert.equal(matchPlatformByLabel("씨트립", settings), null);

  const preview = buildPreviewRows(parsePasteTable(raw)!, profileById("yanolja")!, withTrip, [], "p-ya");
  assert.equal(preview[0]!.guestName, "JIWOONG KIM");
  assert.equal(preview[0]!.guestPhone, "+82269178710(745613)");
  assert.match(preview[0]!.typeRaw, /^Standard/);
  assert.equal(preview[0]!.typeId, "std");
  assert.equal(preview[0]!.platformId, "p-ct");
  assert.equal(preview[0]!.platformLabel, "트립닷컴");
  assert.equal(preview[0]!.nestedChannelRaw, "씨트립");
  assert.equal(preview[0]!.nestedChannelUnmatched, false);
  assert.equal(preview[0]!.rowStatus, "ok");
  assert.equal(previewRowStatusLabel(preview[0]!), "신규");

  // Without 트립닷컴 in Settings: still parse phone/type (not 수정필요 from type); 플랫폼 미등록 chip
  const noTrip = buildPreviewRows(parsePasteTable(raw)!, profileById("yanolja")!, settings, [], "p-ya");
  assert.equal(noTrip[0]!.nestedChannelUnmatched, true);
  assert.equal(noTrip[0]!.platformId, "p-ya");
  assert.equal(noTrip[0]!.typeId, "std"); // fuzzy / any-platform
  assert.equal(noTrip[0]!.rowStatus, "ok");
});

// ── 연박 가져오기: 박별 요금 입력 (총액 균등분할 없음) ──
const nightRow = (over: Record<string, unknown> = {}) =>
  ({
    key: "k", sourceIndex: 0, guestName: "김", guestPhone: "", typeRaw: "스탠다드", typeId: "std",
    checkIn: "2026-10-26", nights: 3, amount: 270_000, priceUnset: false, reservationId: "YN-1",
    statusRaw: "", skip: false, nightsInclusiveSuspect: false, dup: false, pasteCancel: false,
    matchBookingId: null, cancelGuard: false, rowStatus: "ok", nestedChannelRaw: "", platformId: "p-ya",
    platformLabel: "야놀자", nestedChannelUnmatched: false, ...over,
  }) as PreviewRow;
const nightOpts = { platformId: "p-ya", platformLabel: "야놀자", id: "b1", nowIso: "2026-10-25T00:00:00.000Z" };

test("가져오기 박별 요금: 입력하지 않으면 night_rates 없이 저장 — 총액을 나눠 채우지 않아요", () => {
  const row = nightRow();
  assert.deepEqual(previewNightDates(row), ["2026-10-26", "2026-10-27", "2026-10-28"]);
  assert.equal(enteredNightRates(row), null);
  assert.equal(pathADraftFromPreview(row, nightOpts).nightRates, null);
});

test("가져오기 박별 요금: 입력한 박만 저장 · 합계≠판매금이어도 막지 않고 차액만 알려요", () => {
  const row = nightRow({ nightAmounts: { "2026-10-26": 80_000, "2026-10-27": 100_000, "2026-10-28": 120_000 } });
  const d = pathADraftFromPreview(row, nightOpts);
  assert.deepEqual(d.nightRates?.nights, { "2026-10-26": 80_000, "2026-10-27": 100_000, "2026-10-28": 120_000 });
  assert.equal(d.price, 270_000, "판매금은 그대로");
  const diff = nightRatesDiff(row);
  assert.deepEqual([diff.sum, diff.total, diff.diff], [300_000, 270_000, 30_000]);
  const partial = nightRow({ nightAmounts: { "2026-10-27": 100_000, "2026-10-28": null } });
  assert.deepEqual(pathADraftFromPreview(partial, nightOpts).nightRates?.nights, { "2026-10-27": 100_000 });
  assert.equal(nightRatesDiff(partial).diff, null, "덜 적었으면 차액을 말하지 않아요");
});

test("가져오기 박별 요금: 날짜·박수를 고치면 범위 밖 입력은 버려요 · 1박은 대상 아님", () => {
  const row = nightRow({ nights: 2, nightAmounts: { "2026-10-26": 90_000, "2026-10-28": 99_000 } });
  assert.deepEqual(enteredNightRates(row)?.nights, { "2026-10-26": 90_000 });
  assert.deepEqual(previewNightDates(nightRow({ nights: 1 })), []);
  assert.equal(pathADraftFromPreview(nightRow({ nights: 1, nightAmounts: { "2026-10-26": 5 } }), nightOpts).nightRates, null);
});

test("가져오기 박별 요금: 제안은 설정의 타입 요금(평일/주말)에서 — 직원이 고칠 수 있는 제안", () => {
  const sug = suggestedNightAmounts({ typeRates: { std: { weekday: 90_000, weekend: 120_000 } } } as never, nightRow({ checkIn: "2026-10-23", nights: 3 }));
  assert.deepEqual(sug, { "2026-10-23": 120_000, "2026-10-24": 120_000, "2026-10-25": 90_000 });
  assert.deepEqual(suggestedNightAmounts({} as never, nightRow()), {}, "요금이 없으면 제안 없음(빈칸)");
});

test("타입 숫자 코드를 보존: standard와 standard2는 별도 상품", () => {
  const codes = { ...settings, types: [{id:"one",name:"standard"},{id:"two",name:"standard2"}] };
  assert.equal(matchTypeId("standard", codes), "one");
  assert.equal(matchTypeId("standard2", codes), "two");
  assert.equal(matchTypeId("STANDARD2 (스타일러)", codes), "two");
  assert.equal(matchTypeId("standard2", { ...codes, types:[codes.types[0]!] }), null);
  assert.equal(matchTypeId("standard", { ...codes, types:[codes.types[1]!] }), null);
  assert.equal(matchTypeId("standard 2", { ...codes, types:[codes.types[0]!] }), null);
});
test("실제 Standard2 원문은 일반 스탠다드 번역명으로 자동 확정하지 않는다", () => {
  const raw = "Standard2 ㅣ스탠다드 (스타일러ㅣ공기청정기)\n(객실 타입 ID: 427045)";
  const aliased = { ...settings, typeAliases:[{id:"base",platformId:"p-ya",platformTypeName:"스탠다드",typeId:"std"}] };
  assert.equal(typeRawBilingualTail(raw), "");
  assert.equal(matchTypeId(raw, aliased, "p-ya"), null);
  assert.equal(matchTypeIdNested(raw, aliased, "p-ag", "p-ya"), null);
  assert.equal(matchTypeId(raw, { ...aliased, typeAliases:[...aliased.typeAliases,{id:"code2",platformId:"p-ya",platformTypeName:"Standard2",typeId:"dlx"}] }, "p-ya"), "dlx");
});

test("실제 호텔에 이미 저장된 Standard2 매칭은 구분자 공백과 무관하게 적용", () => {
 const raw="Standard2 ㅣ스탠다드 (스타일러ㅣ공기청정기)\n(객실 타입 ID: 427045)";
 const configured={...settings,types:[...settings.types,{id:"pc",name:"스탠다드 2PC"}],typeAliases:[
 {id:"base",platformId:"p-ya",platformTypeName:"Standardㅣ스탠다드",typeId:"std"},
 {id:"pc",platformId:"p-ya",platformTypeName:"Standard2ㅣ스탠다드",typeId:"pc"}]};
 assert.equal(normTypeName("Standard2 ㅣ 스탠다드"),normTypeName("Standard2ㅣ스탠다드"));
 assert.equal(matchTypeIdNested(raw,configured,null,"p-ya"),"pc");
 assert.equal(matchTypeIdNested("Standard ㅣ스탠다드 (스타일러ㅣ공기청정기)",configured,null,"p-ya"),"std");
 assert.equal(matchTypeIdNested("Standard3 ㅣ스탠다드 (스타일러)",configured,null,"p-ya"),null);
});

test("Standard2 신규 저장 타입은 2PC를 보존하고 기존 잘못 저장된 예약과는 차이를 알린다", () => {
  const configured={...settings,types:[...settings.types,{id:"pc",name:"스탠다드 2PC"}],typeAliases:[
    {id:"base",platformId:"p-ya",platformTypeName:"Standardㅣ스탠다드",typeId:"std"},
    {id:"pc",platformId:"p-ya",platformTypeName:"Standard2ㅣ스탠다드",typeId:"pc"}]};
  const raw="Standard2 ㅣ스탠다드 (스타일러ㅣ공기청정기)";
  const row=nightRow({typeRaw:raw,typeId:matchTypeIdNested(raw,configured,null,"p-ya"),nights:1});
  const fresh=pathADraftFromPreview(row,nightOpts);
  assert.equal(fresh.typeId,"pc");
  assert.equal(importedTypeSuggestion(fresh,configured),null);
  const old={...fresh,typeId:"std",price:90000,arrived:true};
  const before=JSON.stringify(old);
  assert.deepEqual(importedTypeSuggestion(old,configured),{typeId:"pc",raw});
  const existingRow=nightRow({...row,dup:true,skip:true,rowStatus:"dup"});
  assert.equal(previewTypeMismatch(existingRow,[old])?.id,old.id);
  assert.equal(recomputeRowStatus(existingRow),"dup","재인식만으로 신규 업로드하지 않는다");
  assert.equal(JSON.stringify(old),before,"차이 확인은 원본 예약을 변경하지 않는다");
  assert.equal(previewTypeMismatch(existingRow,[old,{...old,id:"ambiguous"}]),null);
  assert.equal(previewTypeMismatch({...existingRow,pasteCancel:true},[old]),null);
  assert.equal(previewTypeMismatch({...existingRow,platformId:"other"},[old]),null);
  assert.equal(previewTypeMismatch(existingRow,[fresh]),null);
  assert.equal(importedTypeSuggestion({...old,memo:"직접 입력 Standard2"},configured),null);
  assert.equal(importedTypeSuggestion({...old,memo:old.memo!.replace("Standard2","Standard3")},configured),null);
  assert.equal(importedTypeSuggestion({...old,kind:"dayuse"},configured),null);
});

test("스마트등록 출처는 신규 라벨과 기존 메모를 읽고 원문을 추정하지 않는다", () => {
  const raw="Standard2 ㅣ스탠다드 (스타일러ㅣ공기청정기)";
  const memo=reservationMemo("야놀자","TEST-NEW",raw,"씨트립");
  assert.match(memo,/^\[스마트등록\]/);
  assert.deepEqual(smartImportInfo({memo}),{rawType:raw,reservationId:"TEST-NEW"});
  assert.deepEqual(smartImportInfo({memo:memo.replace("[스마트등록] ","")}),{rawType:raw,reservationId:"TEST-NEW"});
  assert.deepEqual(smartImportInfo({memo:reservationMemo("야놀자","",raw)}),{rawType:raw,reservationId:null});
  assert.deepEqual(smartImportInfo({memo:reservationMemo("야놀자","TEST-OLD")}),{rawType:null,reservationId:"TEST-OLD"});
  assert.equal(smartImportInfo({memo:"직접 등록한 예약"}),null);
  assert.equal(smartImportInfo({memo:null}),null);
});


// 사용자 제보와 동일한 구조. 재현 데이터는 개인정보 대신 가상 이름·번호를 사용한다.
const maskedCancelCard = `9910301319550117
김*지
안심번호 만료
차량
Standard2 ㅣ스탠다드 (스타일러ㅣ공기청정기)
(객실 타입 ID: 427045)
숙박
/ 1박
2026.10.30(금) 16:00
2026.10.31(토) 12:00
2026.10.30(금) 13:20:26
당일
예약취소
고객취소
2026.10.30(금)
14:04:25
판매가 100,000원
입금예정가 90,000원
쿠폰5,000원
REST쿠폰10_5`;
const sourceSettings=normalizeSettings({...settings,types:[...settings.types,{id:"pc",name:"스탠다드 2PC"}],typeAliases:[{id:"pc-alias",platformId:"p-ya",platformTypeName:"Standard2 ㅣ스탠다드 (스타일러ㅣ공기청정기)",typeId:"pc"}]});
const maskedPreview=(raw=maskedCancelCard)=>buildPreviewRows(parsePasteTable(raw)!,profileById("yanolja")!,sourceSettings,[],"p-ya")[0]!;

test("마스킹 이름·고객취소 원문은 2PC 취소 예약으로 보존하고 재고를 차감하지 않음",()=>{
 const p=maskedPreview();
 assert.equal(p.guestName,"김*지"); assert.equal(p.sourceGuestName,"김*지"); assert.equal(p.typeId,"pc"); assert.equal(p.pasteCancel,true); assert.equal(p.rowStatus,"cancel");
 assert.equal(looksLikeGuestNameLine("김*지"),true); assert.equal(isKnownNestedChannelLabel("김*지"),false);
 const d=pathADraftFromPreview(p,{platformId:"p-ya",platformLabel:"야놀자",id:"cx",nowIso:"2026-10-31T00:00:00Z",status:"active"});
 assert.equal(d.status,"cancelled"); assert.equal(d.guestName,"김*지"); assert.equal(isActive(d),false);
 assert.match(d.memo!,/이름 김\*지 · 상태 예약취소/);
 assert.deepEqual(stockTable(sourceSettings,[d],["2026-10-30"]),stockTable(sourceSettings,[],["2026-10-30"]));
});
test("클립보드 HTML 표가 다른 이름·정상 상태여도 완전한 카드 텍스트의 취소·이름을 우선",()=>{
 const html=`<table><tr><th>야놀자예약번호</th><th>예약자</th><th>객실상품</th><th>체크인</th><th>체크아웃</th><th>판매금액</th><th>상태</th></tr><tr><td>9910301319550117</td><td>다른이름</td><td>스탠다드</td><td>2026-10-30</td><td>2026-10-31</td><td>100000</td><td>예약완료</td></tr></table>`;
 assert.equal(smartClipboardText(maskedCancelCard,html),maskedCancelCard);
 const p=maskedPreview(smartClipboardText(maskedCancelCard,html)); assert.equal(p.guestName,"김*지"); assert.equal(p.rowStatus,"cancel");
 assert.equal(smartClipboardText("",html),htmlTableToPlain(html));
 assert.equal(smartClipboardText("plain","<div>not a table</div>"),"plain");
});
test("판매금 뒤·공백 있는 취소도 인식하고 인접한 정상 예약·취소 규정은 혼동하지 않음",()=>{
 const moved=maskedCancelCard.replace("예약취소\n고객취소\n","")+"\n고객 취소\n입실완료";
 assert.equal(maskedPreview(moved).rowStatus,"cancel");
 const active=maskedCancelCard.replace("9910301319550117","9910301319550118").replace("김*지","이*나").replace("예약취소\n고객취소","예약완료").replace("REST쿠폰10_5","무료취소불가\n취소 규정: 당일 취소 불가");
 const ps=buildPreviewRows(parsePasteTable(moved+"\n"+active)!,profileById("yanolja")!,sourceSettings,[],"p-ya");
 assert.deepEqual(ps.map(p=>p.rowStatus),["cancel","ok"]); assert.deepEqual(ps.map(p=>p.guestName),["김*지","이*나"]);
});
test("미리보기 이름을 수정해도 가져온 이름을 메모에 보존하고 원문 취소 상태는 생성 방어",()=>{
 const p=maskedPreview(),d=pathADraftFromPreview({...p,guestName:"직원확인명",pasteCancel:false,rowStatus:"ok"},{platformId:"p-ya",platformLabel:"야놀자",id:"cx",nowIso:"2026-10-31T00:00:00Z"});
 assert.equal(d.guestName,"직원확인명"); assert.equal(d.status,"cancelled"); assert.match(d.memo!,/이름 김\*지/);
});
