/**
 * 스마트 등록 — generic paste parser + platform profiles → Path A 미배정 fields.
 * No channel API · no OCR · profiles = data (alias tables), not per-channel forks.
 */
import {
  addDays,
  daysBetween,
  PLATFORM_TYPE_NAME_MAX,
  type Booking,
  type HotelSettings,
  type TypeAlias,
  typeLabel,
  usableTypes,
} from "./ledger";

/** Canonical paste fields (shared across platforms). */
export type PasteField =
  | "guestName"
  | "guestPhone"
  | "typeRaw"
  | "checkIn"
  | "checkOut"
  | "nights"
  | "amount"
  | "reservationId"
  | "statusRaw";

export type PlatformProfileId = "yanolja" | "yeogi" | "agoda" | "naver";

export interface PlatformProfile {
  id: PlatformProfileId;
  /** Display label (KR) */
  label: string;
  /** Keywords to match Settings platforms[].name / abbr */
  hotoriPlatformMatch: string[];
  headerAliases: Record<PasteField, string[]>;
  detectHints: string[];
  statusSkip: string[];
  version: number;
  /**
   * MVP: true when fixture/sample exists.
   * Inactive profiles stay in registry but never win auto-detect unless user picks chip.
   */
  active: boolean;
}

export const CANONICAL_FIELDS: PasteField[] = [
  "guestName",
  "guestPhone",
  "typeRaw",
  "checkIn",
  "checkOut",
  "nights",
  "amount",
  "reservationId",
  "statusRaw",
];

/** Shared / overlapping aliases (hypotheses until live samples). */
const COMMON: Record<PasteField, string[]> = {
  guestName: ["예약자", "게스트", "투숙객", "guest name", "booker", "고객명", "예약자명"],
  guestPhone: ["연락처", "휴대폰", "전화번호", "phone", "휴대전화", "휴대폰번호"],
  typeRaw: ["객실타입", "상품명", "룸타입", "room type", "객실명", "객실 타입", "상품"],
  checkIn: ["체크인", "입실", "check-in", "checkin", "이용일", "입실일", "체크인일"],
  checkOut: ["체크아웃", "퇴실", "check-out", "checkout", "퇴실일", "체크아웃일"],
  nights: ["박수", "숙박일수", "nights", "숙박일", "박"],
  amount: ["판매가", "결제금액", "판매금액", "amount", "total", "결제액", "판매금", "총금액"],
  reservationId: ["예약번호", "예약 id", "booking id", "confirmation", "예약id", "확인번호"],
  statusRaw: ["상태", "status", "예약상태", "예약 상태"],
};

function withCommon(extra: Partial<Record<PasteField, string[]>>): Record<PasteField, string[]> {
  const out = {} as Record<PasteField, string[]>;
  for (const f of CANONICAL_FIELDS) {
    out[f] = [...COMMON[f], ...(extra[f] ?? [])];
  }
  return out;
}

/** Seed profiles. Hypothesis fixtures mark yanolja + yeogi active; agoda/naver inactive until samples. */
export const PLATFORM_PROFILES: PlatformProfile[] = [
  {
    id: "yanolja",
    label: "야놀자",
    hotoriPlatformMatch: ["야놀자", "yanolja", "야"],
    headerAliases: withCommon({
      reservationId: ["야놀자예약번호", "yn예약번호"],
      typeRaw: ["객실상품"],
    }),
    detectHints: ["야놀자", "yanolja"],
    statusSkip: ["예약취소", "고객취소", "취소", "취소완료", "노쇼", "no-show", "noshow", "환불"],
    version: 1,
    active: true,
  },
  {
    id: "yeogi",
    label: "여기어때",
    hotoriPlatformMatch: ["여기어때", "goodchoice", "여"],
    headerAliases: withCommon({
      reservationId: ["여기어때예약번호", "gc예약번호"],
      typeRaw: ["룸네임", "룸 타입"],
    }),
    detectHints: ["여기어때", "goodchoice", "yeogi"],
    statusSkip: ["예약취소", "고객취소", "취소", "취소완료", "노쇼", "no-show", "noshow", "환불"],
    version: 1,
    active: true,
  },
  {
    id: "agoda",
    label: "아고다",
    hotoriPlatformMatch: ["아고다", "agoda", "아"],
    headerAliases: withCommon({
      guestName: ["guest name", "booker name"],
      reservationId: ["booking id", "confirmation number"],
    }),
    detectHints: ["agoda", "아고다"],
    statusSkip: ["cancelled", "canceled", "no-show", "취소"],
    version: 1,
    active: false,
  },
  {
    id: "naver",
    label: "네이버",
    hotoriPlatformMatch: ["네이버", "naver", "네", "스마트플레이스"],
    headerAliases: withCommon({
      reservationId: ["네이버예약번호", "예약 번호"],
    }),
    detectHints: ["네이버", "naver", "스마트플레이스"],
    statusSkip: ["취소", "노쇼", "방문안함"],
    version: 1,
    active: false,
  },
];

export function profileById(id: string | null | undefined): PlatformProfile | undefined {
  return PLATFORM_PROFILES.find((p) => p.id === id);
}

export function activeProfiles(): PlatformProfile[] {
  return PLATFORM_PROFILES.filter((p) => p.active);
}

/** Normalize header for alias match. */
export function normHeader(h: string): string {
  return h
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\u00a0\u200b]/g, "")
    .toLowerCase();
}

function aliasHit(header: string, aliases: string[]): boolean {
  const h = normHeader(header);
  if (!h) return false;
  return aliases.some((a) => {
    const n = normHeader(a);
    return n === h || h.includes(n) || n.includes(h);
  });
}

export interface ParsedPasteTable {
  headers: string[];
  rows: string[][];
  delimiter: "tab" | "comma" | "pipe" | "space";
}

/** Partner UI chrome / toolbar lines that are not table rows (야놀자 통합내역 등). */
const PASTE_JUNK_LINE =
  /^(필터|조회|검색|합계|총\s*\d|엑셀|다운로드|인쇄|페이지|목록\s*\d|전체\s*선택|선택\s*삭제|초기화|더보기|닫기|확인|취소하기|정렬|기간|건수)/i;

/** Flatten known header aliases for header-row scoring. */
function allHeaderAliasNorms(): string[] {
  const out = new Set<string>();
  for (const f of CANONICAL_FIELDS) {
    for (const a of COMMON[f]) out.add(normHeader(a));
  }
  for (const p of PLATFORM_PROFILES) {
    for (const f of CANONICAL_FIELDS) {
      for (const a of p.headerAliases[f]) out.add(normHeader(a));
    }
  }
  return [...out];
}

