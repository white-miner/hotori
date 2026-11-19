// 잔액은 여기서만 계산합니다. 화면은 이 결과를 읽기만 하고, 결제를 객실·박에 나누지 않습니다.
// 기준은 하나: 미수금 = 예약 전체 청구(퇴실일까지 모든 박 + 추가 항목) − 받은 결제. 1박·10박·장기·단체 모두 같습니다.
// 받은 결제가 전체 청구보다 많으면 초과 수납입니다.
// OTA가 숙박료를 먼저 받은 예약은 숙박료를 미수금에 넣지 않습니다. 단체 추가 항목(식사 등)은 현장에서 받을 돈이라 미수금에 남습니다.
import type { Booking } from "./ledger";
import { revenueOf } from "./ledger";
import { balanceLabel, groupLedger, moneyBalance, type GroupLedger } from "./groupLedger";
import type { PeriodBooking } from "./periodPay";
import { shopChargesTotal, type ShopCharge } from "./shop";

export interface Folio extends GroupLedger {
  /** 전체 청구보다 더 받은 금액 (초과 수납) */
  over: number;
  /** OTA가 숙박료를 먼저 받음. 숙박료는 미수금에 넣지 않음 */
  ota: boolean;
  /** 현장에서 받을 청구 (OTA 선결제면 단체 추가 항목만, 아니면 전체 청구) */
  onsiteDue: number;
  priceUnset: boolean;
  /** 현장 미수금을 따지는지. 금액미정·현장 청구 없는 OTA 선결제는 false */
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
  // OTA 선결제: 숙박료는 채널이 받았으니 현장 청구는 단체 추가 항목만
  const onsiteDue = priceUnset ? 0 : ota ? g.extras : g.due;
  const m = moneyBalance(onsiteDue, g.paid);
  const over = Math.max(0, g.paid - g.due);
  const owed = priceUnset ? 0 : m.owed;
  const label = priceUnset ? "금액미정" : ota && owed === 0 ? "OTA 선결제" : balanceLabel({ owed, prepaid: over });
  return {
    ...g,
    owed,
    prepaid: over,
    over,
    ota,
    onsiteDue,
    priceUnset,
    tracked: opts.tracked ?? (!priceUnset && g.roomCount > 0 && (!ota || onsiteDue > 0)),
    label,
  };
}

/** 예약 하나의 잔액 (금액만). 예약 상세·숙박확인서처럼 저장 전 초안도 같은 식을 씁니다. */
export function bookingBalance(due: number, paid: number) {
  const m = moneyBalance(due, paid);
  return { ...m, label: balanceLabel({ owed: m.owed, prepaid: m.over }) };
}

/**
 * 단체 장부의 추가 청구 합 = 단체 추가 항목 + 매점 객실 외상.
 * 둘 다 현장에서 받을 청구라 OTA 선결제여도 미수금에 남아요. 결제와 섞지 않아요.
 */
export function groupExtrasTotal(info: { extras?: readonly { amount: number }[] | null; shopCharges?: readonly ShopCharge[] | null } | null | undefined): number {
  return (info?.extras ?? []).reduce((n, x) => n + Math.max(0, x.amount), 0) + shopChargesTotal(info?.shopCharges);
}

/** 단체 한 장부. lump = 단체 결제 합, extras = 단체 추가 청구 합(groupExtrasTotal). 객실에 직접 올린 매점 객실 외상도 여기 더해요. */
export function groupFolio(
  members: readonly Booking[],
  lump: number,
  extras: number,
  opts: { onsite: boolean | null; payMode?: "prepaid" | "postpaid" | null; priceUnset?: boolean },
  today = "",
): Folio {
  const priceUnset = opts.priceUnset ?? members.some((b) => b.status !== "cancelled" && !!b.priceUnset && b.stayMode !== "long_stay");
  const memberTabs = members.reduce((n, b) => n + (b.status === "cancelled" ? 0 : shopChargesTotal(b.shopCharges)), 0);
  const g = groupLedger(members as unknown as PeriodBooking[], lump, today, { extras: extras + memberTabs });
  return folioOf(g, { ota: !priceUnset && otaPrepaidCovered(opts.payMode, opts.onsite), priceUnset });
}

/** 객실 하나. 단체 몫 결제는 여기 넣지 않습니다. */
export function bookingFolio(b: Booking, onsite: boolean, today = ""): Folio {
  // 매점 객실 외상 = 이 예약의 추가 청구 (OTA가 숙박료를 받았어도 현장에서 받을 돈)
  const tab = shopChargesTotal(b.shopCharges);
  if (b.priceUnset) {
    const empty = groupLedger([], 0, today);
    return folioOf({ ...empty, paid: paidSum(b) }, { priceUnset: true });
  }
  if (b.stayMode === "long_stay" && b.status === "active") return longStayFolio(b, onsite, today);
  const g = groupLedger([b as PeriodBooking], 0, today, { extras: tab });
  // 대실(박이 없는 예약)도 같은 잔액: 청구 = 판매가(−환불), 미수금 = 청구 − 결제
  if (b.kind !== "stay" && b.status === "active") {
    const due = revenueOf(b) + tab, paid = paidSum(b);
    return folioOf({ ...g, due, paid, owed: Math.max(0, due - paid), balance: paid - due, roomCount: 1 }, { ota: otaPrepaidCovered(null, onsite) });
  }
  if (b.status !== "active") {
    const due = revenueOf(b) + tab;
    return folioOf(
      { ...g, due, paid: paidSum(b), owed: 0, balance: paidSum(b) - due, roomCount: 0 },
      { tracked: false },
    );
  }
  return folioOf(g, { ota: otaPrepaidCovered(null, onsite) });
}

/** 장기 원장. 올라 있는 원장 줄 전부가 청구입니다 (날짜로 끊지 않아요). */
export function longStayFolio(
  b: Pick<Booking, "charges" | "payments" | "priceUnset" | "shopCharges">,
  onsite: boolean,
  today = "",
): Folio {
  const tab = shopChargesTotal(b.shopCharges);
  const due = (b.charges ?? []).reduce((n, c) => n + c.amount, 0) + tab;
  const paid = paidSum(b);
  const m = moneyBalance(due, paid);
  const base = groupLedger([], 0, today);
  return folioOf(
    { ...base, roomCount: 1, due, extras: tab, paid, owed: m.owed, balance: paid - due, prepaid: m.over },
    { ota: otaPrepaidCovered(null, onsite), priceUnset: !!b.priceUnset },
  );
}
