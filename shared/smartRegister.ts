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
import { type StayNightRates, occupiedNightDates } from "./nightrates";
import { resolveNightRate } from "./salesCalendar";

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
  /** Nested OTA when hub resells (야놀자→아고다 등). Empty on normal cards. */
  "판매채널",
] as const;

/** Extra OTA names seen in hub partner UIs (inventory share / resale) — boost, not sole gate. */
const EXTRA_NESTED_CHANNEL_ALIASES = [
  "아고다",
  "agoda",
  "야놀자",
  "yanolja",
  "여기어때",
  "goodchoice",
  "yeogi",
  "네이버",
  "naver",
  "부킹닷컴",
  "booking.com",
  "booking",
  "익스피디아",
  "expedia",
  "호텔스닷컴",
  "hotels.com",
  "에어비앤비",
  "airbnb",
  "트립닷컴",
  "trip.com",
  "씨트립",
  "ctrip",
  "호텔타임",
  "타이드스퀘어",
  "프리비아",
  "g마켓",
  "지마켓",
  "이베이",
  "ebay",
];

/**
 * Same-OTA display names (hub paste vs Settings).
 * `씨트립` (야놀자 재판매 라벨) ↔ Settings `트립닷컴` / Trip.com — substring fuzzy alone misses.
 * Aligns with `shared/platform.ts` KNOWN_COLOR/ABBR group.
 */
const PLATFORM_LABEL_EQUIV: readonly (readonly string[])[] = [
  ["트립닷컴", "trip.com", "tripcom", "씨트립", "ctrip"],
];

function normalizePasteLine(line: string): string {
  return line.replace(/[\u200b\u200c\u200d\ufeff\u00a0]/g, "").trim();
}

/** Collapse space / `_` / `-` for fuzzy channel↔platform match. */
export function normChannelKey(s: string): string {
  return s
    .trim()
    .replace(/[\u200b\u200c\u200d\ufeff\u00a0]/g, "")
    .replace(/[_\-\s.]+/g, "")
    .toLowerCase();
}

/**
 * NOL Partner Center occupancy / plan / rate chrome beside the guest name
 * (chat badge · room-count label) — not a person, not a nested channel.
 * Same skip family as checkbox 「예약완료」 noise.
 */
const OCCUPANCY_OR_PLAN_CHROME = new Set([
  "싱글",
  "더블",
  "트윈",
  "트리플",
  "쿼드",
  "single",
  "double",
  "twin",
  "triple",
  "quad",
]);

/** True for occupancy/plan tokens that must not steal guestName. */
export function isOccupancyOrPlanChrome(line: string): boolean {
  const raw = normalizePasteLine(line);
  if (!raw) return false;
  if (OCCUPANCY_OR_PLAN_CHROME.has(raw.toLowerCase())) return true;
  if (OCCUPANCY_OR_PLAN_CHROME.has(raw)) return true;
  // N인 / N명 occupancy chips
  if (/^[1-9]\d?\s*(인|명)$/.test(raw)) return true;
  return false;
}

/**
 * Phone / 안심번호 line after guest on 야놀자 vertical cards.
 * Ctrip/intl often uses `+82269178710(818157)` — parentheses break a digits-only regex
 * and used to steal `typeRaw` → empty type → 「수정필요」.
 */
export function looksLikeYanoljaCardPhoneLine(raw: string): boolean {
  const s = normalizePasteLine(raw);
  if (!s) return false;
  if (/안심번호/.test(s)) return true;
  // Classic KR / masked: 010-… · 0507-… · 010****9999 · +82-10-…
  if (/^[\d+\-*]+$/.test(s)) return true;
  if (/^0\d/.test(s)) return true;
  // Intl +CC… with optional (ext): +82269178710(818157)
  if (/^\+\d[\d\-]*(\(\d+\))?$/.test(s)) return true;
  // Digits + parenthetical ext (no +): 82269178710(818157)
  if (/^\d[\d\-]*\(\d+\)$/.test(s)) return true;
  return false;
}

function hardRejectNestedChannelLine(raw: string): boolean {
  if (!raw || raw.length > 40) return true;
  if (YANOLJA_CARD_RES_ID.test(raw)) return true;
  if (looksLikeYanoljaCardPhoneLine(raw)) return true;
  if (/^\d{4}[./-]/.test(raw)) return true;
  if (/[ㅣ|]/.test(raw)) return true;
  if (/^\/\s*\d+\s*박/.test(raw)) return true;
  if (isOccupancyOrPlanChrome(raw)) return true;
  if (/객실|타입\s*ID|판매가|입금|숙박|연박|차량|도보|안심번호|미리예약|예약완료|예약취소|고객취소/.test(raw)) {
    return true;
  }
  return false;
}

