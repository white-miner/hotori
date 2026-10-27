// 단체 기간 결제: 몇 박을 냈는지(박별 결제 상태) + "다음 N박 × 방 수" 합계 계산.
//  · 새 결제 테이블 없음. 방(예약)별 booking_payments 한 줄씩 — night_date(첫 박) + period_nights(박수)로 기간을 적어요.
//  · 기간 표시 없는 결제(예전 결제·선금·잔금)는 맨 앞 미결제 박부터 채워요(FIFO). 기존 결제·장부 합계는 안 바뀌어요.
import { type Booking, addDays, daysBetween, isActive, md, revenueOf, stayEnd, won } from "./ledger";
import { hasFullNightMatrix, splitAmountLast } from "./nightrates";
import type { Payment } from "./payment";

export type PeriodBooking = Pick<
  Booking,
  "id" | "status" | "kind" | "checkIn" | "nights" | "price" | "priceUnset" | "earlyOut" | "refund" | "nightRates" | "payments" | "checkedOutAt" | "stayMode"
>;

export interface NightSlot {
  date: string;
  /** 이 박에 청구액 */
  amount: number;
  /** 이 박에 수납액 (≤ amount) */
  covered: number;
}
export type NightState = "paid" | "partial" | "unpaid";
export const nightState = (n: NightSlot): NightState => (n.covered >= n.amount ? "paid" : n.covered > 0 ? "partial" : "unpaid");

export interface StayCoverage {
  bookingId: string;
  nights: NightSlot[];
  /** 청구액 (환불·중도퇴실 반영 = revenueOf) */
  due: number;
  paid: number;
  /** 아직 청구액 */
  left: number;
  /** 청구액보다 더 수납액 */
  over: number;
  /** 맨 앞 미결제(또는 일부) 박 · 다 냈으면 null */
  firstUnpaid: string | null;
}

/** 기간 결제 대상: 활성 숙박 · 박 단위(장기 원장 제외) · 입실 박수 있음 */
export function isPeriodPayable(b: Pick<Booking, "status" | "kind" | "nights" | "stayMode">): boolean {
  return isActive(b) && b.kind === "stay" && !!b.nights && b.stayMode !== "long_stay";
}

/**
 * 박별 청구액. 박별 요금(night_rates)이 LOS를 덮으면 그대로, 아니면 판매가를 똑같이(나머지는 마지막 박).
 * 중도퇴실이면 묵은 박까지만. 합계는 항상 revenueOf(판매가 − 환불)가 되도록 마지막 박에서 가감해요
 * (추가금·환불·반올림 차이). 빼다가 0 아래로 가면 앞 박에서 이어서 빼요.
 */
export function stayNightAmounts(b: PeriodBooking): { date: string; amount: number }[] {
  if (!isPeriodPayable(b)) return [];
  const total = b.nights!;
  const end = stayEnd(b);
  const used = Math.max(0, daysBetween(b.checkIn, end));
  const useMatrix = hasFullNightMatrix(b.checkIn, total, b.nightRates ?? null);
  const base = useMatrix
    ? Array.from({ length: used }, (_, i) => Math.max(0, Math.round(Number(b.nightRates!.nights![addDays(b.checkIn, i)]) || 0)))
    : splitAmountLast(b.price, total).slice(0, used);
  if (!base.length) return [];
  const target = Math.max(0, revenueOf(b));
  let adj = target - base.reduce((n, x) => n + x, 0);
  for (let i = base.length - 1; i >= 0 && adj !== 0; i--) {
    const next = Math.max(0, base[i]! + adj);
    adj -= next - base[i]!;
    base[i] = next;
  }
  return base.map((amount, i) => ({ date: addDays(b.checkIn, i), amount }));
}

