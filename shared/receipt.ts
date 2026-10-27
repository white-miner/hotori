// 결제 등록(단체): 금액 · 기간 · 객실 · 방법을 직원이 자유롭게 정해요.
//  · 기간 없음 = 선수금/단체 잔액으로 등록, 맨 앞 미결제 박부터 자동 반영
//  · 기간 N박 / ~날짜까지 = 그 기간의 미결제 금액이 제안값 (수정 가능)
//  · 객실 일부만도 가능 · 금액이 제안값과 달라도 막지 않고 안내만
// 저장은 객실별 줄 + (남는 돈이 있으면) 단체 몫 한 줄. 합계는 입력한 금액과 항상 같아요.
import { addDays, daysBetween, md, won } from "./ledger";
import type { GroupLedger } from "./groupLedger";
import { allocateTotal } from "./periodPay";

export type ReceiptPeriod = { kind: "none" } | { kind: "later" } | { kind: "nights"; nights: number } | { kind: "through"; date: string };

export const RECEIPT_NIGHTS_MAX = 366;
export const RECEIPT_AMOUNT_MAX = 100_000_000;

export interface ReceiptInput {
  ledger: GroupLedger;
  /** 결제에 포함할 객실(예약 id). null = 남은 박이 있는 객실 전부 */
  roomIds: readonly string[] | null;
  period: ReceiptPeriod;
  /** 기간 시작일. null = 선택한 객실의 맨 앞 미결제 박 */
  start?: string | null;
  /** 직접 입력한 금액. null = 제안값 */
  amount?: number | null;
}

export interface ReceiptRow {
  bookingId: string;
  /** 기간 안에서 이 객실이 낼 금액(제안) */
  suggested: number;
  /** 기간 안에서 이 객실의 미결제 박 수 */
  nights: number;
  /** 기간 안 첫 미결제 박 요금 */
  perNight: number;
  /** 저장될 금액 */
  amount: number;
}

export interface ReceiptLine {
  bookingId: string;
  amount: number;
  /** 기간 표시 · 없으면 맨 앞 미결제 박부터 채움 */
  nightDate: string | null;
  periodNights: number | null;
  note: string;
}

export interface ReceiptPlan {
  /** 입력 객실 (미결제 박이 없는 객실도 포함 · 수정할 때 보여 주려고) */
  rows: ReceiptRow[];
  /** 기간이 있을 때 첫 박·마지막 박·박수 */
  start: string | null;
  end: string | null;
  nights: number;
  /** 기간 안 제안 합계 (기간 없음이면 선택 객실의 오늘 밤까지 미수금 · 없으면 0) */
  suggested: number;
  /** 저장할 합계 */
  total: number;
  /** total − suggested (기간 있을 때만 의미) */
  diff: number;
  lines: ReceiptLine[];
  /** 객실에 안 나눈 몫 → 단체 선수금 · 없으면 null */
  lump: { amount: number; note: string } | null;
  /** 객실에 나누지 못해 단체 선수금으로 남는 금액 (= lump?.amount ?? 0) */
  carry: number;
  /** 안내 문구 (막지 않아요) */
  notes: string[];
  /** 저장 가능 여부 (금액 > 0 · 상한 이내) */
  ok: boolean;
  error: string | null;
}

/** 단체가 이어서 결제할 기본 시작일: 남은 객실의 맨 앞 미결제 박 → 없으면 오늘 */
export function receiptDefaultStart(ledger: GroupLedger, roomIds: readonly string[] | null, today: string): string {
  const pick = pickRooms(ledger, roomIds);
  let best: string | null = null;
  for (const r of pick.filter((x) => x.live)) if (r.firstUncovered && (!best || r.firstUncovered < best)) best = r.firstUncovered;
  if (!best) for (const r of pick) if (r.firstUncovered && (!best || r.firstUncovered < best)) best = r.firstUncovered;
  return best ?? today;
}

function pickRooms(ledger: GroupLedger, roomIds: readonly string[] | null) {
  if (!roomIds) return ledger.rooms.filter((r) => r.live);
  const set = new Set(roomIds);
  return ledger.rooms.filter((r) => set.has(r.bookingId));
}

/** 기본 선택 객실: 남은 박이 있는 객실 모두 (이미 끝난 객실은 빠짐) */
export function receiptDefaultRooms(ledger: GroupLedger): string[] {
  const live = ledger.rooms.filter((r) => r.live).map((r) => r.bookingId);
  return live.length ? live : ledger.rooms.map((r) => r.bookingId);
}

