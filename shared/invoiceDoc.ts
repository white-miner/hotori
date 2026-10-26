/** 청구서 (P1.2a) — 실이용 정산 스냅샷. See docs/group-invoice-plan.md */
import { groupLeadBooking } from "./group";
import type { PrintLang } from "./hotelBiz";
import { type Booking, type Platform, checkOut, revenueOf, roomLabel, typeLabel, type HotelSettings } from "./ledger";
import { PAYMENT_METHOD_LABEL, paidOf, type PaymentMethod } from "./payment";
import { type GroupInfo, settle, type Settlement } from "./settle";
import type { QuoteCompare } from "./quoteVariance";

export type InvoiceStatus = "draft" | "issued";

export type InvoiceRoomLine = {
  bookingId: string;
  roomNo: string;
  typeLabel: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guestCount: number;
  /** 판매가 (revenueOf) */
  amount: number;
  paid: number;
  excluded?: boolean;
};

export type InvoicePayLine = {
  method: string;
  amount: number;
  bizDate: string;
  note?: string;
};

export type InvoiceSnapshot = {
  issueNumber: string;
  payerName: string;
  payerPhone: string;
  groupName: string;
  isMidStay: boolean;
  rooms: InvoiceRoomLine[];
  extras: { name: string; amount: number }[];
  surcharges: { label: string; amount: number }[];
  refunds: number;
  total: number;
  paid: number;
  left: number;
  tracked: boolean;
  payments: InvoicePayLine[];
  footnotes: string[];
  issuedAt: string;
  /** P1.3 견적 대비 (quote↔group 링크 시) */
  quoteCompare?: QuoteCompare | null;
};