/** Latin "Sumi Lee" / CHOISANGYEON / short Hangul person names — never treat as channel. */
export function looksLikeGuestNameLine(raw: string): boolean {
  const s = normalizePasteLine(raw);
  if (!s || isOccupancyOrPlanChrome(s)) return false;
  // 마스킹된 이름도 이름이다. 별표를 추정하거나 채널명으로 소비하지 않는다.
  if (/^[가-힣*＊●○·]{2,8}$/.test(s) && /[가-힣]/.test(s) && /[*＊●○]/.test(s)) return true;
  // Latin full name with spaces
  if (/^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*)+$/.test(s)) return true;
  // Compact Latin / romanized OTA name (CHOISANGYEON) — letters only, no digits
  if (/^[A-Za-z][A-Za-z.'-]{2,39}$/.test(s)) return true;
  // Pure Hangul 2–4 (김한나) without marketplace / occupancy markers
  if (/^[\uac00-\ud7a3]{2,4}$/.test(s)) return true;
  return false;
}

/** `Brand_Subbrand` / `Brand-Subbrand` marketplace slugs (야놀자 hub resale). */
function looksLikeMarketplaceSlug(raw: string): boolean {
  if (raw.includes("_")) return true;
  // hyphenated brand tokens (not phone): letters/digits both sides
  if (/^[\p{L}\p{N}]{2,}(?:-[\p{L}\p{N}]{2,})+$/u.test(raw) && /[A-Za-z\uac00-\ud7a3]/.test(raw)) {
    return true;
  }
  return false;
}

function channelKeyHitsLabel(key: string, label: string): boolean {
  const b = normChannelKey(label);
  if (!b || !key) return false;
  if (b === key) return true;
  // Fuzzy: either side contains the other when both meaningful (≥2)
  if (b.length >= 2 && key.length >= 2 && (b.includes(key) || key.includes(b))) return true;
  return false;
}

function hitsSeedOrExtraChannel(raw: string): boolean {
  const key = normChannelKey(raw);
  if (!key) return false;
  for (const p of PLATFORM_PROFILES) {
    if (channelKeyHitsLabel(key, p.label)) return true;
    for (const kw of [...p.hotoriPlatformMatch, ...p.detectHints]) {
      if (channelKeyHitsLabel(key, kw)) return true;
    }
  }
  for (const a of EXTRA_NESTED_CHANNEL_ALIASES) {
    if (channelKeyHitsLabel(key, a)) return true;
  }
  return false;
}

function hitsHotelChannelLabels(raw: string, extraLabels?: readonly string[] | null): boolean {
  if (!extraLabels?.length) return false;
  const key = normChannelKey(raw);
  if (!key) return false;
  for (const lab of extraLabels) {
    const b = normChannelKey(lab);
    if (!b) continue;
    // 1-grapheme abbr: exact key only (avoid eating short Hangul names)
    if (b.length <= 1) {
      if (b === key) return true;
      continue;
    }
    if (channelKeyHitsLabel(key, lab)) return true;
  }
  return false;
}

/**
 * True when the line after reservation id looks like a **channel/brand label**, not a guest.
 * Heuristic (hotel platforms + marketplace slug + short brand) — not allowlist-only.
 * Unknown partner labels still parse as nestedChannelRaw; guest names must not be eaten.
 */
export function isKnownNestedChannelLabel(
  line: string,
  extraLabels?: readonly string[] | null,
): boolean {
  const raw = normalizePasteLine(line);
  if (hardRejectNestedChannelLine(raw)) return false;

  // 1) Hotel platforms / seed / aliases (fuzzy · `_`/`-`/space normalize)
  if (hitsHotelChannelLabels(raw, extraLabels)) return true;
  if (hitsSeedOrExtraChannel(raw)) return true;

  // 2) Marketplace slug: Brand_Subbrand / Brand-Subbrand
  if (looksLikeMarketplaceSlug(raw)) return true;

  // 3) Short single-line brand — never pure Hangul person names / Latin full names
  if (looksLikeGuestNameLine(raw)) return false;
  if (/\s/.test(raw)) return false;
  if (raw.length > 28) return false;
  // Latin/digit token (이베이, G마켓-style fragments, XYZ brands) or longer Hangul brand
  if (/[A-Za-z0-9]/.test(raw)) return true;
  if (raw.length >= 5 && /^[\uac00-\ud7a3]+$/.test(raw)) return true;
  return false;
}

/** Expand hub/Settings aliases for one OTA (씨트립 ↔ 트립닷컴 …). */
function expandPlatformLabelVariants(label: string): string[] {
  const raw = label.trim();
  if (!raw) return [];
  const key = normChannelKey(raw);
  const n = normHeader(raw);
  const out = new Set<string>();
  if (key) out.add(key);
  if (n) out.add(n);
  for (const group of PLATFORM_LABEL_EQUIV) {
    const inGroup = group.some(
      (g) => channelKeyHitsLabel(key, g) || normHeader(g) === n || normChannelKey(g) === key,
    );
    if (!inGroup) continue;
    for (const g of group) {
      const gk = normChannelKey(g);
      const gn = normHeader(g);
      if (gk) out.add(gk);
      if (gn) out.add(gn);
    }
  }
  return [...out];
}

/** Resolve nested channel label → Hotori Settings platform (fuzzy name/abbr / profile keywords). */
export function matchPlatformByLabel(
  label: string,
  s: HotelSettings,
): { id: string; name: string } | null {
  const raw = label.trim();
  if (!raw) return null;
  const n = normHeader(raw);
  const key = normChannelKey(raw);
  const variants = expandPlatformLabelVariants(raw);
  const plats = s.platforms ?? [];
  // 1) Exact / fuzzy on hotel platform name or abbr (underscore/space/- normalize · equiv aliases)
  for (const p of plats) {
    const name = normHeader(p.name ?? "");
    const abbr = normHeader(p.abbr ?? "");
    if (!name && !abbr) continue;
    if (name === n || abbr === n) return { id: p.id, name: p.name };
    if (name && n.length >= 2 && (name.includes(n) || n.includes(name))) {
      return { id: p.id, name: p.name };
    }
    if (channelKeyHitsLabel(key, p.name ?? "") || (abbr.length > 1 && channelKeyHitsLabel(key, p.abbr ?? ""))) {
      return { id: p.id, name: p.name };
    }
    for (const v of variants) {
      if (!v) continue;
      if (name === v || (abbr.length > 1 && abbr === v)) return { id: p.id, name: p.name };
      if (name && v.length >= 2 && (name.includes(v) || v.includes(name))) {
        return { id: p.id, name: p.name };
      }
      if (channelKeyHitsLabel(v, p.name ?? "") || (abbr.length > 1 && channelKeyHitsLabel(v, p.abbr ?? ""))) {
        return { id: p.id, name: p.name };
      }
    }
  }
  // 2) Label hits a seed profile → that profile's hotoriPlatformMatch against settings
  for (const prof of PLATFORM_PROFILES) {
    const hit =
      channelKeyHitsLabel(key, prof.label) ||
      variants.some((v) => channelKeyHitsLabel(v, prof.label)) ||
      prof.hotoriPlatformMatch.some((k) => channelKeyHitsLabel(key, k) || variants.some((v) => channelKeyHitsLabel(v, k))) ||
      prof.detectHints.some((k) => channelKeyHitsLabel(key, k) || variants.some((v) => channelKeyHitsLabel(v, k)));
    if (!hit) continue;
    const id = matchPlatformId(prof, s);
    if (id) {
      const p = plats.find((x) => x.id === id);
      if (p) return { id: p.id, name: p.name };
    }
  }
  return null;
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

export type ParsePasteOpts = {
  /** Hotel platforms[].name/abbr — confident nested-channel detection beyond seed allowlist. */
  channelLabels?: readonly string[] | null;
};

/** Parse one card block (starts with reservation id) → synthetic table row. */
function parseYanoljaCardBlock(
  blockLines: string[],
  channelLabels?: readonly string[] | null,
): string[] | null {
  const lines = blockLines.map(normalizePasteLine).filter((l) => l.length > 0);
  if (!lines.length || !YANOLJA_CARD_RES_ID.test(lines[0]!)) return null;

  const reservationId = lines[0]!;
  let i = 1;

  /** Hub resale line (아고다 등) — not guestName. Shift remaining fields. */
  let nestedChannel = "";
  if (i < lines.length && isKnownNestedChannelLabel(lines[i]!, channelLabels)) {
    nestedChannel = lines[i]!;
    i += 1;
  }

  /**
   * Occupancy/plan chrome (트리플·더블·싱글 …) beside guest — Partner Center badge noise.
   * Skip like checkbox 「예약완료」; prefer the following real guest line
   * (Latin CHOISANGYEON / Hangul person name) over those tokens.
   */
  while (i < lines.length && isOccupancyOrPlanChrome(lines[i]!)) i += 1;
  // Prefer a clear person-name line if the current candidate still looks wrong
  if (
    i + 1 < lines.length &&
    !looksLikeGuestNameLine(lines[i]!) &&
    looksLikeGuestNameLine(lines[i + 1]!)
  ) {
    const cur = lines[i]!;
    // Only leap when current is short label-like (not phone / type / date)
    if (
      cur.length <= 8 &&
      !/^[\d+\-*]+$/.test(cur) &&
      !/^0\d/.test(cur) &&
      !/[ㅣ|]/.test(cur) &&
      !/^\d{4}/.test(cur)
    ) {
      i += 1;
    }
  }

  const guestName = lines[i++] ?? "";

  let guestPhone = "";
  if (i < lines.length) {
    const phoneOrSafe = lines[i]!;
    if (/안심번호/.test(phoneOrSafe)) {
      guestPhone = "";
      i += 1;
    } else if (looksLikeYanoljaCardPhoneLine(phoneOrSafe)) {
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
  // 상세 카드의 취소 상태가 판매가·입금액 뒤에 놓여도 같은 예약 블록 안에서 보존한다.
  // 객실명/취소 규정/쿠폰 이름의 부분 문자열은 상태로 간주하지 않는다.
  if (lines.some(l => /^(?:예약\s*취소|고객\s*취소|취소\s*완료)(?=$|[\s:(（·]|예약완료|고객취소|예약취소)/u.test(l))) {
    statusRaw = "예약취소";
  }

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
    nestedChannel,
  ];
}

/**
 * 야놀자 통합내역 vertical card paste → synthetic TSV table
 * (headers match yanolja profile aliases so detect/map reuse Path A).
 */
export function parseYanoljaCardPaste(raw: string, opts?: ParsePasteOpts): ParsedPasteTable | null {
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
    const row = parseYanoljaCardBlock(lines.slice(from, to), opts?.channelLabels);
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
export function parsePasteTable(raw: string, opts?: ParsePasteOpts): ParsedPasteTable | null {
  let text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return null;

  // HTML table pasted into textarea (or fed from onPaste) → TSV
  if (/<table[\s>]/i.test(text)) {
    const fromHtml = htmlTableToPlain(text);
    if (fromHtml) text = fromHtml;
  }

  // 야놀자 통합내역 drag-copy SoT: vertical card stack (not TSV)
  const card = parseYanoljaCardPaste(text, opts);
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

/** 카드 텍스트에는 HTML 표 밖의 취소 상태·마스킹 이름도 포함된다. 이를 표로 덮어쓰지 않는다. */
export function smartClipboardText(plain: string, html: string): string {
  if (parseYanoljaCardPaste(plain)) return plain;
  return (/<table[\s>]/i.test(html) ? htmlTableToPlain(html) : null) || plain;
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
 * trim · collapse spaces · unify `ㅣ`/`|` · strip ZWSP/NBSP · casefold (KR-friendly via toLowerCase).
 */
export function normTypeName(raw: string): string {
  return raw
    .trim()
    .replace(/[\u00a0\u202f]/g, " ") // NBSP / NNBSP → space
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "") // zero-width / BOM strip
    .replace(/ㅣ/g, "|") // Yanolja vertical bar ↔ ASCII pipe
    .replace(/\s*\|\s*/g, "|") // 구분자 양옆 공백은 상품코드의 일부가 아니다
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Prepare paste typeRaw for alias match: drop `(객실 타입 ID: N)` tokens,
 * then strip a trailing amenity parenthetical `(…)` so short aliases still hit.
 */
export function typeRawForAliasMatch(raw: string): string {
  let s = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // standalone or inline partner type-id footnotes
    .replace(/\(?\s*객실\s*타입\s*ID\s*[:：]?\s*\d+\s*\)?/gi, " ")
    .replace(/\n+/g, " ")
    .trim();
  // trailing amenity block e.g. Family Room|VIP(퀸베드1+…)
  s = s.replace(/\([^()]*\)\s*$/u, "").trim();
  return s;
}

/**
 * Hub bilingual product line `English|한글` / `Englishㅣ한글` → Korean (right) segment.
 * Ctrip via 야놀자: `Standardㅣ스탠다드` should hit alias/fuzzy `스탠다드`.
 */
export function typeRawBilingualTail(raw: string): string {
  const s = typeRawForAliasMatch(raw);
  if (!s) return "";
  // Latin/digit left · pipe · rest (Hangul or mixed). Avoid eating `Family Room|VIP`.
  const m = s.match(/^[\sA-Za-z0-9.'+\-_]+(?:\s+[\sA-Za-z0-9.'+\-_]+)*\s*[|ㅣ]\s*(.+)$/u);
  if (!m?.[1]) return "";
  // Standard2|스탠다드: 오른쪽 번역명이 같아도 숫자 상품코드는 별도 타입이다.
  if (/\d/.test(s.split(/[|ㅣ]/u)[0] ?? "")) return "";
  const tail = m[1].trim();
  // Prefer tails that include Hangul (Standard|스탠다드); skip pure-Latin VIP tags
  if (!/[\uac00-\ud7a3]/.test(tail)) return "";
  return tail;
}

/** True when paste key equals alias, or alias is a prefix before amenity `(`. */
function aliasMatchesTypeKey(key: string, aliasKey: string): boolean {
  if (!aliasKey || !key) return false;
  if (key === aliasKey) return true;
  if (!key.startsWith(aliasKey)) return false;
  if (/^\s*\d/.test(key.slice(aliasKey.length))) return false;
  const next = key.charAt(aliasKey.length);
  // prefix before amenity `(`, or already-stripped key that still starts with alias + sep
  return next === "(" || next === "" || next === " " || next === "|";
}

function aliasKeysForPasteType(platformTypeName: string): string[] {
  const fullKey = normTypeName(platformTypeName);
  const strippedKey = normTypeName(typeRawForAliasMatch(platformTypeName));
  const bilingualKey = normTypeName(typeRawBilingualTail(platformTypeName));
  const keys: string[] = [];
  for (const k of [fullKey, strippedKey, bilingualKey]) {
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

/**
 * Alias lookup: platformId + normalized name → typeId (if type still usable).
 * Exact, strip amenity/`객실 타입 ID`, bilingual `En|한글` tail, or longest alias prefix before `(`.
 */
export function lookupTypeAlias(
  aliases: TypeAlias[] | undefined,
  platformId: string | null | undefined,
  platformTypeName: string,
  typeIds?: ReadonlySet<string>,
): string | null {
  if (!platformId || !aliases?.length) return null;
  const keys = aliasKeysForPasteType(platformTypeName);
  if (!keys.length) return null;

  let best: { typeId: string; len: number; idx: number } | null = null;
  for (let i = 0; i < aliases.length; i++) {
    const a = aliases[i]!;
    if (a.platformId !== platformId) continue;
    const aliasKey = normTypeName(a.platformTypeName);
    if (!aliasKey) continue;
    const hit = keys.some((k) => aliasMatchesTypeKey(k, aliasKey));
    if (!hit) continue;
    if (typeIds && !typeIds.has(a.typeId)) continue;
    // longest alias wins; same length → later entry (overwrite semantics)
    if (!best || aliasKey.length > best.len || (aliasKey.length === best.len && i >= best.idx)) {
      best = { typeId: a.typeId, len: aliasKey.length, idx: i };
    }
  }
  return best?.typeId ?? null;
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
 * Alias match ignoring platformId (any hotel×platform alias that fits typeRaw).
 * Same amenity/prefix / longest rules as lookupTypeAlias.
 */
export function lookupTypeAliasAnyPlatform(
  aliases: TypeAlias[] | undefined,
  platformTypeName: string,
  typeIds?: ReadonlySet<string>,
): string | null {
  if (!aliases?.length) return null;
  const keys = aliasKeysForPasteType(platformTypeName);
  if (!keys.length) return null;

  let best: { typeId: string; len: number; idx: number } | null = null;
  for (let i = 0; i < aliases.length; i++) {
    const a = aliases[i]!;
    const aliasKey = normTypeName(a.platformTypeName);
    if (!aliasKey) continue;
    const hit = keys.some((k) => aliasMatchesTypeKey(k, aliasKey));
    if (!hit) continue;
    if (typeIds && !typeIds.has(a.typeId)) continue;
    if (!best || aliasKey.length > best.len || (aliasKey.length === best.len && i >= best.idx)) {
      best = { typeId: a.typeId, len: aliasKey.length, idx: i };
    }
  }
  return best?.typeId ?? null;
}

/**
 * Resolve OTA type string → hotel typeId.
 * Order: **1) hotel type alias (platform)** → **2) fuzzy heuristics**.
 * Optional `alsoPlatformIds` / nested cascade: nested → source → any-platform → fuzzy.
 */
export function matchTypeId(
  typeRaw: string,
  s: HotelSettings,
  platformId?: string | null,
  opts?: { alsoPlatformIds?: readonly (string | null | undefined)[]; anyPlatformAlias?: boolean },
): string | null {
  const raw = typeRaw.trim();
  if (!raw) return null;
  const types = usableTypes(s.types).filter((t) => typeLabel(t));
  const usableIds = new Set(types.map((t) => t.id));

  const tried = new Set<string>();
  const order: string[] = [];
  if (platformId) order.push(platformId);
  for (const id of opts?.alsoPlatformIds ?? []) {
    if (id) order.push(id);
  }
  for (const pid of order) {
    if (tried.has(pid)) continue;
    tried.add(pid);
    const aliased = lookupTypeAlias(s.typeAliases, pid, raw, usableIds);
    if (aliased) return aliased;
  }

  if (opts?.anyPlatformAlias) {
    const anyHit = lookupTypeAliasAnyPlatform(s.typeAliases, raw, usableIds);
    if (anyHit) return anyHit;
  }

  const candidates = [normTypeName(raw), normTypeName(typeRawForAliasMatch(raw)), normTypeName(typeRawBilingualTail(raw))].filter(
    (k, i, arr) => !!k && arr.indexOf(k) === i,
  );
  // exact label
  for (const n of candidates) {
    for (const t of types) {
      if (normTypeName(typeLabel(t)) === n) return t.id;
    }
  }
  // 숫자가 있는 이중 언어 상품은 코드 전체의 명시적 매칭만 허용한다.
  if (/^[^|ㅣ]*\d[^|ㅣ]*[|ㅣ]/u.test(typeRawForAliasMatch(raw))) return null;
  // 숫자·영문 상품코드의 일부를 다른 타입으로 확정하면 재고가 잘못 차감된다.
  // 구별되는 코드가 없는 이름만 보수적으로 허용하고, 동점 후보는 수동 선택한다.
  let best: { id: string; score: number } | null = null;
  let ambiguous = false;
  for (const n of candidates) {
    for (const t of types) {
      const lab = normTypeName(typeLabel(t));
      if (!lab) continue;
      let score = 0;
      const at = n.indexOf(lab);
      if (at >= 0) {
        const before = n.charAt(at - 1);
        const after = n.charAt(at + lab.length);
        const latinBoundary = !/[a-z0-9]$/.test(lab) || !/[a-z0-9]/.test(after);
        const startBoundary = !/^[a-z0-9]/.test(lab) || !/[a-z0-9]/.test(before);
        const suffix = n.slice(at + lab.length);
        if (latinBoundary && startBoundary && !/^\s*\d/.test(suffix)) score = lab.length;
      }
      if (score > 0 && (!best || score > best.score)) { best = { id: t.id, score }; ambiguous = false; }
      else if (score > 0 && best?.score === score && best.id !== t.id) ambiguous = true;
    }
  }
  return ambiguous ? null : best?.id ?? null;
}

/**
 * Nested hub paste type resolve: nested platform aliases → paste-source platform →
 * any-platform alias → fuzzy.
 */
export function matchTypeIdNested(
  typeRaw: string,
  s: HotelSettings,
  nestedPlatformId: string | null,
  sourcePlatformId: string | null,
): string | null {
  return matchTypeId(typeRaw, s, nestedPlatformId, {
    alsoPlatformIds: [sourcePlatformId],
    anyPlatformAlias: true,
  });
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

/** Memo format for Path A mount + dedupe. Nested raw kept when unmatched so FO sees partner label. */
export function reservationMemo(
  platformLabel: string,
  reservationId: string,
  typeRaw?: string,
  nestedChannelRaw?: string,
): string {
  const id = reservationId.trim();
  const nested = nestedChannelRaw?.trim() ?? "";
  const plat =
    nested && nested !== platformLabel.trim() ? `${platformLabel}(${nested})` : platformLabel;
  const base = id ? `${plat} 예약번호 ${id}` : `${plat} 붙여넣기`;
  const extra = typeRaw?.trim() ? ` · ${typeRaw.trim()}` : "";
  return `[스마트등록] ${base}${extra}`;
}

/** Extract reservation id from memo written by smart register / same convention. */
export function reservationIdFromMemo(memo: string | null | undefined): string | null {
  if (!memo) return null;
  const m = memo.match(/예약번호\s+(\S+)/);
  return m?.[1] ?? null;
}

/** 신규 명시 라벨과 기존 스마트등록 메모 형식을 함께 읽는다. 원문이 없으면 추정하지 않는다. */
export function smartImportInfo(b: Pick<Booking, "memo">): { rawType: string | null; reservationId: string | null } | null {
  const first = b.memo?.split("\n")[0]?.trim();
  if (!first) return null;
  const match = first.match(/^(?:\[스마트등록\]\s*)?[^\n]+?\s+(?:예약번호\s+(\S+)|붙여넣기)(?:\s+·\s+(.+))?$/u);
  if (!match) return null;
  return { rawType: match[2]?.trim() || null, reservationId: match[1] || null };
}

/** 이전 가져오기에서 저장한 원문으로 차이를 안내한다. 저장된 예약은 자동 수정하지 않는다. */
export function importedTypeSuggestion(b: Pick<Booking, "kind" | "platformId" | "typeId" | "memo">, s: HotelSettings): { typeId: string; raw: string } | null {
  if (b.kind !== "stay") return null;
  const raw = smartImportInfo(b)?.rawType;
  if (!raw) return null;
  const typeId = matchTypeIdNested(raw, s, null, b.platformId);
  return typeId && typeId !== b.typeId ? { typeId, raw } : null;
}

/** 기존예약 미리보기는 새 인식값과 실제 저장값을 구분한다. 중복 생성·자동 덮어쓰기 금지. */
export function previewTypeMismatch(row: PreviewRow, bookings: BookingReservationPick[]): BookingReservationPick | null {
  if (!row.dup || row.pasteCancel || !row.platformId || !row.reservationId || !row.typeId) return null;
  const matches = bookings.filter((b) => b.status === "active" && b.platformId === row.platformId && reservationIdFromMemo(b.memo) === row.reservationId.trim());
  return matches.length === 1 && matches[0]!.typeId !== row.typeId ? matches[0]! : null;
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
 * ok → 신규 · cancel → 예약취소 · need_fix → 수정필요
 * dup (active Hotori match, non-cancel paste) → 기존예약
 * dup (already cancelled, cancel paste) → 중복스킵
 * skip → 수정필요 (FO same label as need_fix; enum stays skip)
 * cancel_missing — legacy unused (no-match now creates cancelled Path A)
 */
export type PreviewRowStatus = "ok" | "need_fix" | "skip" | "dup" | "cancel" | "cancel_missing";

export interface PreviewRow {
  key: string;
  sourceIndex: number;
  guestName: string;
  /** 직원이 미리보기에서 이름을 수정해도 붙여넣기에서 읽은 이름은 별도로 보존한다. */
  sourceGuestName?: string;
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
  /**
   * Nested OTA label from hub paste (e.g. 아고다 on 야놀자 통합내역).
   * Empty when card has no channel line.
   */
  nestedChannelRaw: string;
  /**
   * Effective Hotori platform for this row (nested match wins; else paste-source).
   * Mount / type alias / cancel match use this — not always the profile chip.
   */
  platformId: string | null;
  /** Display label for effective platform (nested name or profile label). */
  platformLabel: string;
  /** Nested label present but no Settings platform match — show optional chip. */
  nestedChannelUnmatched: boolean;
  /** 연박 박별 요금: 직원이 입력한 날짜별 금액 (비어 있으면 입력 안 한 박) — 총액을 나눈 값이 아니에요 */
  nightAmounts?: Record<string, number | null>;
}

/** 박별 요금을 입력받는 밤 (2박 이상 · 입실일과 박수가 정해진 행) */
export function previewNightDates(row: Pick<PreviewRow, "checkIn" | "nights">): string[] {
  if (!row.checkIn || !row.nights || row.nights < 2) return [];
  return occupiedNightDates(row.checkIn, row.nights);
}

/** 직원이 입력한 박별 요금 → night_rates (입력한 박만 · 없으면 null) */
export function enteredNightRates(row: Pick<PreviewRow, "checkIn" | "nights" | "nightAmounts">): StayNightRates | null {
  const nights: Record<string, number> = {};
  for (const d of previewNightDates(row)) {
    const v = row.nightAmounts?.[d];
    if (v != null && Number.isFinite(v) && v > 0) nights[d] = Math.round(v);
  }
  return Object.keys(nights).length ? { flat: null, nights } : null;
}

/** 설정의 타입 요금(판매 캘린더)에서 박마다 제안값 — 편집 가능한 제안일 뿐, 총액 균등분할 아님 */
export function suggestedNightAmounts(
  s: Parameters<typeof resolveNightRate>[0],
  row: Pick<PreviewRow, "checkIn" | "nights" | "typeId">,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!row.typeId) return out;
  for (const d of previewNightDates(row)) {
    const r = resolveNightRate(s, row.typeId, d);
    if (r.amount > 0) out[d] = r.amount;
  }
  return out;
}

/** 입력 합계 vs 판매금 — 차액은 안내용 (저장을 막지 않아요) */
export function nightRatesDiff(row: Pick<PreviewRow, "checkIn" | "nights" | "nightAmounts" | "amount" | "priceUnset">): {
  entered: number;
  count: number;
  nights: number;
  sum: number;
  total: number | null;
  diff: number | null;
} {
  const dates = previewNightDates(row);
  const er = enteredNightRates(row);
  const sum = Object.values(er?.nights ?? {}).reduce((n, v) => n + v, 0);
  const total = row.priceUnset || row.amount == null ? null : row.amount;
  const complete = er != null && Object.keys(er.nights ?? {}).length === dates.length;
  return { entered: Object.keys(er?.nights ?? {}).length, count: dates.length, nights: dates.length, sum, total, diff: complete && total != null ? sum - total : null };
}

/**
 * FO status chip / row label for a preview row.
 * Unchanged reservation-number matches are 「기존예약」, never 「수정필요」.
 */
export function previewRowStatusLabel(
  row: Pick<PreviewRow, "rowStatus" | "pasteCancel" | "cancelGuard">,
): string {
  if (row.rowStatus === "ok") return "신규";
  if (row.rowStatus === "cancel") return "예약취소";
  if (row.rowStatus === "need_fix") return "수정필요";
  if (row.rowStatus === "dup") return row.pasteCancel ? "중복스킵" : "기존예약";
  if (row.cancelGuard) return "입실·퇴실 — 수동";
  return "수정필요";
}

/** Active Hotori stay already imported — no upload (enum `dup`, non-cancel paste). */
export function isExistingReservationRow(
  row: Pick<PreviewRow, "rowStatus" | "pasteCancel">,
): boolean {
  return row.rowStatus === "dup" && !row.pasteCancel;
}

/**
 * Still blocks 「확인 업로드」: unfixed need_fix (FO must edit or 건너뛰기).
 * Excludes 기존예약 / 중복스킵 (`dup`) and rows already skipped.
 */
export function isFixBlockingRow(row: Pick<PreviewRow, "rowStatus" | "skip">): boolean {
  return !row.skip && row.rowStatus === "need_fix";
}

/**
 * Chip/summary 「수정필요」 — need_fix or non-dup skip (cancelGuard / 건너뛰기).
 * Never includes 기존예약 (`dup`).
 */
export function isFixLabelRow(row: Pick<PreviewRow, "rowStatus" | "skip">): boolean {
  if (row.rowStatus === "dup") return false;
  if (row.rowStatus === "need_fix") return true;
  if (row.rowStatus === "skip") return true;
  return false;
}

function nestedChannelFromRow(table: ParsedPasteTable, row: string[]): string {
  const idx = table.headers.findIndex((h) => normHeader(h) === normHeader("판매채널"));
  return idx >= 0 ? cellAt(row, idx) : "";
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
  const sourceLabel = profile.label;
  return table.rows.map((row, i) => {
    const n = normalizeRow(row, colMap, profile);
    const nestedRaw = nestedChannelFromRow(table, row);
    const nestedHit = nestedRaw ? matchPlatformByLabel(nestedRaw, s) : null;
    // Matched nested → that Hotori platform; unknown nested chip only → keep paste-source platform
    const rowPlatformId = nestedHit?.id ?? platformId;
    const rowPlatformLabel = nestedHit?.name ?? sourceLabel;
    const nestedChannelUnmatched = !!nestedRaw && !nestedHit;

    const typeId = matchTypeIdNested(n.typeRaw, s, nestedHit?.id ?? null, platformId);
    const pasteCancel = n.isCancelStatus;
    const match =
      pasteCancel && rowPlatformId && n.reservationId
        ? findActiveBookingByReservationId(list, rowPlatformId, n.reservationId)
        : null;
    const cancelGuard = !!match && isCancelGuardBlocked(match);
    const alreadyCancelled =
      pasteCancel &&
      !match &&
      !!rowPlatformId &&
      !!n.reservationId.trim() &&
      isAlreadyCancelledReservation(list, rowPlatformId, n.reservationId);
    const dup =
      alreadyCancelled ||
      (!pasteCancel &&
        !!rowPlatformId &&
        !!n.reservationId &&
        isDuplicateReservation(list, rowPlatformId, n.reservationId));

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
      sourceGuestName: n.guestName,
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
      nestedChannelRaw: nestedRaw,
      platformId: rowPlatformId,
      platformLabel: rowPlatformLabel,
      nestedChannelUnmatched,
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
  // 생성 경로가 잘못 선택되더라도 취소 원문을 정상 예약으로 저장하지 않는다.
  const cancelledSource = row.pasteCancel || PLATFORM_PROFILES.some(p => isCancelStatus(row.statusRaw, p));
  const status = cancelledSource ? "cancelled" : opts.status ?? "active";
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
    memo: reservationMemo(
      opts.platformLabel,
      row.reservationId,
      row.typeRaw,
      row.nestedChannelRaw || undefined,
    ) + `\n[가져온 정보] 이름 ${row.sourceGuestName ?? row.guestName} · 상태 ${row.statusRaw || "미표시"}`,
    guests: null,
    // 박별 요금: 직원이 가져오기 화면에서 입력한 박만 저장 (총액을 박수로 나눠 채우지 않아요)
    nightRates: status === "active" && !priceUnset ? enteredNightRates(row) : null,
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

/**
 * Owner nested-channel SoT: 야놀자 통합내역 card with 아고다 line after reservation id
 * (hub inventory resale). Guest/phone/type must shift; platform = 아고다 when in Settings.
 */
export const YANOLJA_NESTED_AGODA_CARD_FIXTURE_PATH = new URL(
  "./fixtures/yanolja-nested-agoda-card.txt",
  import.meta.url,
);

/** Hub resale: `타이드스퀘어_프리비아` after reservation id (marketplace slug). */
export const YANOLJA_NESTED_TIDESQUARE_CARD_FIXTURE_PATH = new URL(
  "./fixtures/yanolja-nested-tidesquare-card.txt",
  import.meta.url,
);

/** Hub resale: `이베이_G마켓` after reservation id (marketplace slug). */
export const YANOLJA_NESTED_GMARKET_CARD_FIXTURE_PATH = new URL(
  "./fixtures/yanolja-nested-gmarket-card.txt",
  import.meta.url,
);

/**
 * Hub resale: `씨트립` after reservation id + intl phone `+82…(ext)`.
 * Phone must not steal typeRaw; Settings `트립닷컴` matches via equiv aliases.
 */
export const YANOLJA_NESTED_CTRIP_CARD_FIXTURE_PATH = new URL(
  "./fixtures/yanolja-nested-ctrip-card.txt",
  import.meta.url,
);

/**
 * Owner SoT: 「트리플」 Partner Center occupancy badge beside guest (not guestName).
 * Real guest = CHOISANGYEON · phone · 도보 · Family Room VIP.
 */
export const YANOLJA_TRIPLE_CHROME_CARD_FIXTURE_PATH = new URL(
  "./fixtures/yanolja-triple-chrome-card.txt",
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
