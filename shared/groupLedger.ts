// 단체 요금·결제 비교: 두 장부를 따로 두고 견줘요.
//  (A) 객실 요금 = 객실마다 날짜별(요일별) 박 요금 → 객실 소계 → 단체 청구 합계
//  (B) 결제 내역 = 실제로 받은 돈을 날짜·수단·금액 한 줄씩 (객실·박에 나누지 않아요)
//  청구 합계(A) − 결제 합계(B) = 미수금 / 초과 수납 / 정산 완료.
// 결제를 객실이나 박에 배분하지 않아요 — 객실마다 요금이 달라도 평균이 되지 않고, 숫자는 항상 두 합계의 차이예요.
import { addDays, md, stayEnd, won } from "./ledger";
import { type RoomExtra, cleanRoomExtras, extrasTotal } from "./nightrates";
import { type PeriodBooking, isPeriodPayable, stayNightAmounts } from "./periodPay";

export interface RoomLedger {
  bookingId: string;
  /** 입실일 (첫 박) */
  checkIn: string;
  /** 퇴실일 (마지막 박 다음 날) · 퇴실 미정이면 지금까지 기록된 마지막 박 다음 날 */
  checkOut: string;
  nights: number;
  /** 이용 기간 미정 (퇴실일 없음) */
  openEnded: boolean;
  /** 박별 요금 (청구액) */
  rows: { date: string; amount: number }[];
  /** 객실 소계 (환불·조기 퇴실 반영) — 박 요금 + 이 객실의 추가 항목 */
  subtotal: number;
  /** 이 객실만의 추가 항목 (인원 추가 · 추가 이불 · 계약 조건 …) */
  extraLines: RoomExtra[];
  /** 추가 항목 합 (소계에 이미 들어 있어요) */
  extraTotal: number;
  /** 박 요금의 최저 · 최고 (모두 같으면 같은 값) */
  rateMin: number;
  rateMax: number;
  firstNight: string | null;
  lastNight: string | null;
  /** 아직 남은 박이 있음 (마지막 박 ≥ 오늘) */
  live: boolean;
  /** 오늘 밤에 머무는 중 */
  staying: boolean;
  /** 오늘 밤 요금 (머무는 중일 때) */
  tonight: number;
  /** 이 객실에 적어 둔 결제 합 (참고용 · 청구와 비교는 단체 전체 합계로만 해요) */
  noted: number;
}

export interface GroupLedger {
  rooms: RoomLedger[];
  /** 요금 대상 객실 수 (취소·대실·장기 제외) */
  roomCount: number;
  /** 아직 남은 박이 있는 객실 수 */
  liveCount: number;
  /** 객실 요금 합 (모든 박) */
  roomCharges: number;
  /** 단체 추가 항목(식사 등) 합 */
  extras: number;
  /** 청구 합계 (A) = 객실 요금 + 추가 항목 */
  due: number;
  /** 결제 합계 (B) = 객실에 적은 결제 + 단체로 받은 결제 */
  paid: number;
  /** 단체로 받은 결제 합 (객실 표시 없이 받은 돈) */
  lump: number;
  /** 결제 − 청구. 음수 = 미수금, 양수 = 초과 수납 */
  balance: number;
  /** 미수금 (받을 금액) */
  owed: number;
  /** 초과 수납 (더 받은 금액) */
  prepaid: number;
  /** 오늘 밤 하룻밤 합계 */
  tonight: number;
  /** 결제 줄 수 */
  payCount: number;
}

export interface GroupLedgerOpts {
  /** 단체 추가 항목(식사 등) 합 */
  extras?: number;
}

const sum = (xs: readonly number[]) => xs.reduce((n, x) => n + x, 0);

/**
 * 단체 요약. members = 단체의 예약 전부 (취소·대실·장기는 자동으로 빠져요), lump = 단체로 받은 결제 합.
 * today = 영업일. 결제는 객실·박에 나누지 않고 합계만 써요.
 */
