// 기록 정정 · 결제 내역 (순수 함수): 입실 → 객실 추가 → 결제 → 이동 → 퇴실을 날짜순으로 한 줄씩,
// 결제 줄은 "언제 · 어떤 객실 · 어떤 수단 · 얼마 · 어느 기간 · 선수금/잔금/미수 수납"까지 증거로 남겨요.
// 화면은 이걸 그리기만 해요. 저장은 booking_payments / bookings / booking_changes.
import { type Booking, addDays, calendarDateOf, legsOf, md, stayEnd, won } from "./ledger";
import type { Change } from "./changes";
import { type GroupLedger, balanceLabel, paidThroughLabel } from "./groupLedger";
import { PAYMENT_METHOD_LABEL, type Payment, type PaymentEdit } from "./payment";

export type PayClass = "선수금" | "잔금" | "미수 수납";

/** 이 줄의 대상 기간: 첫 박~마지막 박 (둘 다 있을 때만) */
export function payPeriod(p: Pick<Payment, "nightDate" | "periodNights">): { from: string; to: string; nights: number } | null {
  if (!p.nightDate || !p.periodNights || p.periodNights < 1) return null;
  return { from: p.nightDate, to: addDays(p.nightDate, p.periodNights - 1), nights: p.periodNights };
}
export function periodText(p: Pick<Payment, "nightDate" | "periodNights">): string | null {
  const x = payPeriod(p);
  if (!x) return null;
  return x.from === x.to ? `${md(x.from)} · 1박` : `${md(x.from)}~${md(x.to)} · ${x.nights}박`;
}

/**
 * 구분 — 기간이 있으면 결제일과 견줘요: 기간이 결제일 뒤에 시작 = 선수금, 결제일 전에 끝남 = 미수 수납, 그 외 = 잔금.
 * 기간이 없으면 선금 → 선수금, 잔금 → 잔금.
 */
export function payClassOf(p: Pick<Payment, "kind" | "bizDate" | "nightDate" | "periodNights">): PayClass {
  const x = payPeriod(p);
  if (!x) return p.kind === "deposit" ? "선수금" : "잔금";
  if (x.from > p.bizDate) return "선수금";
  if (x.to < p.bizDate) return "미수 수납";
  return "잔금";
}

export interface PayLine {
  id: string;
  bizDate: string;
  method: string;
  amount: number;
  /** 어느 객실(또는 단체 몫) */
  scope: string;
  bookingId: string | null;
  groupId: string | null;
  period: string;
  cls: PayClass;
  /** 처리자: 나 / 다른 직원 / 알 수 없음 */
  by: string;
  edited: boolean;
  note: string | null;
  createdAt: string;
}

export interface PayLineOpts {
  /** 객실 줄의 이름표 (예: 502호) */
  roomName: (bookingId: string) => string;
  /** 지금 로그인한 직원 id (처리자 표시용) */
  meId?: string | null;
}

export function byLabel(createdBy: string | null | undefined, meId?: string | null): string {
  if (!createdBy) return "알 수 없음";
  return meId && createdBy === meId ? "나" : "다른 직원";
}