/** 다음 기간 박수 제안: 지난번 박수(없으면 1) · 오늘 밤까지 밀린 박이 더 많으면 그만큼 */
export function receiptDefaultNights(ledger: GroupLedger): number {
  return Math.min(RECEIPT_NIGHTS_MAX, Math.max(ledger.lastPeriodNights ?? 1, ledger.unpaidNightsToday, 1));
}

export function receiptPlan(inp: ReceiptInput, today: string): ReceiptPlan {
  const { ledger, period } = inp;
  const rooms = pickRooms(ledger, inp.roomIds);
  const empty = (error: string | null): ReceiptPlan => ({
    rows: [], start: null, end: null, nights: 0, suggested: 0, total: 0, diff: 0, lines: [], lump: null, carry: 0, notes: [], ok: false, error,
  });
  if (!rooms.length) return empty("결제할 객실을 골라 주세요.");

  let start: string | null = null;
  let end: string | null = null;
  let nights = 0;
  if (period.kind !== "none" && period.kind !== "later") {
    start = inp.start ?? receiptDefaultStart(ledger, inp.roomIds, today);
    if (period.kind === "nights") {
      nights = Math.max(1, Math.min(RECEIPT_NIGHTS_MAX, Math.round(period.nights) || 1));
      end = addDays(start, nights - 1);
    } else {
      end = period.date < start ? start : period.date;
      nights = Math.min(RECEIPT_NIGHTS_MAX, daysBetween(start, end) + 1);
      end = addDays(start, nights - 1);
    }
  }

  const rows: ReceiptRow[] = rooms.map((r) => {
    const open = r.nights.filter((n) => n.covered < n.amount && (!start || (n.date >= start && n.date <= end!)));
    return {
      bookingId: r.bookingId,
      suggested: open.reduce((s, n) => s + n.amount - n.covered, 0),
      nights: open.length,
      perNight: open[0]?.amount ?? 0,
      amount: 0,
    };
  });
  const shares = rows.map((r) => r.suggested);
  const suggestedWindow = shares.reduce((s, x) => s + x, 0);
  // 기간 없음: 제안 = 선택 객실의 오늘 밤까지 미수금
  const owedToday = rooms.reduce((s, r) => s + r.nights.filter((n) => n.date <= today).reduce((a, n) => a + n.amount - n.covered, 0), 0);
  const suggested = period.kind === "none" || period.kind === "later" ? owedToday : suggestedWindow;

  const amount = inp.amount == null ? suggested : Math.round(inp.amount);
  const notes: string[] = [];
  if (!Number.isFinite(amount) || amount <= 0) return { ...empty(period.kind === "none" ? "금액을 적어 주세요." : null), rows, start, end, nights, suggested, notes: [], ok: false, error: "금액을 적어 주세요." };
  if (amount > RECEIPT_AMOUNT_MAX) return { ...empty("금액을 확인해 주세요."), rows, start, end, nights, suggested };

  // 나중에 배분: 객실로 나누지 않고 단체에 받은 돈으로만 적어요 (총 받은 돈에는 바로 반영)
  if (period.kind === "later") {
    rows.forEach((r) => (r.amount = 0));
    return {
      rows, start: null, end: null, nights: 0, suggested: owedToday, total: amount, diff: 0, lines: [],
      lump: { amount, note: "나중에 배분" }, carry: amount,
      notes: ["객실로 나누지 않고 단체에 받은 돈으로 적어요. 요약에는 앞 날부터 채운 것으로 보고, 나중에 「배분하기」로 확정해요."],
      ok: true, error: null,
    };
  }

  const lines: ReceiptLine[] = [];
  const range = start && end ? (nights === 1 ? md(start) : `${md(start)}~${md(end)}`) : "";
  let lump: ReceiptPlan["lump"] = null;

  if (period.kind === "none") {
    // 맨 앞 미결제 박부터 (날짜 → 객실 순) 선택 객실에 채우고, 남으면 단체 선수금
    const flat: { i: number; date: string; open: number }[] = [];
    rooms.forEach((r, i) => r.nights.forEach((n) => n.covered < n.amount && flat.push({ i, date: n.date, open: n.amount - n.covered })));
    flat.sort((a, b) => a.date.localeCompare(b.date) || a.i - b.i);
    let rest = amount;
    const per = rooms.map(() => 0);
    for (const f of flat) {
      if (rest <= 0) break;
      const take = Math.min(rest, f.open);
      per[f.i]! += take;
      rest -= take;
    }
    rows.forEach((r, i) => (r.amount = per[i]!));
    per.forEach((a, i) => a > 0 && lines.push({ bookingId: rooms[i]!.bookingId, amount: a, nightDate: null, periodNights: null, note: "결제 등록" }));
    if (rest > 0) lump = { amount: rest, note: "선수금(단체 잔액)" };
    notes.push(rest > 0 ? `${won(rest)}원은 선수금으로 남아요 · 다음 박부터 자동 반영` : "맨 앞 미결제 박부터 자동 반영돼요");
  } else {
    const window = Math.min(amount, suggestedWindow);
    const part = window === suggestedWindow ? shares : allocateTotal(window, shares);
    const note = `기간결제 ${range} ${nights}박`.slice(0, 80);
    rows.forEach((r, i) => {
      r.amount = part[i]!;
      if (part[i]! > 0) lines.push({ bookingId: r.bookingId, amount: part[i]!, nightDate: start, periodNights: nights, note });
    });
    const extra = amount - window;
    if (extra > 0) {
      lump = { amount: extra, note: `선수금(단체 잔액) · ${range}` .slice(0, 80) };
      notes.push(suggestedWindow > 0 ? `제안보다 ${won(extra)}원 더 결제했어요 · 선수금으로 두고 다음 박에 반영해요` : `${range}은(는) 이미 결제된 기간이에요 · ${won(extra)}원은 선수금으로 둬요`);
    } else if (window < suggestedWindow) {
      notes.push(`제안보다 ${won(suggestedWindow - window)}원 적어요 · 일부 결제로 등록하고 나머지는 미수금으로 남아요`);
    }
  }

  const total = lines.reduce((s, l) => s + l.amount, 0) + (lump?.amount ?? 0);
  return {
    rows,
    start,
    end,
    nights,
    suggested,
    total,
    diff: period.kind === "none" ? 0 : amount - suggestedWindow,
    lines,
    lump,
    carry: lump?.amount ?? 0,
    notes,
    ok: total > 0,
    error: null,
  };
}

