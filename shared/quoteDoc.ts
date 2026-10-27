/** 견적서 (P1.1) — 예약 전 제안. See docs/group-invoice-plan.md */
import type { PrintLang } from "./hotelBiz";
import type { IssuanceNightCell } from "./issuanceNightDetail";
import {
  quoteAmountFromNightCells,
  quoteLineNightCells,
  unitRateFromCells,
} from "./issuanceNightDetail";

export const QUOTE_TITLE_MAX = 80;
export const QUOTE_CLIENT_MAX = 60;
export const QUOTE_PHONE_MAX = 30;
export const QUOTE_NOTES_MAX = 280;
export const QUOTE_LINE_LABEL_MAX = 40;
export const QUOTE_LINES_MAX = 40;

export type QuoteStatus = "draft" | "issued";

export type QuoteLine = {
  id: string;
  /** Hotori 타입 id (발급 시 타입홀드용 · 필수) */
  typeId: string;
  /** 객실/타입 라벨 (타입명 fallback) */
  label: string;
  rooms: number;
  nights: number;
  pax: number;
  /** 1실·1박 단가 */
  rate: number;
  /** 줄 합계 (보통 rooms × nights × rate; 수동 override OK) */
  amount: number;
  /**
   * Optional pre-selected room ids (print opt-in only by default).
   * Issue: if set & length matches rooms → Path B with roomId; else Path A roomId=null.
   */
  roomIds?: string[];
  /** 1실 기준 날짜별 단가 (있으면 amount = rooms × Σ) */
  nightAmounts?: IssuanceNightCell[];
};

