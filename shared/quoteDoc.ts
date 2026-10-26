/** 견적서 (P1.1) — 예약 전 제안. See docs/group-invoice-plan.md */

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

/** UI copy keys (64-lang roadmap — KR values now) */
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
  return { id, typeId, label, rooms, nights, pax, rate, amount, roomIds };
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
): string {
  const type = line.label.trim() || "—";
  if (!showRoomNos) return type;
  const nos = (line.roomIds ?? [])
    .map((id) => roomNoOf(id)?.trim())
    .filter((x): x is string => !!x);
  if (!nos.length) return type;
  return `${type} · ${nos.join("·")}호`;
}