/** 확인 문구: `3박 × 3객실 = 690,000원` · 기간 없음은 `선수금 · 500,000원` */
export function receiptHeadline(plan: ReceiptPlan, period: ReceiptPeriod): string {
  if (!plan.ok) return plan.error ?? "금액을 적어 주세요";
  if (period.kind === "later") return `${won(plan.total)}원 · 나중에 배분`;
  if (period.kind === "none") return `${won(plan.total)}원 결제 등록`;
  const act = plan.rows.filter((r) => r.amount > 0);
  const roomsN = act.length || plan.rows.length;
  const same = act.length > 0 && act.every((r) => r.nights === plan.nights);
  const base = same ? `${plan.nights}박 × ${roomsN}객실` : `${plan.nights}박 · ${roomsN}객실`;
  return `${base} = ${won(plan.total)}원`;
}

/** 단체 머리글의 큰 버튼: `결제 등록 · 3박 690,000원` — 열면 같은 값으로 채워져 있어요. 제안할 금액이 없으면 그냥 `결제 등록` */
export function receiptNextAction(ledger: GroupLedger, today: string): { label: string; nights: number; amount: number } {
  const nights = receiptDefaultNights(ledger);
  const plan = receiptPlan({ ledger, roomIds: null, period: { kind: "nights", nights } }, today);
  if (!plan.suggested) return { label: "결제 등록", nights, amount: 0 };
  return { label: `결제 등록 · ${nights}박 ${won(plan.suggested)}원`, nights, amount: plan.suggested };
}

/**
 * 나중에 배분 확정 미리보기: 단체에 받아 둔 돈 한 줄(amount)을 앞 날부터(날짜 → 객실 순) 객실별 미결제 박에 채워요.
 * ledger = 이 돈을 뺀 단체 요약(다른 선수금은 이미 반영). 넘치는 몫(rest)은 단체 몫으로 남아요.
 */
export function allocatePlan(ledger: GroupLedger, amount: number): { lines: { bookingId: string; amount: number }[]; rest: number } {
  const flat: { i: number; date: string; open: number }[] = [];
  ledger.rooms.forEach((r, i) => r.nights.forEach((n) => n.covered < n.amount && flat.push({ i, date: n.date, open: n.amount - n.covered })));
  flat.sort((a, b) => a.date.localeCompare(b.date) || a.i - b.i);
  let rest = Math.max(0, Math.round(amount));
  const per = ledger.rooms.map(() => 0);
  for (const f of flat) {
    if (rest <= 0) break;
    const take = Math.min(rest, f.open);
    per[f.i]! += take;
    rest -= take;
  }
  const lines = per.flatMap((a, i) => (a > 0 ? [{ bookingId: ledger.rooms[i]!.bookingId, amount: a }] : []));
  return { lines, rest };
}