export type QuoteDoc = {
  id: string;
  hotelId: string;
  status: QuoteStatus;
  title: string;
  clientName: string;
  clientPhone: string;
  notes: string;
  checkIn: string | null;
  nights: number;
  guestCount: number;
  lines: QuoteLine[];
  total: number;
  /** 인쇄 시 객실번호 표시 (기본 false · 타입만) */
  showRoomNos: boolean;
  /** 발급 시 만든 group / booking 링크 */
  groupId: string | null;
  bookingIds: string[];
  /** 발급 시 동결 스냅샷 */
  snapshot: QuoteSnapshot | null;
  issuedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QuoteSnapshot = {
  title: string;
  clientName: string;
  clientPhone: string;
  notes: string;
  checkIn: string | null;
  nights: number;
  guestCount: number;
  lines: QuoteLine[];
  total: number;
  showRoomNos: boolean;
  groupId: string | null;
  bookingIds: string[];
  issuedAt: string;
};

export type QuoteDraft = {
  title: string;
  clientName: string;
  clientPhone: string;
  notes: string;
  checkIn: string | null;
  nights: number;
  guestCount: number;
  lines: QuoteLine[];
  showRoomNos: boolean;
};

/** FO chrome (KR). Print body uses quotePrintStrings(lang). */
export const QUOTE_COPY = {
  title: "견적서",
  newQuote: "새 견적",
  hint: "예약 전 · 날짜·객실·인원 견적",
  cta: "작성하기",
  client: "견적처",
  clientPhone: "연락처",
  checkIn: "입실 예정",
  nights: "박수",
  guestCount: "인원",
  notes: "메모",
  lines: "내역",
  addLine: "줄 추가",
  label: "항목",
  type: "타입",
  rooms: "실",
  roomNos: "호수",
  rate: "단가",
  amount: "금액",
  pax: "인원",
  nightDetail: "날짜별 단가",
  redistribute: "단가×박 분배",
  total: "합계",
  showRoomNos: "객실번호 표시",
  showRoomNosHint: "기본은 타입만. 손님이 호수를 원할 때만 켜요.",
  draft: "임시저장",
  issue: "발급",
  issued: "발급됨",
  reprint: "다시 인쇄",
  print: "인쇄",
  pdf: "PDF",
  pdfHint: "인쇄 창에서「PDF로 저장」을 고르세요",
  close: "닫기",
  delete: "삭제",
  attest: "위와 같이 견적합니다.",
  issueDate: "발급일",
  tip: "발급하면 견적이 고정되고, 같은 날짜·타입으로 미배정 예약이 만들어져요. 호실은 배치에서 정하세요.",
  tipNights: "총액·단가만 있어도 날짜별 단가로 나눠 적을 수 있어요.",
  emptyLines: "항목을 한 줄 이상 넣어 주세요.",
  titleRequired: "견적 제목 또는 견적처를 적어 주세요.",
  saveOk: "견적을 저장했어요.",
  issueOk: "견적을 발급하고 미배정 예약을 만들었어요.",
  deleteOk: "견적을 지웠어요.",
  confirmDeleteTitle: "견적을 삭제할까요?",
  confirmDeleteBody: "임시·발급 기록이 지워져요. 되돌릴 수 없어요.",
  confirmIssueTitle: "견적을 발급할까요?",
  confirmIssueBody:
    "발급 후 견적 내용은 고정돼요.\n같은 날짜·타입·인원·요금으로 미배정(타입 홀드) 예약이 만들어지고, 호실은 배치에서 정할 수 있어요.",
  recentEmpty: "최근 견적이 없어요.",
  openRecent: "최근 견적",
} as const;

export const QUOTE_COPY_EN_TITLE = "Quote" as const;

export type QuotePrintStrings = {
  title: string;
  bizNumber: string;
  phone: string;
  representativeShort: string;
  representative: string;
  seal: string;
  client: string;
  checkIn: string;
  nights: (n: number) => string;
  nightsCol: string;
  guests: (n: number) => string;
  label: string;
  rooms: string;
  pax: string;
  rate: string;
  amount: string;
  nightDetail: string;
  total: string;
  attest: string;
  issueDate: string;
  print: string;
  pdf: string;
  pdfHint: string;
  close: string;
  langAria: string;
  langKo: string;
  langEn: string;
  roomSuffix: string;
};

const QUOTE_PRINT_KO: QuotePrintStrings = {
  title: QUOTE_COPY.title,
  bizNumber: "사업자번호",
  phone: "전화",
  representativeShort: "대표",
  representative: "대표자",
  seal: "(인)",
  client: QUOTE_COPY.client,
  checkIn: QUOTE_COPY.checkIn,
  nights: (n) => `${n}박`,
  nightsCol: QUOTE_COPY.nights,
  guests: (n) => `${n}명`,
  label: QUOTE_COPY.label,
  rooms: QUOTE_COPY.rooms,
  pax: QUOTE_COPY.pax,
  rate: QUOTE_COPY.rate,
  amount: QUOTE_COPY.amount,
  nightDetail: QUOTE_COPY.nightDetail,
  total: QUOTE_COPY.total,
  attest: QUOTE_COPY.attest,
  issueDate: QUOTE_COPY.issueDate,
  print: QUOTE_COPY.print,
  pdf: QUOTE_COPY.pdf,
  pdfHint: QUOTE_COPY.pdfHint,
  close: QUOTE_COPY.close,
  langAria: "견적서 언어",
  langKo: "한국어",
  langEn: "English",
  roomSuffix: "호",
};

const QUOTE_PRINT_EN: QuotePrintStrings = {
  title: QUOTE_COPY_EN_TITLE,
  bizNumber: "Business Reg. No.",
  phone: "Tel",
  representativeShort: "Rep.",
  representative: "Representative",
  seal: "(Seal)",
  client: "Client",
  checkIn: "Check-in",
  nights: (n) => (n === 1 ? "1 night" : `${n} nights`),
  nightsCol: "Nights",
  guests: (n) => (n === 1 ? "1 guest" : `${n} guests`),
  label: "Item",
  rooms: "Rooms",
  pax: "Pax",
  rate: "Rate",
  amount: "Amount",
  nightDetail: "Nightly rates",
  total: "Total",
  attest: "We quote the above rates for your stay.",
  issueDate: "Issued",
  print: "Print",
  pdf: "PDF",
  pdfHint: "In the print dialog, choose “Save as PDF”",
  close: "Close",
  langAria: "Quote language",
  langKo: "한국어",
  langEn: "English",
  roomSuffix: "",
};

export function quotePrintStrings(lang: PrintLang): QuotePrintStrings {
  return lang === "en" ? QUOTE_PRINT_EN : QUOTE_PRINT_KO;
}

export function emptyQuoteLine(typeId = ""): QuoteLine {
  return {
    id: crypto.randomUUID(),
    typeId,
    label: "",
    rooms: 1,
    nights: 1,
    pax: 2,
    rate: 0,
    amount: 0,
    roomIds: [],
  };
}

export function lineAmount(rooms: number, nights: number, rate: number): number {
  return Math.max(0, Math.round(rooms) * Math.round(nights) * Math.round(rate));
}

export function quoteTotal(lines: QuoteLine[]): number {
  return lines.reduce((n, l) => n + Math.max(0, Math.round(l.amount)), 0);
}

function normalizeRoomIds(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === "string" && x.trim()) out.push(x.trim().slice(0, 40));
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeQuoteLine(raw: unknown): QuoteLine | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id ? o.id : crypto.randomUUID();
  const typeId = typeof o.typeId === "string" ? o.typeId.trim().slice(0, 40) : "";
  const label = typeof o.label === "string" ? o.label.trim().slice(0, QUOTE_LINE_LABEL_MAX) : "";
  const rooms = Math.max(0, Math.round(Number(o.rooms) || 0));
  const nights = Math.max(0, Math.round(Number(o.nights) || 0));
  const pax = Math.max(0, Math.round(Number(o.pax) || 0));
  const rate = Math.max(0, Math.round(Number(o.rate) || 0));
  const amountRaw = o.amount;
  const amount =
    amountRaw === undefined || amountRaw === null || amountRaw === ""
      ? lineAmount(rooms, nights, rate)
      : Math.max(0, Math.round(Number(amountRaw) || 0));
  const roomIds = normalizeRoomIds(o.roomIds, Math.max(rooms, 20));
  let nightAmounts: IssuanceNightCell[] | undefined;
  if (Array.isArray(o.nightAmounts)) {
    nightAmounts = o.nightAmounts
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const c = x as Record<string, unknown>;
        const date = typeof c.date === "string" ? c.date : "";
        const a = Math.max(0, Math.round(Number(c.amount) || 0));
        return date ? { date, amount: a } : null;
      })
      .filter((x): x is IssuanceNightCell => !!x);
    if (!nightAmounts.length) nightAmounts = undefined;
  }
  return { id, typeId, label, rooms, nights, pax, rate, amount, roomIds, nightAmounts };
}