function stripHtmlNoise(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convert clipboard `text/html` table markup → TSV plain text.
 * Works in Node (no DOM) so unit tests can cover partner HTML paste.
 */
export function htmlTableToPlain(html: string): string | null {
  if (!html || !/<table[\s>]/i.test(html)) return null;
  const tableMatch = html.match(/<table\b[\s\S]*?<\/table>/i);
  if (!tableMatch) return null;
  const table = tableMatch[0];
  const rowMatches = [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)];
  if (rowMatches.length < 2) return null;
  const lines: string[] = [];
  for (const rm of rowMatches) {
    const cells = [...rm[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)];
    if (!cells.length) continue;
    const parts = cells.map((c) => stripHtmlNoise(c[1] ?? "")).filter((c) => c.length > 0 || cells.length > 1);
    if (!parts.some((p) => p.length > 0)) continue;
    lines.push(parts.join("\t"));
  }
  if (lines.length < 2) return null;
  return lines.join("\n");
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      q = !q;
      continue;
    }
    if (ch === "," && !q) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function splitByDelimiter(line: string, delimiter: ParsedPasteTable["delimiter"], singleSpace = false): string[] {
  if (delimiter === "space") {
    const re = singleSpace ? /\s+/ : /\s{2,}/;
    return line.trim().split(re).map((c) => c.trim()).filter((c) => c.length > 0);
  }
  if (delimiter === "comma") return splitCsvLine(line);
  if (delimiter === "pipe") return line.split("|").map((c) => c.trim());
  return line.split("\t").map((c) => c.trim());
}

function spaceColCount(line: string): number {
  return line.trim().split(/\s{2,}/).filter((c) => c.trim().length > 0).length;
}

function singleSpaceCells(line: string): string[] {
  return line.trim().split(/\s+/).filter((c) => c.length > 0);
}

function pickDelimiter(lines: string[]): ParsedPasteTable["delimiter"] {
  const sample = lines.slice(0, Math.min(12, lines.length));
  const scoreDelim = (pred: (l: string) => number) =>
    sample.reduce((n, l) => n + (pred(l) > 1 ? 1 : 0), 0);

  const tabScore = scoreDelim((l) => l.split("\t").length);
  const pipeScore = scoreDelim((l) => l.split("|").length);
  const commaScore = scoreDelim((l) => splitCsvLine(l).length);
  const spaceScore = scoreDelim(spaceColCount);

  const ranked: { d: ParsedPasteTable["delimiter"]; n: number }[] = [
    { d: "tab", n: tabScore },
    { d: "pipe", n: pipeScore },
    { d: "comma", n: commaScore },
    { d: "space", n: spaceScore },
  ];
  ranked.sort((a, b) => b.n - a.n);
  const best = ranked[0];
  if (best && best.n > 0) return best.d;
  return "space";
}

function isAliasCell(cell: string, aliasNorms: string[]): boolean {
  const h = normHeader(cell);
  if (!h) return false;
  return aliasNorms.some((a) => a === h || h.includes(a) || a.includes(h));
}

function headerAliasHits(cells: string[], aliasNorms: string[]): number {
  let hits = 0;
  for (const cell of cells) {
    if (isAliasCell(cell, aliasNorms)) hits += 1;
  }
  return hits;
}

/** Yanolja/OTA reservation-id-ish tokens used as row start anchors. */
const RESERVATION_ID_ANCHOR = /^(?:[A-Za-z]{1,8}-)?\d{4,}[A-Za-z0-9-]*$/;

function isReservationAnchor(cell: string): boolean {
  const t = cell.trim();
  if (!t || t.length > 32) return false;
  return RESERVATION_ID_ANCHOR.test(t);
}

function isJunkPasteLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (PASTE_JUNK_LINE.test(t)) return true;
  // lone toolbar / filter crumbs with no table shape
  if (!/\t/.test(t) && spaceColCount(t) < 2 && !t.includes(",") && !t.includes("|")) {
    // keep short single tokens that might still be weird — drop chrome-ish
    if (/^(필터|합계|조회기간|검색조건|예약목록)$/i.test(t)) return true;
  }
  return false;
}

/** True when drag-copy yielded one cell per line (few/no multi-col rows). */
function looksVerticalCellPaste(lines: string[]): boolean {
  if (lines.length < 6) return false;
  let multi = 0;
  let single = 0;
  for (const l of lines) {
    if (/\t/.test(l) || l.includes("|") || spaceColCount(l) >= 2 || splitCsvLine(l).length >= 3) multi += 1;
    else if (singleSpaceCells(l).length === 1) single += 1;
  }
  return multi <= 1 && single >= Math.max(6, Math.floor(lines.length * 0.7));
}

/**
 * Reassemble vertical (one-cell-per-line) paste into TSV lines.
 * Header = longest consecutive alias run (≥3); body chunked by that width,
 * preferring 예약번호-style anchors when present.
 */
function reassembleVerticalToTsv(lines: string[], aliasNorms: string[]): string[] | null {
  const tokens = lines.map((l) => l.trim()).filter((t) => t.length > 0);
  if (tokens.length < 6) return null;

  let bestStart = -1;
  let bestLen = 0;
  let i = 0;
  while (i < tokens.length) {
    if (!isAliasCell(tokens[i]!, aliasNorms)) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < tokens.length && isAliasCell(tokens[j]!, aliasNorms)) j += 1;
    const len = j - i;
    if (len > bestLen) {
      bestLen = len;
      bestStart = i;
    }
    i = j;
  }
  if (bestStart < 0 || bestLen < 3) return null;

  const headers = tokens.slice(bestStart, bestStart + bestLen);
  const body = tokens.slice(bestStart + bestLen);
  if (body.length < bestLen) return null;

  const width = headers.length;
  const rows: string[][] = [];
  const anchors = body
    .map((t, idx) => (isReservationAnchor(t) ? idx : -1))
    .filter((idx) => idx >= 0);

  if (anchors.length >= 1 && anchors.every((a, k) => k === 0 || a - anchors[k - 1]! === width)) {
    for (const a of anchors) {
      const chunk = body.slice(a, a + width);
      if (chunk.length === width) rows.push(chunk);
    }
  } else {
    for (let k = 0; k + width <= body.length; k += width) {
      rows.push(body.slice(k, k + width));
    }
  }
  if (!rows.length) return null;
  return [headers.join("\t"), ...rows.map((r) => r.join("\t"))];
}