const isTagged = (p: Pick<Payment, "nightDate" | "periodNights">) => !!p.nightDate && !!p.periodNights && p.periodNights > 0;
const payOrder = (a: Payment, b: Payment) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** 박별 결제 채움: 기간 표시 있는 결제는 그 박들 먼저 · 초과 수납액과 기간 미지정 수납액은 맨 앞 미결제 박부터 */
export function stayCoverage(b: PeriodBooking): StayCoverage {
  const nights: NightSlot[] = stayNightAmounts(b).map((n) => ({ ...n, covered: 0 }));
  const pays = [...(b.payments ?? [])].sort(payOrder);
  let pool = 0;
  for (const p of pays) {
    if (!isTagged(p)) {
      pool += p.amount;
      continue;
    }
    let rest = p.amount;
    const last = addDays(p.nightDate!, p.periodNights! - 1);
    for (const n of nights) {
      if (rest <= 0) break;
      if (n.date < p.nightDate! || n.date > last) continue;
      const take = Math.min(rest, n.amount - n.covered);
      n.covered += take;
      rest -= take;
    }
    pool += rest;
  }
  for (const n of nights) {
    if (pool <= 0) break;
    const take = Math.min(pool, n.amount - n.covered);
    n.covered += take;
    pool -= take;
  }
  const due = nights.reduce((n, x) => n + x.amount, 0);
  const paid = pays.reduce((n, x) => n + x.amount, 0);
  const first = nights.find((n) => n.covered < n.amount);
  return {
    bookingId: b.id,
    nights,
    due,
    paid,
    left: Math.max(0, due - paid),
    over: Math.max(0, paid - due),
    firstUnpaid: first?.date ?? null,
  };
}

export interface CoverageRun {
  from: string;
  to: string;
  nights: number;
  state: "paid" | "unpaid";
}
/** 연속한 박을 결제 완료 / 미결제(일부 포함)로 묶어요 */
export function coverageRuns(c: StayCoverage): CoverageRun[] {
  const out: CoverageRun[] = [];
  for (const n of c.nights) {
    const state = nightState(n) === "paid" ? "paid" : "unpaid";
    const prev = out[out.length - 1];
    if (prev && prev.state === state) {
      prev.to = n.date;
      prev.nights++;
    } else out.push({ from: n.date, to: n.date, nights: 1, state });
  }
  return out;
}

/** 방 한 줄 요약: `3박 결제 완료 · 이후 미결제` · `전체 30박 결제 완료` · `미결제` */
export function coverageSummary(c: StayCoverage): string {
  const runs = coverageRuns(c);
  if (!runs.length) return "청구액 없음";
  if (runs.length === 1) return runs[0]!.state === "paid" ? `전체 ${runs[0]!.nights}박 결제 완료` : "미결제";
  const range = (r: CoverageRun) => (r.from === r.to ? md(r.from) : `${md(r.from)}~${md(r.to)}`);
  if (runs.length === 2 && runs[0]!.state === "paid") return `${runs[0]!.nights}박 결제 완료(~${md(runs[0]!.to)}) · 이후 미결제`;
  return runs.map((r) => `${range(r)} ${r.state === "paid" ? "결제" : "미결제"}`).join(" · ");
}

// ---------------- 단체 기간 ----------------
export interface PeriodRow {
  bookingId: string;
  /** 이번 기간에 이 방이 납부액 (이미 낸 박은 뺌) */
  amount: number;
  /** 이번 기간에 이 방에서 결제할 박 수 */
  nights: number;
  /** 박당(이번 기간 첫 미결제 박) 요금 */
  perNight: number;
}
export interface GroupPeriodPlan {
  /** 첫 박 · 마지막 박 (둘 다 포함) · 박수 · 납부액이 없으면 null */
  start: string | null;
  end: string | null;
  nights: number;
  rows: PeriodRow[];
  total: number;
  /** 방 수 (이번 기간에 납부액이 있는 방) */
  rooms: number;
  /** 단체 전체에서 이 시작일 이후로 남은 최대 박 수 */
  maxNights: number;
}

/** 단체에서 맨 앞 미결제 박 */
export function groupFirstUnpaid(covs: readonly StayCoverage[]): string | null {
  let best: string | null = null;
  for (const c of covs) if (c.firstUnpaid && (!best || c.firstUnpaid < best)) best = c.firstUnpaid;
  return best;
}

