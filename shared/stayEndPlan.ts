// 퇴실일 정하기 / 퇴실 미정 — 객실 하나(또는 단체 전체)의 이용 기간을 한 번에 바꾸는 계획.
//  · 퇴실 미정: 끝 날짜 없이 계속 묵어요. 지금 박수가 "오늘 밤 + 방 보호 일수"보다 길면 거기까지로 줄이고(남은 박 요금은 빠져요), 이후는 앱이 이어 줘요.
//  · 퇴실일: 그 날짜로 박수를 맞추고 미정을 꺼요. 늘어나는 밤은 마지막 박 요금 그대로예요.
// 요금은 박별 요금(밤 행렬)에서 계산하므로 객실마다 다른 요금이 평균이 되지 않아요. 결제는 건드리지 않아요.
import { type Booking, STAY_NIGHTS_MAX, daysBetween, fitSegments, isEarlyOut } from "./ledger";
import { applyExtend, lastNightRate, repriceForNights } from "./extend";
import { OPEN_HOLD_DEFAULT, clampHold, openStayNights } from "./openStay";

export type StayEndPatch = Pick<Booking, "nights" | "price" | "segments" | "nightRates"> & { openEnded: boolean; holdAhead: number };

export interface StayEndPlan {
  bookingId: string;
  /** null = 바꿀 수 없음 (reason 참고) */
  patch: StayEndPatch | null;
  reason: string | null;
  /** 박수 변화 (줄면 음수) */
  deltaNights: number;
  /** 요금 변화 (줄면 음수) */
  deltaPrice: number;
}

/** 아직 묵는 중이거나 올 예약만 바꿀 수 있어요 (퇴실·조기 퇴실·취소·대실 제외) */
export function canSetStayEnd(b: Pick<Booking, "status" | "kind" | "checkedOutAt" | "earlyOut" | "nights" | "checkIn">): boolean {
  return b.status === "active" && b.kind === "stay" && !b.checkedOutAt && !isEarlyOut(b);
}

/** out = null → 퇴실 미정 · out = 날짜 → 그날 퇴실 */
export function planStayEnd(b: Booking, out: string | null, today: string): StayEndPlan {
  const none = (reason: string): StayEndPlan => ({ bookingId: b.id, patch: null, reason, deltaNights: 0, deltaPrice: 0 });
  if (!canSetStayEnd(b)) return none("퇴실했거나 취소된 예약이에요");
  if (b.stayMode === "long_stay") return none("장기 투숙은 장기 설정에서 바꿔요");
  const n0 = b.nights ?? 1;
  let nights = n0;
  let hold = clampHold(b.holdAhead ?? OPEN_HOLD_DEFAULT);
  if (out === null) {
    const want = openStayNights(b.checkIn, today, hold);
    if (want < n0) nights = want;
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out)) return none("퇴실일을 골라 주세요");
    nights = daysBetween(b.checkIn, out);
    if (nights < 1) return none("퇴실일이 입실일보다 빨라요");
    if (nights > STAY_NIGHTS_MAX) return none(`최대 ${STAY_NIGHTS_MAX}박까지예요`);
    hold = clampHold(b.holdAhead ?? OPEN_HOLD_DEFAULT);
  }
  let price = b.price;
  let segments = b.segments ?? null;
  let nightRates = b.nightRates ?? null;
  if (nights < n0) {
    const r = repriceForNights(b, nights, null);
    price = r.price;
    nightRates = r.nightRates ?? nightRates;
    segments = fitSegments(b.segments, b.roomId, nights);
  } else if (nights > n0) {
    const rate = lastNightRate(b);
    let cur: Pick<Booking, "checkIn" | "nights" | "price" | "roomId" | "segments" | "nightRates"> = b;
    for (let i = n0; i < nights; i++) {
      const d = applyExtend(cur, rate);
      cur = { ...cur, nights: d.nights, price: d.price, segments: d.segments, nightRates: d.nightRates ?? cur.nightRates };
    }
    price = cur.price;
    segments = cur.segments ?? null;
    nightRates = cur.nightRates ?? null;
  }
  return {
    bookingId: b.id,
    patch: { nights, price, segments, nightRates, openEnded: out === null, holdAhead: hold },
    reason: null,
    deltaNights: nights - n0,
    deltaPrice: price - b.price,
  };
}

/** 한 줄 요약 (변경 기록·안내용) */
export function stayEndSummary(out: string | null, plans: readonly StayEndPlan[]): string {
  const ok = plans.filter((p) => p.patch);
  const n = ok.length;
  return out === null ? `퇴실 미정으로 바꿈${n > 1 ? ` (${n}실)` : ""}` : `퇴실일 ${out.slice(5).replace("-", "/")}로 바꿈${n > 1 ? ` (${n}실)` : ""}`;
}
