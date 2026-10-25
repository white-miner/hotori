import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeSettings } from "./ledger.ts";
import {
  HYPOTHESIS_FIXTURES,
  PLATFORM_PROFILES,
  YANOLJA_DRAG_COPY_COLLAPSED_LINE_FIXTURE,
  YANOLJA_DRAG_COPY_HTML_FIXTURE,
  YANOLJA_DRAG_COPY_MULTISPACE_FIXTURE,
  YANOLJA_DRAG_COPY_SINGLE_SPACE_FIXTURE,
  YANOLJA_DRAG_COPY_VERTICAL_CELLS_FIXTURE,
  YANOLJA_UNIFIED_CARD_PASTE_FIXTURE_PATH,
  buildPreviewRows,
  detectProfile,
  findActiveBookingByReservationId,
  htmlTableToPlain,
  isCancelGuardBlocked,
  isCancelStatus,
  isDuplicateReservation,
  looksLikeYanoljaCardPaste,
  lookupTypeAlias,
  mapColumns,
  matchPlatformId,
  matchTypeId,
  normalizeRow,
  normTypeName,
  parseAmount,
  parseLooseDate,
  parseNightsCell,
  parsePasteTable,
  parseYanoljaCardPaste,
  profileById,
  removeTypeAlias,
  reservationIdFromMemo,
  reservationMemo,
  upsertTypeAlias,
} from "./smartRegister.ts";

const settings = normalizeSettings({
  platforms: [
    { id: "p-ya", name: "야놀자", abbr: "야" },
    { id: "p-ye", name: "여기어때", abbr: "여" },
    { id: "p-walk", name: "현장·전화", abbr: "현", onsite: true },
  ],
  types: [
    { id: "std", name: "스탠다드" },
    { id: "dlx", name: "디럭스" },
    { id: "ondol", name: "온돌" },
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
  assert.equal(preview[1]!.rowStatus, "cancel_missing");
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
    assert.equal(preview[1]!.rowStatus, "cancel_missing");
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
  assert.equal(preview[1]!.rowStatus, "cancel_missing");
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

test("yanolja normalize + preview: fields + cancel missing without match", () => {
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
  // cancel row, no Hotori match → info skip
  assert.equal(preview[1]!.rowStatus, "cancel_missing");
  assert.equal(preview[1]!.skip, true);
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

test("normTypeName: trim · collapse spaces · casefold", () => {
  assert.equal(normTypeName("  스탠다드\u00a0더블  "), "스탠다드 더블");
  assert.equal(normTypeName("Deluxe  Twin"), "deluxe twin");
  assert.equal(normTypeName("A\u200bB"), "ab");
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

test("seed profiles: active = yanolja+yeogi only (hypothesis fixtures)", () => {
  const active = PLATFORM_PROFILES.filter((p) => p.active).map((p) => p.id).sort();
  assert.deepEqual(active, ["yanolja", "yeogi"]);
});