/**
 * 다음 N박 합계: start부터 N박 × 모든 방의 미결제 금액.
 * start 기본 = 단체의 맨 앞 미결제 박. 퇴실 뒤 박은 그 방 몫이 0 · 박수는 남은 박까지만 잘려요.
 */
export function planGroupPeriod(covs: readonly StayCoverage[], nights: number, startDate?: string | null): GroupPeriodPlan {
  const first = groupFirstUnpaid(covs);
  const start = startDate && (!first || startDate >= first) ? startDate : first;
  const empty: GroupPeriodPlan = { start: null, end: null, nights: 0, rows: [], total: 0, rooms: 0, maxNights: 0 };
  if (!start) return empty;
  let lastNight: string | null = null;
  for (const c of covs) for (const n of c.nights) if (n.date >= start && n.covered < n.amount && (!lastNight || n.date > lastNight)) lastNight = n.date;
  if (!lastNight) return empty;
  const maxNights = daysBetween(start, lastNight) + 1;
  const count = Math.max(1, Math.min(Math.round(nights) || 1, maxNights));
  const end = addDays(start, count - 1);
  const rows: PeriodRow[] = covs.map((c) => {
    const win = c.nights.filter((n) => n.date >= start && n.date <= end);
    const open = win.filter((n) => n.covered < n.amount);
    return {
      bookingId: c.bookingId,
      amount: open.reduce((s, n) => s + n.amount - n.covered, 0),
      nights: open.length,
      perNight: open[0]?.amount ?? 0,
    };
  });
  const total = rows.reduce((n, r) => n + r.amount, 0);
  return { start, end, nights: count, rows, total, rooms: rows.filter((r) => r.amount > 0).length, maxNights };
}

/** 총액을 직접 고쳤을 때 방별로 나누기: 방 몫에 비례 · 최대잔여법(합 = total · 방 몫 0은 0) */
export function allocateTotal(total: number, shares: readonly number[]): number[] {
  const t = Math.max(0, Math.round(total));
  const sum = shares.reduce((n, x) => n + Math.max(0, x), 0);
  if (!shares.length || sum <= 0 || t <= 0) return shares.map(() => 0);
  const raw = shares.map((s) => (Math.max(0, s) * t) / sum);
  const out = raw.map((x) => Math.floor(x));
  let rest = t - out.reduce((n, x) => n + x, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .filter((x) => shares[x.i]! > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0 && order.length; k = (k + 1) % order.length) {
    out[order[k]!.i]!++;
    rest--;
  }
  return out;
}

/** 저장할 결제 내역 (방마다 한 줄 · 납부액 0인 방은 빠짐) */
export interface PeriodPayLine {
  bookingId: string;
  amount: number;
  nightDate: string;
  periodNights: number;
  note: string;
}
export function periodPayLines(plan: GroupPeriodPlan, total: number | null = null): PeriodPayLine[] {
  if (!plan.start || !plan.end || plan.total <= 0) return [];
  const shares = plan.rows.map((r) => r.amount);
  const amounts = total == null || total === plan.total ? shares : allocateTotal(total, shares);
  const range = plan.nights === 1 ? md(plan.start) : `${md(plan.start)}~${md(plan.end)}`;
  const note = `기간결제 ${range} ${plan.nights}박`.slice(0, 80);
  const lines: PeriodPayLine[] = [];
  plan.rows.forEach((r, i) => {
    const amount = amounts[i]!;
    if (amount > 0) lines.push({ bookingId: r.bookingId, amount, nightDate: plan.start!, periodNights: plan.nights, note });
  });
  return lines;
}

/** 확인 문구: `3박 × 3객실 = 690,000원` (방마다 박수가 다르면 `3박 · 3객실`) */
export function periodHeadline(plan: GroupPeriodPlan, total = plan.total): string {
  if (!plan.nights || !plan.rooms) return "결제할 박이 없어요";
  const same = plan.rows.filter((r) => r.amount > 0).every((r) => r.nights === plan.nights);
  return same ? `${plan.nights}박 × ${plan.rooms}객실 = ${won(total)}원` : `${plan.nights}박 · ${plan.rooms}객실 = ${won(total)}원`;
}