/**
 * Collapse a single giant line into TSV when header aliases form a contiguous token run.
 */
function reassembleCollapsedToTsv(line: string, aliasNorms: string[]): string[] | null {
  const tokens = singleSpaceCells(line);
  if (tokens.length < 8) return null;

  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (!isAliasCell(tokens[i]!, aliasNorms)) continue;
    let j = i;
    while (j < tokens.length && isAliasCell(tokens[j]!, aliasNorms)) j += 1;
    const len = j - i;
    if (len > bestLen) {
      bestLen = len;
      bestStart = i;
    }
    i = j - 1;
  }
  if (bestStart < 0 || bestLen < 3) return null;

  const headers = tokens.slice(bestStart, bestStart + bestLen);
  const body = tokens.slice(bestStart + bestLen);
  const width = headers.length;
  if (body.length < width) return null;

  const rows: string[][] = [];
  const anchors = body
    .map((t, idx) => (isReservationAnchor(t) ? idx : -1))
    .filter((idx) => idx >= 0);
  if (anchors.length >= 1 && anchors.every((a, k) => k === 0 || a - anchors[k - 1]! === width)) {
    for (const a of anchors) {
      const chunk = body.slice(a, a + width);
      if (chunk.length === width) rows.push(chunk);
    }
  } else if (body.length % width === 0) {
    for (let k = 0; k < body.length; k += width) rows.push(body.slice(k, k + width));
  }
  if (!rows.length) return null;
  return [headers.join("\t"), ...rows.map((r) => r.join("\t"))];
}

/**
 * Single-space columns when 2+ space delim fails but token count matches a strong header alias set.
 * Hypothesis: partner drag-copy often uses one space between cells (names without spaces).
 */
function trySingleSpaceParse(lines: string[], aliasNorms: string[]): ParsedPasteTable | null {
  let headerIdx = -1;
  let bestHits = -1;
  let headerCells: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const cells = singleSpaceCells(lines[i]!);
    if (cells.length < 3) continue;
    const hits = headerAliasHits(cells, aliasNorms);
    if (hits >= 3 && hits > bestHits) {
      bestHits = hits;
      headerIdx = i;
      headerCells = cells;
    }
  }
  if (headerIdx < 0 || headerCells.length < 3) return null;

  const width = headerCells.length;
  const rows = lines
    .slice(headerIdx + 1)
    .map(singleSpaceCells)
    .filter((r) => r.length === width || (r.length >= Math.min(3, width) && Math.abs(r.length - width) <= 1))
    .map((r) => (r.length === width ? r : r.length > width ? r.slice(0, width) : r));
  const exact = rows.filter((r) => r.length === width);
  if (!exact.length) return null;
  return { headers: headerCells, rows: exact, delimiter: "space" };
}

function finishTable(
  lines: string[],
  delimiter: ParsedPasteTable["delimiter"],
  aliasNorms: string[],
  singleSpace = false,
): ParsedPasteTable | null {
  const splitLine = (line: string) => splitByDelimiter(line, delimiter, singleSpace);

  let headerIdx = -1;
  let bestHits = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const cells = splitLine(lines[i]!);
    if (cells.length < 2) continue;
    const hits = headerAliasHits(cells, aliasNorms);
    if (hits > bestHits) {
      bestHits = hits;
      headerIdx = i;
    }
    if (hits >= 3) break;
  }
  if (headerIdx < 0) {
    for (let i = 0; i < lines.length; i++) {
      if (splitLine(lines[i]!).length >= 2) {
        headerIdx = i;
        break;
      }
    }
  }
  if (headerIdx < 0) return null;

  const headers = splitLine(lines[headerIdx]!);
  if (headers.length < 2) return null;

  const rows = lines
    .slice(headerIdx + 1)
    .map(splitLine)
    .filter((r) => r.some((c) => c.length > 0))
    .filter((r) => r.length >= Math.min(3, headers.length) || r.length === headers.length);
  if (!rows.length) return null;
  return { headers, rows, delimiter };
}

/** 야놀자 통합내역 card: reservation id = long digit-only line. */
const YANOLJA_CARD_RES_ID = /^\d{10,}$/;

const YANOLJA_CARD_HEADERS = [
  "야놀자예약번호",
  "예약자",
  "연락처",
  "객실상품",
  "체크인",
  "체크아웃",
  "박수",
  "판매금액",
  "상태",
] as const;

function normalizePasteLine(line: string): string {
  return line.replace(/[\u200b\u200c\u200d\ufeff\u00a0]/g, "").trim();
}

/**
 * True for 야놀자 파트너 「통합내역」 drag-copy: vertical card stack
 * (one field per line, blocks split by long digit reservation ids) — not TSV.
 */
export function looksLikeYanoljaCardPaste(text: string): boolean {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(normalizePasteLine);
  const ids = lines.filter((l) => YANOLJA_CARD_RES_ID.test(l));
  if (ids.length < 1) return false;
  // Real TSV/multi-col table wins over card heuristics
  if (lines.some((l) => l.split("\t").length >= 4)) return false;
  const blob = lines.join("\n");
  const hasNights = /\/\s*\d+\s*박/.test(blob);
  const hasSale = /판매가/.test(blob);
  const hasStatus = /예약완료|예약취소|미리예약/.test(blob);
  const hasTypeId = /객실\s*타입\s*ID/.test(blob);
  return (hasNights || hasSale) && (hasStatus || hasTypeId);
}