export type InvoiceDoc = {
  id: string;
  hotelId: string;
  status: InvoiceStatus;
  issueNumber: string | null;
  groupId: string | null;
  bookingIds: string[];
  payerName: string;
  payerPhone: string;
  isMidStay: boolean;
  snapshot: InvoiceSnapshot | null;
  issuedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export const INVOICE_PAYER_MAX = 80;
export const INVOICE_PHONE_MAX = 30;

/** FO chrome (KR). Print body uses invoicePrintStrings(lang). */
export const INVOICE_COPY = {
  title: "청구서",
  hint: "실이용 정산 · 단체/예약에서 발급",
  cta: "청구서 발급",
  hubCta: "최근·발급",
  payer: "청구처",
  payerPhone: "연락처",
  issueNo: "청구번호",
  midWatermark: "중간 청구",
  room: "객실",
  period: "숙박",
  amount: "판매가",
  paid: "받은",
  left: "잔금",
  total: "합계",
  extras: "추가 항목",
  payments: "결제 내역",
  footnotes: "비고",
  attest: "위와 같이 청구합니다.",
  issueDate: "발급일",
  print: "인쇄",
  pdf: "PDF",
  pdfHint: "인쇄 창에서「PDF로 저장」을 고르세요",
  close: "닫기",
  issue: "발급",
  issued: "발급됨",
  reprint: "다시 인쇄",
  tip: "발급하면 금액이 고정돼요. 예약·결제를 고친 뒤엔 새 버전으로 재발급하세요.",
  tipLive: "미리보기는 지금 예약·정산과 같아요. 발급 시 스냅샷으로 얼려요.",
  needNights: "실제 숙박(입실·퇴실)이 있는 예약이 필요해요.",
  notDamage: "손해·파손은 「손해내역서」로 따로 발급해요.",
  saveOk: "청구서를 저장했어요.",
  issueOk: "청구서를 발급했어요.",
  confirmIssueTitle: "청구서를 발급할까요?",
  confirmIssueBody: "청구번호가 붙고 내용이 고정돼요. 이미 건넨 PDF와 맞춰 재인쇄할 수 있어요.",
  recentEmpty: "최근 청구서가 없어요.",
  fromGroup: "단체 청구서",
  fromStay: "숙박 청구서",
  quoteCompare: "견적 대비",
  quoteTotal: "견적 합계",
  invoiceTotal: "청구 합계",
  quoteDiff: "차이",
} as const;

export const INVOICE_COPY_EN_TITLE = "Invoice" as const;

export type InvoicePrintStrings = {
  title: string;
  bizNumber: string;
  phone: string;
  representativeShort: string;
  representative: string;
  seal: string;
  payer: string;
  issueNo: string;
  midWatermark: string;
  group: string;
  room: string;
  period: string;
  amount: string;
  paid: string;
  left: string;
  total: string;
  extras: string;
  payments: string;
  footnotes: string;
  quoteCompare: string;
  quoteTotal: string;
  invoiceTotal: string;
  quoteDiff: string;
  quoteSame: string;
  quoteOver: string;
  quoteUnder: string;
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
  unassigned: string;
  nights: (n: number) => string;
};

const INVOICE_PRINT_KO: InvoicePrintStrings = {
  title: INVOICE_COPY.title,
  bizNumber: "사업자번호",
  phone: "전화",
  representativeShort: "대표",
  representative: "대표자",
  seal: "(인)",
  payer: INVOICE_COPY.payer,
  issueNo: INVOICE_COPY.issueNo,
  midWatermark: INVOICE_COPY.midWatermark,
  group: "단체",
  room: INVOICE_COPY.room,
  period: INVOICE_COPY.period,
  amount: INVOICE_COPY.amount,
  paid: INVOICE_COPY.paid,
  left: INVOICE_COPY.left,
  total: INVOICE_COPY.total,
  extras: INVOICE_COPY.extras,
  payments: INVOICE_COPY.payments,
  footnotes: INVOICE_COPY.footnotes,
  quoteCompare: INVOICE_COPY.quoteCompare,
  quoteTotal: INVOICE_COPY.quoteTotal,
  invoiceTotal: INVOICE_COPY.invoiceTotal,
  quoteDiff: INVOICE_COPY.quoteDiff,
  quoteSame: "동일",
  quoteOver: "초과",
  quoteUnder: "미만",
  attest: INVOICE_COPY.attest,
  issueDate: INVOICE_COPY.issueDate,
  print: INVOICE_COPY.print,
  pdf: INVOICE_COPY.pdf,
  pdfHint: INVOICE_COPY.pdfHint,
  close: INVOICE_COPY.close,
  langAria: "청구서 언어",
  langKo: "한국어",
  langEn: "English",
  roomSuffix: "호",
  unassigned: "미배정",
  nights: (n) => `${n}박`,
};

const INVOICE_PRINT_EN: InvoicePrintStrings = {
  title: INVOICE_COPY_EN_TITLE,
  bizNumber: "Business Reg. No.",
  phone: "Tel",
  representativeShort: "Rep.",
  representative: "Representative",
  seal: "(Seal)",
  payer: "Bill to",
  issueNo: "Invoice No.",
  midWatermark: "Interim invoice",
  group: "Group",
  room: "Room",
  period: "Stay",
  amount: "Sale",
  paid: "Paid",
  left: "Balance",
  total: "Total",
  extras: "Extras",
  payments: "Payments",
  footnotes: "Notes",
  quoteCompare: "Vs. quote",
  quoteTotal: "Quote total",
  invoiceTotal: "Invoice total",
  quoteDiff: "Difference",
  quoteSame: "Same",
  quoteOver: "Over",
  quoteUnder: "Under",
  attest: "Please remit the charges above.",
  issueDate: "Issued",
  print: "Print",
  pdf: "PDF",
  pdfHint: "In the print dialog, choose “Save as PDF”",
  close: "Close",
  langAria: "Invoice language",
  langKo: "한국어",
  langEn: "English",
  roomSuffix: "",
  unassigned: "Unassigned",
  nights: (n) => (n === 1 ? "1 night" : `${n} nights`),
};

export function invoicePrintStrings(lang: PrintLang): InvoicePrintStrings {
  return lang === "en" ? INVOICE_PRINT_EN : INVOICE_PRINT_KO;
}

const PAY_LABEL_EN: Record<PaymentMethod, string> = {
  card: "Card",
  cash: "Cash",
  transfer: "Transfer",
  credit: "Credit",
};

const SURCHARGE_LABEL_EN: Record<string, string> = {
  "추가 인원": "Extra guests",
  "빠른 입실·늦은 퇴실": "Early check-in / late check-out",
  "주차/도보": "Parking / walk-in",
};

/** Print-time label for payment method (snapshot stores method code). */
export function invoicePayLabel(method: string, lang: PrintLang): string {
  if (lang === "en" && (method === "card" || method === "cash" || method === "transfer" || method === "credit")) {
    return PAY_LABEL_EN[method];
  }
  return PAYMENT_METHOD_LABEL[method as PaymentMethod] ?? method;
}

/** Translate known settle surcharge labels for EN print; leave custom as-is. */
export function invoiceSurchargeLabel(label: string, lang: PrintLang): string {
  if (lang !== "en") return label;
  return SURCHARGE_LABEL_EN[label] ?? label;
}

/** Room no cell: KR `301호` · EN `301` · 미배정 → Unassigned */
export function invoiceRoomDisplay(roomNo: string, lang: PrintLang, suffix: string): string {
  const raw = roomNo.trim() || (lang === "en" ? "Unassigned" : "미배정");
  if (raw === "미배정" || raw === "Unassigned") return lang === "en" ? "Unassigned" : "미배정";
  return suffix ? `${raw}${suffix}` : raw;
}

/** 호텔·연도별 일련번호 YYYY-NNN */
export function formatInvoiceNumber(year: number, seq: number): string {
  const n = Math.max(1, Math.round(seq));
  return `${year}-${String(n).padStart(3, "0")}`;
}

export function parseInvoiceYear(today: string): number {
  const y = Number((today || "").slice(0, 4));
  return Number.isFinite(y) && y >= 2000 ? y : new Date().getFullYear();
}

/** ≥1실이 실제 숙박(입실 또는 퇴실완료)이면 청구 허용 */
export function invoiceEligible(members: Booking[]): boolean {
  return members.some((b) => {
    if (b.status === "cancelled") return false;
    if (b.kind !== "stay") return false;
    if (b.checkedOutAt) return true;
    if (b.arrived) return true;
    // 투숙중: checkIn ≤ today는 UI에서 today 넘김 — 여기선 arrived/checkout 우선
    return (b.nights ?? 0) > 0 && b.status === "active";
  });
}

/** 형제 중 미퇴실(점유)이 있으면 중간 청구 */
export function invoiceIsMidStay(members: Booking[]): boolean {
  const counted = members.filter((b) => b.status !== "cancelled" && b.status !== "noshow");
  if (!counted.length) return false;
  return counted.some((b) => b.status === "active" && !b.checkedOutAt);
}

export type BuildInvoiceOpts = {
  s: HotelSettings;
  members: Booking[];
  info: GroupInfo | null | undefined;
  plat?: (Pick<Platform, "name"> & { onsite?: boolean | null }) | null;
  payerName: string;
  payerPhone: string;
  issueNumber: string;
  issuedAt: string;
  /** 제외할 booking id */
  excludeIds?: Set<string>;
  /** P1.3 linked quote totals */
  quoteCompare?: QuoteCompare | null;
};

function roomLineOf(b: Booking, s: HotelSettings, excluded: boolean): InvoiceRoomLine {
  const room = roomLabel(s, b.roomId);
  const type = typeLabel(s.types.find((t) => t.id === b.typeId));
  return {
    bookingId: b.id,
    roomNo: room || "미배정",
    typeLabel: type || "",
    guestName: b.guestName || "",
    checkIn: b.checkIn,
    checkOut: checkOut(b),
    nights: b.nights ?? 0,
    guestCount: b.guests ?? 0,
    amount: excluded ? 0 : revenueOf(b),
    paid: excluded ? 0 : paidOf(b),
    excluded: excluded || undefined,
  };
}

/**
 * 발급 스냅샷 빌드 — settle 합과 맞추고 방별 줄 + 결제 각주.
 * 손해/세금계산서 없음.
 */
export function buildInvoiceSnapshot(opts: BuildInvoiceOpts): InvoiceSnapshot {
  const exclude = opts.excludeIds ?? new Set<string>();
  const settleMembers = opts.members.filter((b) => !exclude.has(b.id));
  const included = settleMembers.filter((b) => b.status !== "cancelled");
  const st: Settlement = settle(settleMembers, opts.info, opts.plat);
  const rooms = opts.members.map((b) =>
    roomLineOf(b, opts.s, exclude.has(b.id) || b.status === "cancelled"),
  );

  const surcharges: { label: string; amount: number }[] = [];
  if (st.extraGuests > 0) surcharges.push({ label: "추가 인원", amount: st.extraGuests });
  if (st.extraTime > 0) surcharges.push({ label: "빠른 입실·늦은 퇴실", amount: st.extraTime });
  if (st.parking !== 0) surcharges.push({ label: "주차/도보", amount: st.parking });

  const extras = (opts.info?.extras ?? []).map((x) => ({ name: x.name, amount: x.amount }));

  const payments: InvoicePayLine[] = [];
  for (const p of opts.info?.payments ?? []) {
    payments.push({ method: p.method, amount: p.amount, bizDate: p.bizDate, note: "단체" });
  }
  for (const b of included) {
    for (const p of b.payments ?? []) {
      payments.push({
        method: p.method,
        amount: p.amount,
        bizDate: p.bizDate,
        note: roomLabel(opts.s, b.roomId) ? `${roomLabel(opts.s, b.roomId)}호` : b.guestName,
      });
    }
  }
  payments.sort((a, b) => a.bizDate.localeCompare(b.bizDate));

  const footnotes: string[] = [];
  for (const b of included) {
    if (b.earlyOut && b.refund) {
      footnotes.push(
        `${roomLabel(opts.s, b.roomId) || b.guestName}: 중도퇴실 환불 ${b.refund.toLocaleString("ko-KR")}원`,
      );
    }
  }
  if (st.refunds > 0) footnotes.push(`환불 합계 ${st.refunds.toLocaleString("ko-KR")}원`);

  const lead = groupLeadBooking(included) ?? included[0] ?? opts.members[0];
  const groupName = lead?.groupName?.trim() || lead?.guestName || "";
  const isMid = invoiceIsMidStay(included);

  return {
    issueNumber: opts.issueNumber,
    payerName: opts.payerName.trim().slice(0, INVOICE_PAYER_MAX),
    payerPhone: opts.payerPhone.trim().slice(0, INVOICE_PHONE_MAX),
    groupName,
    isMidStay: isMid,
    rooms: rooms.filter((r) => !r.excluded),
    extras,
    surcharges,
    refunds: st.refunds,
    total: st.total,
    paid: st.paid,
    left: st.left,
    tracked: st.tracked,
    payments,
    footnotes,
    issuedAt: opts.issuedAt,
    quoteCompare: opts.quoteCompare ?? null,
  };
}

export function defaultInvoicePayer(members: Booking[], info: GroupInfo | null | undefined): {
  payerName: string;
  payerPhone: string;
} {
  const active = members.filter((b) => b.status !== "cancelled");
  const lead = groupLeadBooking(active.length ? active : members) ?? active[0] ?? members[0];
  const name =
    info?.payerCompany?.trim() ||
    info?.payerName?.trim() ||
    lead?.groupName?.trim() ||
    lead?.guestName?.trim() ||
    "";
  const phone = info?.payerPhone?.trim() || lead?.guestPhone?.trim() || "";
  return { payerName: name, payerPhone: phone };
}

export function validateInvoicePayer(payerName: string, payerPhone: string): string | null {
  if (payerName.length > INVOICE_PAYER_MAX) return `청구처는 ${INVOICE_PAYER_MAX}자까지예요.`;
  if (payerPhone.length > INVOICE_PHONE_MAX) return `연락처는 ${INVOICE_PHONE_MAX}자까지예요.`;
  return null;
}