export function groupLedger(members: readonly PeriodBooking[], lump: number, today: string, opts: GroupLedgerOpts = {}): GroupLedger {
  const payable = members.filter(isPeriodPayable);
  const extras = Math.max(0, Math.round(opts.extras ?? 0));
  const lumpSum = Math.round(lump) || 0;
  const rooms: RoomLedger[] = payable.map((b) => {
    const rows = stayNightAmounts(b);
    const extraLines = cleanRoomExtras(b.nightRates?.extras);
    const extraTotal = Math.min(extrasTotal(b.nightRates), sum(rows.map((r) => r.amount)));
    // 추가 항목은 마지막 박에 합쳐져 있으니 박 요금 범위(최저·최고)에서는 빼서 봐요
    const amounts = rows.map((r, i) => (i === rows.length - 1 ? Math.max(0, r.amount - extraTotal) : r.amount));
    const last = rows.length ? rows[rows.length - 1]!.date : null;
    const tonightRow = rows.find((r) => r.date === today);
    return {
      bookingId: b.id,
      checkIn: b.checkIn,
      checkOut: rows.length ? addDays(last!, 1) : stayEnd(b),
      nights: rows.length,
      openEnded: b.openEnded === true,
      rows,
      subtotal: sum(rows.map((r) => r.amount)),
      extraLines,
      extraTotal,
      rateMin: amounts.length ? Math.min(...amounts) : 0,
      rateMax: amounts.length ? Math.max(...amounts) : 0,
      firstNight: rows[0]?.date ?? null,
      lastNight: last,
      live: !!last && last >= today,
      staying: !!tonightRow,
      tonight: tonightRow?.amount ?? 0,
      noted: sum((b.payments ?? []).map((p) => p.amount)),
    };
  });
  const noted = sum(rooms.map((r) => r.noted));
  const roomCharges = sum(rooms.map((r) => r.subtotal));
  const due = roomCharges + extras;
  const paid = noted + lumpSum;
  const balance = paid - due;
  return {
    rooms,
    roomCount: payable.length,
    liveCount: rooms.filter((r) => r.live).length,
    roomCharges,
    extras,
    due,
    paid,
    lump: lumpSum,
    balance,
    owed: Math.max(0, -balance),
    prepaid: Math.max(0, balance),
    tonight: sum(rooms.map((r) => r.tonight)),
    payCount: payable.reduce((n, b) => n + (b.payments?.length ?? 0), 0),
  };
}

export type GroupTone = "owed" | "prepaid" | "even" | "none";
export function groupTone(g: GroupLedger): GroupTone {
  if (!g.roomCount) return "none";
  return g.owed > 0 ? "owed" : g.prepaid > 0 ? "prepaid" : "even";
}

/** 헤더 큰 숫자: `미수금 80,000원` · `초과 수납 50,000원` · `정산 완료` */
export function balanceLabel(g: Pick<GroupLedger, "owed" | "prepaid">): string {
  if (g.owed > 0) return `미수금 ${won(g.owed)}원`;
  if (g.prepaid > 0) return `초과 수납 ${won(g.prepaid)}원`;
  return "정산 완료";
}

/** 차액 한 줄: `청구 960,000원 − 결제 880,000원 = 미수금 80,000원` */
export function diffLine(g: Pick<GroupLedger, "due" | "paid" | "owed" | "prepaid">): string {
  return `청구 ${won(g.due)}원 − 결제 ${won(g.paid)}원 = ${balanceLabel(g)}`;
}

/** 박 요금 문구: 모두 같으면 `80,000원` · 요일마다 다르면 `70,000~80,000원 (요일별)` */
export function rateLabel(r: Pick<RoomLedger, "rateMin" | "rateMax" | "nights">): string {
  if (!r.nights) return "요금 없음";
  return r.rateMin === r.rateMax ? `${won(r.rateMin)}원` : `${won(r.rateMin)}~${won(r.rateMax)}원 (요일별)`;
}

/** 기간 문구: `10/25 ~ 10/27 · 3박` · 퇴실 미정은 `10/25 ~ 퇴실 미정` */
export function stayRangeLabel(r: Pick<RoomLedger, "checkIn" | "lastNight" | "nights" | "openEnded">): string {
  if (r.openEnded) return `${md(r.checkIn)} ~ 퇴실 미정`;
  if (!r.nights || !r.lastNight) return md(r.checkIn);
  return r.checkIn === r.lastNight ? `${md(r.checkIn)} · 1박` : `${md(r.checkIn)} ~ ${md(r.lastNight)} · ${r.nights}박`;
}