/** Parse one card block (starts with reservation id) → synthetic table row. */
function parseYanoljaCardBlock(blockLines: string[]): string[] | null {
  const lines = blockLines.map(normalizePasteLine).filter((l) => l.length > 0);
  if (!lines.length || !YANOLJA_CARD_RES_ID.test(lines[0]!)) return null;

  const reservationId = lines[0]!;
  let i = 1;
  const guestName = lines[i++] ?? "";

  let guestPhone = "";
  if (i < lines.length) {
    const phoneOrSafe = lines[i]!;
    if (/안심번호/.test(phoneOrSafe)) {
      guestPhone = "";
      i += 1;
    } else if (/^[\d+\-]+$/.test(phoneOrSafe) || /^0\d/.test(phoneOrSafe)) {
      guestPhone = phoneOrSafe;
      i += 1;
    }
  }

  if (i < lines.length && /^(차량|도보)$/.test(lines[i]!)) i += 1;

  let typeRaw = "";
  while (i < lines.length) {
    const l = lines[i]!;
    if (/객실\s*타입\s*ID/.test(l)) {
      i += 1;
      break;
    }
    if (/^숙박$/.test(l) || /^\/\s*\d+\s*박/.test(l) || /^\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(l)) break;
    if (!typeRaw) typeRaw = l;
    i += 1;
  }

  let nights = "";
  while (i < lines.length) {
    const l = lines[i]!;
    const nm = l.match(/\/\s*(\d+)\s*박/);
    if (nm) {
      nights = nm[1]!;
      i += 1;
      continue;
    }
    if (/^(숙박|연박)$/.test(l)) {
      i += 1;
      continue;
    }
    break;
  }

  const dates: string[] = [];
  while (i < lines.length && dates.length < 2) {
    const l = lines[i]!;
    if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(l)) {
      dates.push(l);
      i += 1;
      continue;
    }
    break;
  }

  // created datetime · 미리예약 (stay dates already taken above)
  while (i < lines.length) {
    const l = lines[i]!;
    if (l === "미리예약" || /^\d{4}[./-]/.test(l) || /^\d{1,2}:\d{2}/.test(l)) {
      i += 1;
      continue;
    }
    break;
  }

  /**
   * Status scan until 판매가 / next reservation id.
   * Cancel wins over any 예약완료 (incl. checkbox / 특·직접관리 UI chrome) and over
   * trailing footer (입실완료 · 입실 호수 · 실제 입실).
   * Recognize 예약취소 · 고객취소 · same-line / combined forms.
   */
  let statusRaw = "";
  let sawCancel = false;
  let sawComplete = false;
  while (i < lines.length) {
    const l = lines[i]!;
    if (/^판매가/.test(l) || YANOLJA_CARD_RES_ID.test(l)) break;
    if (/예약취소|고객취소/.test(l)) sawCancel = true;
    else if (/예약완료/.test(l)) sawComplete = true;
    // chrome footer is never a stay/status — skip past, keep scanning for cancel/sale
    if (/^(입실완료|입실\s*호수|실제\s*입실)/.test(l)) {
      i += 1;
      continue;
    }
    i += 1;
  }
  if (sawCancel) statusRaw = "예약취소";
  else if (sawComplete) statusRaw = "예약완료";

  let amount = "";
  while (i < lines.length) {
    const l = lines[i]!;
    const am = l.match(/판매가\s*([\d,]+)\s*원/);
    if (am) {
      amount = am[1]!.replace(/,/g, "");
      break;
    }
    if (YANOLJA_CARD_RES_ID.test(l)) break;
    i += 1;
  }

  return [
    reservationId,
    guestName,
    guestPhone,
    typeRaw,
    dates[0] ?? "",
    dates[1] ?? "",
    nights,
    amount,
    statusRaw,
  ];
}

/**
 * 야놀자 통합내역 vertical card paste → synthetic TSV table
 * (headers match yanolja profile aliases so detect/map reuse Path A).
 */
export function parseYanoljaCardPaste(raw: string): ParsedPasteTable | null {
  if (!looksLikeYanoljaCardPaste(raw)) return null;
  const lines = raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(normalizePasteLine);

  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (YANOLJA_CARD_RES_ID.test(lines[i]!)) starts.push(i);
  }
  if (!starts.length) return null;

  const rows: string[][] = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s]!;
    const to = s + 1 < starts.length ? starts[s + 1]! : lines.length;
    const row = parseYanoljaCardBlock(lines.slice(from, to));
    if (row) rows.push(row);
  }
  if (!rows.length) return null;
  return { headers: [...YANOLJA_CARD_HEADERS], rows, delimiter: "tab" };
}

/**
 * Split clipboard text into header + body rows.
 * Intake pipeline: prefer HTML table → **야놀자 card stack** → normalize lines →
 * vertical/collapsed reassembly → tab/pipe/comma/2+ spaces → single-space
 * fallback when column count matches header aliases.
 */
export function parsePasteTable(raw: string): ParsedPasteTable | null {
  let text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return null;

  // HTML table pasted into textarea (or fed from onPaste) → TSV
  if (/<table[\s>]/i.test(text)) {
    const fromHtml = htmlTableToPlain(text);
    if (fromHtml) text = fromHtml;
  }

  // 야놀자 통합내역 drag-copy SoT: vertical card stack (not TSV)
  const card = parseYanoljaCardPaste(text);
  if (card) return card;

  const aliasNorms = allHeaderAliasNorms();
  let rawLines = text.split("\n").map((l) => l.trimEnd());
  let lines = rawLines.filter((l) => l.trim().length > 0 && !isJunkPasteLine(l));
  if (!lines.length) return null;

  // One giant line (newlines collapsed) → tokenize + reassemble
  if (lines.length === 1) {
    const rebuilt = reassembleCollapsedToTsv(lines[0]!, aliasNorms);
    if (rebuilt) lines = rebuilt;
  } else if (looksVerticalCellPaste(lines)) {
    const rebuilt = reassembleVerticalToTsv(lines, aliasNorms);
    if (rebuilt) lines = rebuilt;
  }

  if (lines.length < 2) return null;

  const delimiter = pickDelimiter(lines);
  const primary = finishTable(lines, delimiter, aliasNorms, false);
  if (primary) return primary;

  // Fallback: single-space columns when 2+ space / other delims yield no table
  const single = trySingleSpaceParse(lines, aliasNorms);
  if (single) return single;

  // Last try: force single-space split through finishTable
  if (delimiter === "space") {
    const forced = finishTable(lines, "space", aliasNorms, true);
    if (forced) return forced;
  }
  return null;
}

export interface DetectResult {
  profileId: PlatformProfileId | null;
  score: number;
  runnerUpScore: number;
  /** true when margin is clear enough for silent pick */
  confident: boolean;
  scores: { id: PlatformProfileId; score: number }[];
}

const DETECT_MARGIN = 2;
const DETECT_MIN = 3;