/** 결제 내역: 결제일 → 입력 순서 (오래된 것이 위) */
export function payLines(payments: readonly Payment[], o: PayLineOpts): PayLine[] {
  return [...payments]
    .sort((a, b) => a.bizDate.localeCompare(b.bizDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((p) => ({
      id: p.id,
      bizDate: p.bizDate,
      method: PAYMENT_METHOD_LABEL[p.method],
      amount: p.amount,
      scope: p.bookingId ? o.roomName(p.bookingId) : "단체 몫",
      bookingId: p.bookingId || null,
      groupId: p.groupId ?? null,
      period: periodText(p) ?? (p.bookingId ? "기간 미지정" : "기간 미지정 · 앞 박부터"),
      cls: payClassOf(p),
      by: byLabel(p.createdBy, o.meId),
      edited: !!p.editedAt,
      note: p.note ?? null,
      createdAt: p.createdAt,
    }));
}

export function payLineText(l: PayLine): string {
  return `${md(l.bizDate)} · ${l.scope} · ${l.method} ${won(l.amount)}원 · ${l.period} · ${l.cls}${l.edited ? " · 정정됨" : ""}${l.note ? ` · ${l.note}` : ""}`;
}

/** 복사해서 붙여 넣는 결제 내역 (카톡·메모용) */
export function paymentCopyText(title: string, lines: readonly PayLine[], ledger?: Pick<GroupLedger, "paid" | "dueToday" | "owed" | "prepaid" | "paidThrough" | "balance" | "roomCount" | "firstUncovered" | "due" | "unpaidNightsToday" | "liveCount" | "rooms" | "lump" | "tonight" | "coverNights" | "lastPeriodNights"> | null): string {
  const out = [`${title} · 결제 내역`];
  if (!lines.length) out.push("결제 내역 없음");
  for (const l of lines) out.push(payLineText(l));
  const total = lines.reduce((n, l) => n + l.amount, 0);
  out.push(`결제 합계 ${won(total)}원`);
  if (ledger) {
    out.push(ledger.owed > 0 ? `미수금 ${won(ledger.owed)}원` : ledger.prepaid > 0 ? `선수금 ${won(ledger.prepaid)}원` : "미수금 없음");
    out.push(paidThroughLabel(ledger as GroupLedger, md));
  }
  return out.join("\n");
}

// ---------- 타임라인 (입실 · 객실 추가 · 결제 · 이동 · 퇴실) ----------
export type TimelineKind = "checkin" | "join" | "pay" | "move" | "checkout" | "fix";
export interface TimelineRow {
  key: string;
  kind: TimelineKind;
  date: string;
  title: string;
  sub: string;
  bookingId: string | null;
  paymentId: string | null;
  /** 아직 안 일어난 일 (예정) */
  future: boolean;
  /** 표시 순서(같은 날): 입실 → 객실 추가 → 결제 → 이동 → 퇴실 → 정정 */
  order: number;
}
const KIND_ORDER: Record<TimelineKind, number> = { checkin: 0, join: 1, pay: 2, move: 3, checkout: 4, fix: 5 };

export type TimelineBooking = Pick<Booking, "id" | "roomId" | "checkIn" | "nights" | "segments" | "earlyOut" | "checkedOutAt" | "arrived" | "status" | "kind" | "guestName">;

export interface TimelineOpts {
  bookings: readonly TimelineBooking[];
  /** 단체 몫 결제 */
  groupPayments?: readonly Payment[];
  /** 객실 줄 결제는 bookings[].payments에서 와요 */
  payments?: (bookingId: string) => readonly Payment[];
  changes?: readonly Change[];
  roomName: (roomId: string | null | undefined) => string;
  today: string;
  meId?: string | null;
}

export function recordTimeline(o: TimelineOpts): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const push = (r: Omit<TimelineRow, "order">) => rows.push({ ...r, order: KIND_ORDER[r.kind] });
  const live = o.bookings.filter((b) => b.status !== "cancelled" && b.kind === "stay" && !!b.nights);
  const start = live.map((b) => b.checkIn).sort()[0] ?? null;
  const nameOf = (id: string) => {
    const b = o.bookings.find((x) => x.id === id);
    return o.roomName(b?.roomId ?? null) || "객실";
  };
  const roomName = (id: string) => nameOf(id);
  for (const b of live) {
    const first = legsOf(b)[0]?.roomId ?? b.roomId;
    const added = !!start && b.checkIn > start && live.length > 1;
    push({
      key: `in-${b.id}`,
      kind: added ? "join" : "checkin",
      date: b.checkIn,
      title: `${added ? "객실 추가" : "입실"} · ${o.roomName(first)}`,
      sub: b.guestName ? `${b.guestName}${b.arrived ? "" : " · 입실 전"}` : b.arrived ? "" : "입실 전",
      bookingId: b.id,
      paymentId: null,
      future: b.checkIn > o.today && !b.arrived,
    });
    const legs = legsOf(b);
    for (let i = 1; i < legs.length; i++) {
      push({
        key: `mv-${b.id}-${i}`,
        kind: "move",
        date: legs[i]!.checkIn,
        title: `이동 · ${o.roomName(legs[i - 1]!.roomId)} → ${o.roomName(legs[i]!.roomId)}`,
        sub: legs[i]!.checkIn > o.today ? "이동 예정" : "",
        bookingId: b.id,
        paymentId: null,
        future: legs[i]!.checkIn > o.today,
      });
    }
    const end = stayEnd(b);
    const done = !!b.checkedOutAt;
    const outDate = done ? calendarDateOf(b.checkedOutAt!) : end;
    push({
      key: `out-${b.id}`,
      kind: "checkout",
      date: outDate,
      title: `${done ? "퇴실" : b.earlyOut ? "조기 퇴실 예정" : "퇴실 예정"} · ${o.roomName(legs[legs.length - 1]?.roomId ?? b.roomId)}`,
      sub: "",
      bookingId: b.id,
      paymentId: null,
      future: !done && outDate >= o.today,
    });
    for (const p of o.payments?.(b.id) ?? []) addPay(p, rows, o, roomName);
  }
  for (const p of o.groupPayments ?? []) addPay(p, rows, o, roomName);
  for (const c of o.changes ?? []) {
    if (!c.summary.startsWith("기록 정정")) continue;
    push({ key: `fx-${c.id}`, kind: "fix", date: calendarDateOf(c.at), title: c.summary.replace(/^기록 정정\s*·\s*/, "정정 · "), sub: "", bookingId: c.bookingId, paymentId: null, future: false });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.key.localeCompare(b.key));
}

function addPay(p: Payment, rows: TimelineRow[], o: TimelineOpts, roomName: (id: string) => string) {
  const line = payLines([p], { roomName, meId: o.meId })[0]!;
  rows.push({
    key: `pay-${p.id}`,
    kind: "pay",
    date: p.bizDate,
    title: `결제 · ${line.method} ${won(p.amount)}원`,
    sub: `${line.scope} · ${line.period} · ${line.cls}`,
    bookingId: p.bookingId || null,
    paymentId: p.id,
    future: false,
    order: KIND_ORDER.pay,
  });
}

// ---------- 정정 기록 문장 (booking_changes) ----------
export const FIX_PREFIX = "기록 정정 · ";
const clip = (s: string) => s.slice(0, 300);

export function paymentLabel(p: Pick<Payment, "method" | "amount" | "bizDate">): string {
  return `${PAYMENT_METHOD_LABEL[p.method]} ${won(p.amount)}원 (${md(p.bizDate)})`;
}

/** 결제 줄 정정 → 바뀐 칸만 한 줄로 */
export function fixPaymentSummary(before: Payment, after: PaymentEdit, roomName: (bookingId: string) => string): string {
  const parts: string[] = [];
  if (before.amount !== after.amount) parts.push(`금액 ${won(before.amount)} → ${won(after.amount)}원`);
  if (before.method !== after.method) parts.push(`수단 ${PAYMENT_METHOD_LABEL[before.method]} → ${PAYMENT_METHOD_LABEL[after.method]}`);
  if (before.bizDate !== after.bizDate) parts.push(`결제일 ${md(before.bizDate)} → ${md(after.bizDate)}`);
  const scopeOf = (bookingId: string | null | undefined) => (bookingId ? roomName(bookingId) : "단체 몫");
  const from = scopeOf(before.bookingId || null);
  const to = scopeOf(after.bookingId);
  if (from !== to) parts.push(`대상 ${from} → ${to}`);
  const pb = periodText(before) ?? "미지정";
  const pa = periodText({ nightDate: after.bookingId ? after.nightDate : null, periodNights: after.bookingId ? after.periodNights : null }) ?? "미지정";
  if (pb !== pa) parts.push(`기간 ${pb} → ${pa}`);
  if ((before.note ?? "") !== (after.note?.trim() ?? "")) parts.push("메모 수정");
  if (before.kind !== after.kind) parts.push(`종류 ${before.kind === "deposit" ? "선금" : "잔금"} → ${after.kind === "deposit" ? "선금" : "잔금"}`);
  return clip(`${FIX_PREFIX}결제 수정 (${paymentLabel(before)}): ${parts.join(", ") || "변경 없음"}`);
}
export function fixPaymentAddSummary(p: Pick<Payment, "method" | "amount" | "bizDate" | "bookingId" | "nightDate" | "periodNights">, roomName: (bookingId: string) => string): string {
  const per = periodText(p);
  return clip(`${FIX_PREFIX}결제 추가: ${paymentLabel(p)} · ${p.bookingId ? roomName(p.bookingId) : "단체 몫"}${per ? ` · ${per}` : ""}`);
}
export function fixPaymentDeleteSummary(p: Payment, roomName: (bookingId: string) => string): string {
  return clip(`${FIX_PREFIX}결제 삭제: ${paymentLabel(p)} · ${p.bookingId ? roomName(p.bookingId) : "단체 몫"}`);
}
export function fixPaymentRestoreSummary(p: Payment, roomName: (bookingId: string) => string): string {
  return clip(`${FIX_PREFIX}결제 삭제 되돌림: ${paymentLabel(p)} · ${p.bookingId ? roomName(p.bookingId) : "단체 몫"}`);
}
export function fixStaySummary(room: string, b: { checkIn: string; nights: number; price: number }, a: { checkIn: string; nights: number; price: number }): string {
  const parts: string[] = [];
  if (b.checkIn !== a.checkIn) parts.push(`입실 ${md(b.checkIn)} → ${md(a.checkIn)}`);
  if (b.nights !== a.nights) parts.push(`${b.nights}박 → ${a.nights}박`);
  if (b.price !== a.price) parts.push(`객실료 ${won(b.price)} → ${won(a.price)}원`);
  return clip(`${FIX_PREFIX}${room} ${parts.join(", ") || "요금 배분 수정"}`);
}

// ---------- 어긋남 안내 (참고용 · 아무것도 막지 않아요) ----------
export function recordAdvisories(o: { bookings: readonly (TimelineBooking & { payments?: Payment[] })[]; groupPayments?: readonly Payment[]; ledger?: Pick<GroupLedger, "prepaid" | "owed" | "lump"> | null; roomName: (id: string | null | undefined) => string }): string[] {
  const out: string[] = [];
  for (const b of o.bookings) {
    for (const p of b.payments ?? []) {
      const x = payPeriod(p);
      if (x && b.nights && (x.from < b.checkIn || x.to >= addDays(b.checkIn, b.nights))) out.push(`${o.roomName(b.roomId)} 결제 ${paymentLabel(p)}의 기간이 숙박 기간 밖이에요`);
    }
  }
  const lump = (o.groupPayments ?? []).reduce((n, p) => n + p.amount, 0);
  if (lump > 0) out.push(`객실에 안 나눈 단체 몫 ${won(lump)}원이 있어요 (앞 박부터 채워져요) · 객실별로 지정하면 더 정확해요`);
  if (o.ledger && o.ledger.prepaid > 0) out.push(`선수금 ${won(o.ledger.prepaid)}원이 남아 있어요`);
  return out;
}

export { balanceLabel };
