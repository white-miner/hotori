// 잔액은 여기서만 계산합니다. 화면은 이 결과를 읽기만 하고, 결제를 객실·박에 나누지 않습니다.
// 미수금 = 오늘 밤까지 청구 − 결제. 퇴실일까지 남은 박은 예정.
// 오늘 밤까지보다 더 받고 전체 청구 안이면 선수금, 전체 청구보다 더 받으면 초과 수납.
// OTA가 먼저 받은 예약은 결제 줄을 만들지 않고, 여기서만 'OTA 선결제'(미수금 0)로 봅니다.
import type { Booking } from "./ledger";
import { revenueOf } from "./ledger";
import { balanceLabel, groupLedger, type GroupLedger } from "./groupLedger";
import type { PeriodBooking } from "./periodPay";

/** today를 안 넘긴 호출은 퇴실일까지를 오늘로 봅니다. 화면은 영업일을 넘깁니다. */
export const FOLIO_THROUGH_STAY = "9999-12-31";

export interface Folio extends GroupLedger {
  /** 전체 청구보다 더 받은 금액 */
  over: number;
  /** 오늘 밤까지는 채우고, 전체 청구 안에서 더 받은 금액 */
  advance: number;
  /** OTA가 먼저 받음. 결제 줄 없음 · 미수금 0 */
  ota: boolean;
  priceUnset: boolean;
  /** 현장 미수금을 따지는지. OTA 선결제·금액미정은 false */
  tracked: boolean;
  /** 머리글·데스크가 같이 쓰는 문구 */
  label: string;
}

const paidSum = (b: { payments?: { amount: number }[] | null }) => (b.payments ?? []).reduce((n, p) => n + p.amount, 0);

/** 후불이 아니고 현장 채널이 아니면 OTA가 먼저 받은 것으로 봅니다. */
/** onsite가 null이면 플랫폼을 모르는 것이라 OTA로 단정하지 않습니다. */
export function otaPrepaidCovered(payMode: "prepaid" | "postpaid" | null | undefined, onsite: boolean | null): boolean {
  if (payMode === "postpaid" || onsite == null) return false;
  return !onsite;
}

export function folioOf(g: GroupLedger, opts: { ota?: boolean; priceUnset?: boolean; tracked?: boolean } = {}): Folio {
  const priceUnset = !!opts.priceUnset;
  const ota = !!opts.ota && !priceUnset;
  const over = Math.max(0, g.paid - g.due);
  const advance = Math.max(0, Math.min(g.paid, g.due) - g.dueSoFar);
  const owed = ota || priceUnset ? 0 : g.owed;
  const label = priceUnset ? "금액미정" : ota ? "OTA 선결제" : balanceLabel({ ...g, owed, prepaid: over });
  return {
    ...g,
    owed,
    prepaid: over,
    over,
    advance,
    ota,
    priceUnset,
    tracked: opts.tracked ?? (!ota && !priceUnset && g.roomCount > 0),
    label,
  };
}

/** 단체 한 장부. lump = 단체 결제 합, extras = 단체 추가 항목 합. */
export function groupFolio(
  members: readonly Booking[],
  lump: number,
  extras: number,
  opts: { onsite: boolean | null; payMode?: "prepaid" | "postpaid" | null; priceUnset?: boolean },
  today: string,
): Folio {
  const priceUnset = opts.priceUnset ?? members.some((b) => b.status !== "cancelled" && !!b.priceUnset && b.stayMode !== "long_stay");
  const g = groupLedger(members as unknown as PeriodBooking[], lump, today, { extras });
  return folioOf(g, { ota: !priceUnset && otaPrepaidCovered(opts.payMode, opts.onsite), priceUnset });
}

/** 객실 하나. 단체 몫 결제는 여기 넣지 않습니다. */
export function bookingFolio(b: Booking, onsite: boolean, today: string): Folio {
  if (b.priceUnset) {
    const empty = groupLedger([], 0, today);
    return folioOf({ ...empty, paid: paidSum(b) }, { priceUnset: true });
  }
  if (b.stayMode === "long_stay" && b.status === "active") return longStayFolio(b, onsite, today);
  const g = groupLedger([b as PeriodBooking], 0, today);
  if (b.status !== "active") {
    const due = revenueOf(b);
    return folioOf(
      { ...g, due, dueSoFar: due, upcoming: 0, paid: paidSum(b), owed: 0, balance: paidSum(b) - due, roomCount: 0 },
      { tracked: false },
    );
  }
  return folioOf(g, { ota: otaPrepaidCovered(null, onsite) });
}

/** 장기 원장. 오늘 다음 줄은 예정. */
export function longStayFolio(
  b: Pick<Booking, "charges" | "payments" | "priceUnset">,
  onsite: boolean,
  today: string,
): Folio {
  const rows = (b.charges ?? []).map((c) => {
    const legacy = c as { date?: string };
    return { date: c.nightDate || legacy.date || "", amount: c.amount };
  });
  const due = rows.reduce((n, x) => n + x.amount, 0);
  // 날짜가 없는 옛 원장 줄은 이미 청구된 것으로 봅니다.
  const dueSoFar = rows.filter((x) => !x.date || x.date <= today).reduce((n, x) => n + x.amount, 0);
  const upcoming = Math.max(0, due - dueSoFar);
  const paid = paidSum(b);
  const base = groupLedger([], 0, today);
  return folioOf(
    {
      ...base,
      roomCount: 1,
      due,
      dueSoFar,
      upcoming,
      paid,
      owed: Math.max(0, dueSoFar - paid),
      balance: paid - due,
      prepaid: Math.max(0, paid - due),
    },
    { ota: otaPrepaidCovered(null, onsite), priceUnset: !!b.priceUnset },
  );
}