/** Score profiles against headers (+ optional body blob for hints). */
export function detectProfile(headers: string[], bodyText = "", opts?: { allowInactive?: boolean }): DetectResult {
  const pool = opts?.allowInactive ? PLATFORM_PROFILES : activeProfiles();
  const blob = normHeader(bodyText);
  const scores = pool.map((p) => {
    let score = 0;
    for (const f of CANONICAL_FIELDS) {
      const aliases = p.headerAliases[f];
      const extras = aliases.filter((a) => !COMMON[f].some((c) => normHeader(c) === normHeader(a)));
      if (headers.some((h) => aliasHit(h, aliases))) score += 1;
      // Profile-specific aliases break ties between overlapping OTA tables
      if (extras.length && headers.some((h) => aliasHit(h, extras))) score += 3;
    }
    for (const hint of p.detectHints) {
      const n = normHeader(hint);
      if (headers.some((h) => normHeader(h).includes(n)) || blob.includes(n)) score += 2;
    }
    return { id: p.id, score };
  });
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];
  const score = best?.score ?? 0;
  const runnerUpScore = second?.score ?? 0;
  const confident = !!best && score >= DETECT_MIN && score - runnerUpScore >= DETECT_MARGIN;
  return {
    profileId: confident ? best!.id : null,
    score,
    runnerUpScore,
    confident,
    scores,
  };
}

/** Map header index → canonical field for a profile. */
export function mapColumns(headers: string[], profile: PlatformProfile): Partial<Record<PasteField, number>> {
  const map: Partial<Record<PasteField, number>> = {};
  const used = new Set<number>();
  for (const f of CANONICAL_FIELDS) {
    const idx = headers.findIndex((h, i) => !used.has(i) && aliasHit(h, profile.headerAliases[f]));
    if (idx >= 0) {
      map[f] = idx;
      used.add(idx);
    }
  }
  return map;
}

export interface NormalizedPasteRow {
  guestName: string;
  guestPhone: string;
  typeRaw: string;
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  amount: number | null;
  reservationId: string;
  statusRaw: string;
  /**
   * Paste status matches profile.statusSkip (취소/노쇼/cancelled…).
   * Formerly blind-skip; MVP routes to cancel sync when 예약번호 matches Hotori.
   */
  isCancelStatus: boolean;
  /** @deprecated alias of isCancelStatus — kept for older call sites/tests */
  skipSuggested: boolean;
  /** Inclusive “N일” style nights that need preview highlight */
  nightsInclusiveSuspect: boolean;
}