/** Ensure night detail exists for edit UI; sync amount from cells×rooms when detail present */
export function ensureQuoteLineNights(
  line: QuoteLine,
  checkIn: string | null | undefined,
): QuoteLine {
  const cells =
    line.nightAmounts?.length && line.nightAmounts.length === Math.max(1, line.nights)
      ? line.nightAmounts
      : quoteLineNightCells({
          checkIn,
          nights: line.nights,
          rate: line.rate,
          roomTotal: line.nights > 0 && line.rooms > 0 ? Math.round(line.amount / Math.max(1, line.rooms)) : undefined,
          nightAmounts: line.nightAmounts,
        });
  const rate = unitRateFromCells(cells, line.rate * Math.max(1, line.nights), line.nights) || line.rate;
  const amount = quoteAmountFromNightCells(line.rooms, cells);
  return { ...line, nightAmounts: cells, rate, amount };
}

export function normalizeQuoteLines(raw: unknown): QuoteLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeQuoteLine).filter((x): x is QuoteLine => !!x).slice(0, QUOTE_LINES_MAX);
}

export function validateQuoteDraft(d: QuoteDraft): string | null {
  const title = d.title.trim() || d.clientName.trim();
  if (!title) return QUOTE_COPY.titleRequired;
  if (d.title.length > QUOTE_TITLE_MAX) return `제목은 ${QUOTE_TITLE_MAX}자까지예요.`;
  if (d.clientName.length > QUOTE_CLIENT_MAX) return `견적처는 ${QUOTE_CLIENT_MAX}자까지예요.`;
  if (d.clientPhone.length > QUOTE_PHONE_MAX) return `연락처는 ${QUOTE_PHONE_MAX}자까지예요.`;
  if (d.notes.length > QUOTE_NOTES_MAX) return `메모는 ${QUOTE_NOTES_MAX}자까지예요.`;
  if (!d.lines.length) return QUOTE_COPY.emptyLines;
  if (d.lines.length > QUOTE_LINES_MAX) return `항목은 ${QUOTE_LINES_MAX}줄까지예요.`;
  if (d.lines.every((l) => l.amount <= 0 && !l.label.trim() && !l.typeId)) return QUOTE_COPY.emptyLines;
  return null;
}

export function freezeQuoteSnapshot(d: QuoteDraft, issuedAt: string, link?: { groupId: string | null; bookingIds: string[] }): QuoteSnapshot {
  const lines = d.lines.map((l) => ({ ...l, roomIds: l.roomIds?.slice() ?? [] }));
  return {
    title: (d.title.trim() || d.clientName.trim() || QUOTE_COPY.title).slice(0, QUOTE_TITLE_MAX),
    clientName: d.clientName.trim().slice(0, QUOTE_CLIENT_MAX),
    clientPhone: d.clientPhone.trim().slice(0, QUOTE_PHONE_MAX),
    notes: d.notes.trim().slice(0, QUOTE_NOTES_MAX),
    checkIn: d.checkIn,
    nights: Math.max(0, Math.round(d.nights) || 0),
    guestCount: Math.max(0, Math.round(d.guestCount) || 0),
    lines,
    total: quoteTotal(lines),
    showRoomNos: !!d.showRoomNos,
    groupId: link?.groupId ?? null,
    bookingIds: link?.bookingIds ?? [],
    issuedAt,
  };
}

/** 인쇄에 쓸 본문: 발급본이면 snapshot, 아니면 draft */
export function quotePrintBody(doc: QuoteDoc): QuoteSnapshot {
  if (doc.status === "issued" && doc.snapshot) return doc.snapshot;
  return freezeQuoteSnapshot(
    {
      title: doc.title,
      clientName: doc.clientName,
      clientPhone: doc.clientPhone,
      notes: doc.notes,
      checkIn: doc.checkIn,
      nights: doc.nights,
      guestCount: doc.guestCount,
      lines: doc.lines,
      showRoomNos: doc.showRoomNos,
    },
    doc.issuedAt ?? doc.updatedAt,
    { groupId: doc.groupId, bookingIds: doc.bookingIds },
  );
}

/** Print cell: type label always; room nos only when showRoomNos && roomIds */
export function quoteLinePrintLabel(
  line: QuoteLine,
  showRoomNos: boolean,
  roomNoOf: (roomId: string) => string | null | undefined,
  lang: PrintLang = "ko",
): string {
  const type = line.label.trim() || "—";
  if (!showRoomNos) return type;
  const nos = (line.roomIds ?? [])
    .map((id) => roomNoOf(id)?.trim())
    .filter((x): x is string => !!x);
  if (!nos.length) return type;
  if (lang === "en") return `${type} · ${nos.join(", ")}`;
  return `${type} · ${nos.join("·")}호`;
}
