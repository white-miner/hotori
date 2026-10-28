// 단체 기간 결제: 몇 박을 냈는지(박별 결제 상태) + "다음 N박 × 방 수" 합계 계산.
//  · 새 결제 테이블 없음. 방(예약)별 booking_payments 한 줄씩 — night_date(첫 박) + period_nights(박수)로 기간을 적어요.
//  · 기간 표시 없는 결제(예전 결제·선금·잔금)는 맨 앞 미결제 박부터 채워요(FIFO). 기존 결제·장부 합계는 안 바뀌어요.
import { type Booking, addDays, daysBetween, isActive, md, revenueOf, stayEnd, won } from "./ledger";
import { hasFullNightMatrix, splitAmountLast } from "./nightrates";
import type { Payment } from "./payment";

export type PeriodBooking = Pick<
  Booking,
  "id" | "status" | "kind" | "checkIn" | "nights" | "price" | "priceUnset" | "earlyOut" | "refund" | "nightRates" | "payments" | "checkedOutAt" | "stayMode" | "openEnded"
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
  /** 청구액 (환불·조기 퇴실 반영 = revenueOf) */
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
 * 조기 퇴실이면 묵은 박까지만. 합계는 항상 revenueOf(판매가 − 환불)가 되도록 마지막 박에서 가감해요
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