/** Parse loose KR/EN date → YYYY-MM-DD or null. */
export function parseLooseDate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const iso = t.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (iso) {
    const y = iso[1]!;
    const m = iso[2]!.padStart(2, "0");
    const d = iso[3]!.padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const mdY = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (mdY) {
    let y = mdY[3]!;
    if (y.length === 2) y = `20${y}`;
    const m = mdY[1]!.padStart(2, "0");
    const d = mdY[2]!.padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const kr = t.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (kr) {
    return `${kr[1]}-${kr[2]!.padStart(2, "0")}-${kr[3]!.padStart(2, "0")}`;
  }
  return null;
}

export function parseAmount(raw: string): number | null {
  const t = raw.replace(/[₩원,\s]/g, "").replace(/원$/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function parseNightsCell(raw: string): { nights: number | null; inclusiveSuspect: boolean } {
  const t = raw.trim();
  if (!t) return { nights: null, inclusiveSuspect: false };
  const m = t.match(/(\d+)\s*(박|일|nights?|days?)?/i);
  if (!m) return { nights: null, inclusiveSuspect: false };
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return { nights: null, inclusiveSuspect: false };
  const unit = (m[2] ?? "").toLowerCase();
  const inclusiveSuspect = unit === "일" || unit === "day" || unit === "days";
  // hotel-night: “N일” often means inclusive calendar days → nights = N-1 when N>1
  if (inclusiveSuspect && n > 1) return { nights: n - 1, inclusiveSuspect: true };
  return { nights: n, inclusiveSuspect };
}

export function cellAt(row: string[], idx: number | undefined): string {
  if (idx === undefined || idx < 0 || idx >= row.length) return "";
  return (row[idx] ?? "").trim();
}

export function normalizeRow(
  row: string[],
  colMap: Partial<Record<PasteField, number>>,
  profile: PlatformProfile,
): NormalizedPasteRow {
  const guestName = cellAt(row, colMap.guestName);
  const guestPhone = cellAt(row, colMap.guestPhone);
  const typeRaw = cellAt(row, colMap.typeRaw);
  const checkIn = parseLooseDate(cellAt(row, colMap.checkIn));
  const checkOut = parseLooseDate(cellAt(row, colMap.checkOut));
  const nightsCell = parseNightsCell(cellAt(row, colMap.nights));
  let nights = nightsCell.nights;
  let nightsInclusiveSuspect = nightsCell.inclusiveSuspect;
  if (checkIn && checkOut) {
    const diff = daysBetween(checkIn, checkOut);
    if (diff > 0) {
      if (nights == null) nights = diff;
      else if (nights !== diff) {
        // prefer checkout−checkIn (hotel-night SoT); flag if paste nights looked inclusive
        if (nights === diff + 1) nightsInclusiveSuspect = true;
        nights = diff;
      }
    }
  }
  const amount = parseAmount(cellAt(row, colMap.amount));
  const reservationId = cellAt(row, colMap.reservationId);
  const statusRaw = cellAt(row, colMap.statusRaw);
  const cancel = isCancelStatus(statusRaw, profile);

  return {
    guestName,
    guestPhone,
    typeRaw,
    checkIn,
    checkOut,
    nights,
    amount,
    reservationId,
    statusRaw,
    isCancelStatus: cancel,
    skipSuggested: cancel,
    nightsInclusiveSuspect,
  };
}

/** True when paste statusRaw hits profile.statusSkip tokens (예약취소/고객취소/cancelled/노쇼…). */
export function isCancelStatus(statusRaw: string, profile: PlatformProfile): boolean {
  const statusN = normHeader(statusRaw);
  if (!statusN) return false;
  // Trailing partner chrome must never count as active stay / non-cancel
  if (/^입실완료$|^입실\s*호수$|^실제\s*입실/.test(statusN)) return false;
  return profile.statusSkip.some((s) => statusN.includes(normHeader(s)) || normHeader(s) === statusN);
}

/** Arrived or already checked-out — never silent-cancel from paste. */
export function isCancelGuardBlocked(b: Pick<Booking, "arrived" | "checkedOutAt">): boolean {
  return !!b.arrived || !!b.checkedOutAt;
}

export type BookingReservationPick = Pick<
  Booking,
  "id" | "platformId" | "memo" | "status" | "arrived" | "checkedOutAt" | "guestName" | "checkIn" | "nights" | "typeId"
>;

/** Active Hotori booking for platform + 예약번호 (memo convention). */
export function findActiveBookingByReservationId(
  existing: BookingReservationPick[],
  platformId: string,
  reservationId: string,
): BookingReservationPick | null {
  const id = reservationId.trim();
  if (!id || !platformId) return null;
  return (
    existing.find(
      (b) =>
        b.status === "active" &&
        b.platformId === platformId &&
        reservationIdFromMemo(b.memo) === id,
    ) ?? null
  );
}

/** True when same platform+예약번호 already exists as cancelled (no-op 중복스킵). */
export function isAlreadyCancelledReservation(
  existing: Pick<Booking, "platformId" | "memo" | "status">[],
  platformId: string,
  reservationId: string,
): boolean {
  const id = reservationId.trim();
  if (!id || !platformId) return false;
  return existing.some(
    (b) =>
      b.status === "cancelled" &&
      b.platformId === platformId &&
      reservationIdFromMemo(b.memo) === id,
  );
}

/** Fields required to create Path A (미배정) cancel or 신규 row. */
export function previewNeedsFix(row: {
  guestName: string;
  checkIn: string | null;
  nights: number | null;
  typeId: string | null;
}): boolean {
  return !row.guestName.trim() || !row.checkIn || !row.nights || row.nights < 1 || !row.typeId;
}

/**
 * Normalize OTA / platform type name for alias match.
 * trim · collapse spaces · strip ZWSP/NBSP · casefold (KR-friendly via toLowerCase).
 */
export function normTypeName(raw: string): string {
  return raw
    .trim()
    .replace(/[\u00a0\u202f]/g, " ") // NBSP / NNBSP → space
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "") // zero-width / BOM strip
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Exact alias lookup: platformId + normalized name → typeId (if type still usable). */
export function lookupTypeAlias(
  aliases: TypeAlias[] | undefined,
  platformId: string | null | undefined,
  platformTypeName: string,
  typeIds?: ReadonlySet<string>,
): string | null {
  if (!platformId || !aliases?.length) return null;
  const key = normTypeName(platformTypeName);
  if (!key) return null;
  for (let i = aliases.length - 1; i >= 0; i--) {
    const a = aliases[i]!;
    if (a.platformId !== platformId) continue;
    if (normTypeName(a.platformTypeName) !== key) continue;
    if (typeIds && !typeIds.has(a.typeId)) return null;
    return a.typeId;
  }
  return null;
}

/** Insert or replace alias for (platformId, normalized name). */
export function upsertTypeAlias(
  aliases: TypeAlias[],
  entry: { id?: string; platformId: string; platformTypeName: string; typeId: string },
  newId: () => string,
): TypeAlias[] {
  const name = entry.platformTypeName.trim().slice(0, PLATFORM_TYPE_NAME_MAX);
  const key = normTypeName(name);
  if (!key || !entry.platformId || !entry.typeId) return aliases;
  const next = aliases.filter(
    (a) => !(a.platformId === entry.platformId && normTypeName(a.platformTypeName) === key),
  );
  next.push({
    id: entry.id ?? newId(),
    platformId: entry.platformId,
    platformTypeName: name,
    typeId: entry.typeId,
  });
  return next;
}

export function removeTypeAlias(aliases: TypeAlias[], id: string): TypeAlias[] {
  return aliases.filter((a) => a.id !== id);
}

/**
 * Resolve OTA type string → hotel typeId.
 * Order: **1) hotel type alias (platform)** → **2) fuzzy heuristics**.
 */
export function matchTypeId(
  typeRaw: string,
  s: HotelSettings,
  platformId?: string | null,
): string | null {
  const raw = typeRaw.trim();
  if (!raw) return null;
  const types = usableTypes(s.types).filter((t) => typeLabel(t));
  const usableIds = new Set(types.map((t) => t.id));

  const aliased = lookupTypeAlias(s.typeAliases, platformId, raw, usableIds);
  if (aliased) return aliased;

  const n = normTypeName(raw);
  // exact label
  for (const t of types) {
    if (normTypeName(typeLabel(t)) === n) return t.id;
  }
  // includes either way
  let best: { id: string; score: number } | null = null;
  for (const t of types) {
    const lab = normTypeName(typeLabel(t));
    if (!lab) continue;
    let score = 0;
    if (n.includes(lab) || lab.includes(n)) score = Math.min(n.length, lab.length);
    if (score > 0 && (!best || score > best.score)) best = { id: t.id, score };
  }
  return best?.id ?? null;
}

/** Match profile → Settings platform id. */
export function matchPlatformId(profile: PlatformProfile, s: HotelSettings): string | null {
  const plats = s.platforms ?? [];
  for (const kw of profile.hotoriPlatformMatch) {
    const n = normHeader(kw);
    const hit = plats.find((p) => {
      const name = normHeader(p.name ?? "");
      const abbr = normHeader(p.abbr ?? "");
      return name.includes(n) || n.includes(name) || abbr === n;
    });
    if (hit) return hit.id;
  }
  return null;
}

/** Memo format for Path A mount + dedupe. */
export function reservationMemo(platformLabel: string, reservationId: string, typeRaw?: string): string {
  const id = reservationId.trim();
  const base = id ? `${platformLabel} 예약번호 ${id}` : `${platformLabel} 붙여넣기`;
  const extra = typeRaw?.trim() ? ` · ${typeRaw.trim()}` : "";
  return base + extra;
}

/** Extract reservation id from memo written by smart register / same convention. */
export function reservationIdFromMemo(memo: string | null | undefined): string | null {
  if (!memo) return null;
  const m = memo.match(/예약번호\s+(\S+)/);
  return m?.[1] ?? null;
}

export function isDuplicateReservation(
  existing: Pick<Booking, "platformId" | "memo" | "status">[],
  platformId: string,
  reservationId: string,
): boolean {
  const id = reservationId.trim();
  if (!id) return false;
  return existing.some(
    (b) =>
      b.status !== "cancelled" &&
      b.platformId === platformId &&
      reservationIdFromMemo(b.memo) === id,
  );
}

/**
 * Preview action labels (KR):
 * ok → 신규 · cancel → 예약취소 · dup → 중복스킵 · need_fix → 수정필요
 * skip → 건너뜀 (입실/퇴실 가드 등)
 * cancel_missing — legacy unused (no-match now creates cancelled Path A)
 */
export type PreviewRowStatus = "ok" | "need_fix" | "skip" | "dup" | "cancel" | "cancel_missing";

export interface PreviewRow {
  key: string;
  sourceIndex: number;
  guestName: string;
  guestPhone: string;
  typeRaw: string;
  typeId: string | null;
  checkIn: string | null;
  nights: number | null;
  amount: number | null;
  priceUnset: boolean;
  reservationId: string;
  statusRaw: string;
  skip: boolean;
  nightsInclusiveSuspect: boolean;
  dup: boolean;
  /** Paste row is a cancel/noshow status */
  pasteCancel: boolean;
  /** Matched Hotori booking id for cancel sync */
  matchBookingId: string | null;
  /** Matched booking is arrived or checked-out — danger / default skip */
  cancelGuard: boolean;
  rowStatus: PreviewRowStatus;
}

export function buildPreviewRows(
  table: ParsedPasteTable,
  profile: PlatformProfile,
  s: HotelSettings,
  existing: BookingReservationPick[] | Pick<Booking, "platformId" | "memo" | "status">[],
  platformId: string | null,
): PreviewRow[] {
  const colMap = mapColumns(table.headers, profile);
  const list = existing as BookingReservationPick[];
  return table.rows.map((row, i) => {
    const n = normalizeRow(row, colMap, profile);
    const typeId = matchTypeId(n.typeRaw, s, platformId);
    const pasteCancel = n.isCancelStatus;
    const match =
      pasteCancel && platformId && n.reservationId
        ? findActiveBookingByReservationId(list, platformId, n.reservationId)
        : null;
    const cancelGuard = !!match && isCancelGuardBlocked(match);
    const alreadyCancelled =
      pasteCancel &&
      !match &&
      !!platformId &&
      !!n.reservationId.trim() &&
      isAlreadyCancelledReservation(list, platformId, n.reservationId);
    const dup =
      alreadyCancelled ||
      (!pasteCancel &&
        !!platformId &&
        !!n.reservationId &&
        isDuplicateReservation(list, platformId, n.reservationId));

    let skip = false;
    let rowStatus: PreviewRowStatus = "ok";
    let matchBookingId: string | null = null;

    if (pasteCancel) {
      if (match) {
        if (cancelGuard) {
          // Default block — FO must un-skip; mount still uses danger askConfirm
          skip = true;
          rowStatus = "skip";
          matchBookingId = match.id;
        } else {
          skip = false;
          rowStatus = "cancel";
          matchBookingId = match.id;
        }
      } else if (alreadyCancelled) {
        skip = true;
        rowStatus = "dup";
        matchBookingId = null;
      } else if (previewNeedsFix({ guestName: n.guestName, checkIn: n.checkIn, nights: n.nights, typeId })) {
        // No Hotori match → create Path A cancelled once fields OK
        skip = false;
        rowStatus = "need_fix";
        matchBookingId = null;
      } else {
        skip = false;
        rowStatus = "cancel";
        matchBookingId = null;
      }
    } else if (dup) {
      skip = true;
      rowStatus = "dup";
    } else {
      skip = false;
      rowStatus = previewNeedsFix({ guestName: n.guestName, checkIn: n.checkIn, nights: n.nights, typeId })
        ? "need_fix"
        : "ok";
    }

    return {
      key: `r${i}`,
      sourceIndex: i,
      guestName: n.guestName,
      guestPhone: n.guestPhone,
      typeRaw: n.typeRaw,
      typeId,
      checkIn: n.checkIn,
      nights: n.nights,
      amount: n.amount,
      priceUnset: n.amount == null,
      reservationId: n.reservationId,
      statusRaw: n.statusRaw,
      skip,
      nightsInclusiveSuspect: n.nightsInclusiveSuspect,
      dup,
      pasteCancel,
      matchBookingId,
      cancelGuard,
      rowStatus,
    };
  });
}

export function recomputeRowStatus(row: Omit<PreviewRow, "rowStatus">): PreviewRowStatus {
  if (row.pasteCancel) {
    if (row.matchBookingId) {
      if (row.skip && row.cancelGuard) return "skip";
      if (row.skip) return "skip";
      return "cancel";
    }
    if (row.dup) return "dup";
    if (row.skip) return "skip";
    if (previewNeedsFix(row)) return "need_fix";
    return "cancel";
  }
  if (row.dup) return "dup";
  if (row.skip) return "skip";
  if (previewNeedsFix(row)) return "need_fix";
  return "ok";
}

/** Draft cancelled booking from matched Hotori row (Entry cancel semantics). */
export function cancelDraftFromMatch(matched: Booking, nowIso: string): Booking {
  return {
    ...matched,
    status: "cancelled",
    updatedAt: nowIso,
  };
}

/** Build Path A booking draft (roomId=null). Caller assigns id / timestamps. */
export function pathADraftFromPreview(
  row: PreviewRow,
  opts: {
    platformId: string;
    platformLabel: string;
    id: string;
    nowIso: string;
    /** Create-as-cancelled (no prior Hotori match). DB trigger sets cancelled_at. */
    status?: "active" | "cancelled";
  },
): Booking {
  const priceUnset = row.priceUnset || row.amount == null;
  const status = opts.status ?? "active";
  return {
    id: opts.id,
    kind: "stay",
    status,
    platformId: opts.platformId,
    price: priceUnset ? 0 : (row.amount ?? 0),
    priceUnset,
    guestName: row.guestName.trim(),
    guestPhone: row.guestPhone.trim() || null,
    typeId: row.typeId!,
    roomId: null,
    segments: null,
    checkIn: row.checkIn!,
    nights: row.nights!,
    startTime: null,
    endTime: null,
    arrived: false,
    tentative: false,
    memo: reservationMemo(opts.platformLabel, row.reservationId, row.typeRaw),
    guests: null,
    nightRates: null,
    cancelledAt: null,
    createdAt: opts.nowIso,
    updatedAt: opts.nowIso,
  };
}

/** Path A 미배정 + status cancelled (no Hotori match cancel paste). */
export function pathACancelDraftFromPreview(
  row: PreviewRow,
  opts: {
    platformId: string;
    platformLabel: string;
    id: string;
    nowIso: string;
  },
): Booking {
  return pathADraftFromPreview(row, { ...opts, status: "cancelled" });
}

/**
 * Hypothesis fixtures (anonymized · invented headers until live samples).
 * Distinctive columns (야놀자예약번호 / 여기어때예약번호) so auto-detect has margin.
 */
export const HYPOTHESIS_FIXTURES: Record<"yanolja" | "yeogi", string> = {
  yanolja: [
    "야놀자예약번호\t예약자\t연락처\t객실상품\t체크인\t체크아웃\t박수\t판매금액\t상태",
    "YN-1001\t김테스트\t010-1234-5678\t스탠다드\t2026-10-20\t2026-10-22\t2\t120000\t예약확정",
    "YN-1002\t이샘플\t010****9999\t디럭스\t2026-10-21\t2026-10-22\t1\t80000\t취소",
  ].join("\n"),
  yeogi: [
    "여기어때예약번호\t투숙객\t휴대폰\t상품명\t입실일\t퇴실일\t숙박일수\t결제금액\t예약상태",
    "GC-2001\t박가설\t010-2222-3333\t스탠다드룸\t2026.10.25\t2026.10.27\t2박\t150000\t확정",
    "GC-2002\t최픽스처\t010-0000-1111\t온돌\t2026.10.26\t2026.10.27\t1박\t65000\t예약확정",
  ].join("\n"),
};

/**
 * Hypothesis: 야놀자 파트너센터 「통합내역」 drag-copy as `text/plain`
 * (no tabs — multi-space / fixed-width columns + chrome lines above/below).
 * Not a live capture; labeled for FO repro of 「표 형식…붙여넣어 주세요」.
 */
export const YANOLJA_DRAG_COPY_MULTISPACE_FIXTURE = [
  "필터",
  "조회기간  2026-10-01 ~ 2026-10-31",
  "합계  2건",
  "엑셀다운로드  인쇄",
  "야놀자예약번호  예약자  연락처  객실상품  체크인  체크아웃  박수  판매금액  상태",
  "YN-1001  김테스트  010-1234-5678  스탠다드  2026-10-20  2026-10-22  2  120000  예약확정",
  "YN-1002  이샘플  010****9999  디럭스  2026-10-21  2026-10-22  1  80000  취소",
  "합계금액  200000",
].join("\n");

/**
 * Hypothesis: same 통합내역 list as browser `text/html` clipboard (table markup).
 */
export const YANOLJA_DRAG_COPY_HTML_FIXTURE = `
<div class="toolbar">필터 · 조회기간</div>
<table class="list">
  <tr>
    <th>야놀자예약번호</th><th>예약자</th><th>연락처</th><th>객실상품</th>
    <th>체크인</th><th>체크아웃</th><th>박수</th><th>판매금액</th><th>상태</th>
  </tr>
  <tr>
    <td>YN-1001</td><td>김테스트</td><td>010-1234-5678</td><td>스탠다드</td>
    <td>2026-10-20</td><td>2026-10-22</td><td>2</td><td>120000</td><td>예약확정</td>
  </tr>
  <tr>
    <td>YN-1002</td><td>이샘플</td><td>010****9999</td><td>디럭스</td>
    <td>2026-10-21</td><td>2026-10-22</td><td>1</td><td>80000</td><td>취소</td>
  </tr>
</table>
<button>엑셀다운로드</button>
`.trim();

/**
 * Hypothesis (#143 miss): 통합내역 drag-copy with **single** spaces between cells
 * (not 2+). Fails under #143 multi-space rules; passes after line-split harden.
 */
export const YANOLJA_DRAG_COPY_SINGLE_SPACE_FIXTURE = [
  "필터",
  "조회기간 2026-10-01 ~ 2026-10-31",
  "야놀자예약번호 예약자 연락처 객실상품 체크인 체크아웃 박수 판매금액 상태",
  "YN-1001 김테스트 010-1234-5678 스탠다드 2026-10-20 2026-10-22 2 120000 예약확정",
  "YN-1002 이샘플 010****9999 디럭스 2026-10-21 2026-10-22 1 80000 취소",
].join("\n");

/**
 * Hypothesis (#143 miss): each cell on its own line (DOM textContent / column walk).
 * Needs row reassembly via header-alias cycle + 예약번호 anchors.
 */
export const YANOLJA_DRAG_COPY_VERTICAL_CELLS_FIXTURE = [
  "필터",
  "야놀자예약번호",
  "예약자",
  "연락처",
  "객실상품",
  "체크인",
  "체크아웃",
  "박수",
  "판매금액",
  "상태",
  "YN-1001",
  "김테스트",
  "010-1234-5678",
  "스탠다드",
  "2026-10-20",
  "2026-10-22",
  "2",
  "120000",
  "예약확정",
  "YN-1002",
  "이샘플",
  "010****9999",
  "디럭스",
  "2026-10-21",
  "2026-10-22",
  "1",
  "80000",
  "취소",
].join("\n");

/**
 * Hypothesis (#143 miss): all cells collapsed onto one line (newline stripped).
 */
export const YANOLJA_DRAG_COPY_COLLAPSED_LINE_FIXTURE =
  "야놀자예약번호 예약자 연락처 객실상품 체크인 체크아웃 박수 판매금액 상태 YN-1001 김테스트 010-1234-5678 스탠다드 2026-10-20 2026-10-22 2 120000 예약확정 YN-1002 이샘플 010****9999 디럭스 2026-10-21 2026-10-22 1 80000 취소";

/**
 * Live SoT (anonymized): 야놀자 통합내역 vertical card stack.
 * Full copy: `shared/fixtures/yanolja-unified-card-paste.txt`.
 */
export const YANOLJA_UNIFIED_CARD_PASTE_FIXTURE_PATH = new URL(
  "./fixtures/yanolja-unified-card-paste.txt",
  import.meta.url,
);

/**
 * Owner cancel-miss SoT (anonymized): 예약취소+고객취소 with trailing 입실완료 chrome.
 * Must classify as cancel / 「예약취소」 — never 신규·수정필요 from footer.
 */
export const YANOLJA_CANCEL_MISS_CARD_FIXTURE_PATH = new URL(
  "./fixtures/yanolja-cancel-miss-card.txt",
  import.meta.url,
);

/**
 * Owner chrome SoT (anonymized): cancel card that also drags checkbox / 특·직접관리 UI
 * and a partner-center 「예약완료」 box. Cancel must win — chrome 예약완료 is not stay status.
 */
export const YANOLJA_CANCEL_CHROME_COMPLETE_CARD_FIXTURE_PATH = new URL(
  "./fixtures/yanolja-cancel-chrome-complete-card.txt",
  import.meta.url,
);

/** Soft warn key when no reservation id (name+phone+checkIn+type). */
export function softDedupeKey(row: Pick<PreviewRow, "guestName" | "guestPhone" | "checkIn" | "typeId">): string {
  return [row.guestName.trim(), row.guestPhone.trim(), row.checkIn ?? "", row.typeId ?? ""].join("|");
}

/** Ensure checkout = checkIn + nights (hotel-night). */
export function checkoutFromNights(checkIn: string, nights: number): string {
  return addDays(checkIn, nights);
}
