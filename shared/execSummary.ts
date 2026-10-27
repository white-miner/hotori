/**
 * 경영 요약(CEO): 기간 타입별 객실 판매 · 플랫폼×결제수단 · 합산.
 * 가짜 숫자 금지 — Ledger가 이미 쓰는 rows / paySplit / shopTotals / expenseTotals와 같은 원천.
 */
import { type Booking, countsRevenue, isActive, isEarlyOut, typeLabel, usedNights, type Platform, type RoomType } from "./ledger";
import { type BookPayMethod, isBookPayMethod, type Payment } from "./payment";
import { type PaySplit } from "./shop";

export type TypeSaleRow = {
  typeId: string;
  label: string;
  /** 입실일∈기간 · 취소 제외 건수(노쇼 포함) */
  count: number;
  stay: number;
  dayuse: number;
  /** 정상(active) 숙박 박수 합 */
  nights: number;
  sales: number;
  refunds: number;
  net: number;
};

export type TypeSalesTotal = Omit<TypeSaleRow, "typeId" | "label">;

export type TypeSalesResult = {
  rows: TypeSaleRow[];
  total: TypeSalesTotal;
};

const emptyTotal = (): TypeSalesTotal => ({
  count: 0,
  stay: 0,
  dayuse: 0,
  nights: 0,
  sales: 0,
  refunds: 0,
  net: 0,
});

/** 설정 타입 순서 유지 · 판매 있는 미등록 타입은 뒤에. 매출 0인 타입도 설정에 있으면 행 유지(글랜스). */
export function typeSalesByType(
  bookings: readonly Booking[],
  from: string,
  to: string,
  types: readonly Pick<RoomType, "id" | "name">[],
): TypeSalesResult {
  const map = new Map<string, TypeSaleRow>();
  const ensure = (typeId: string, label: string) => {
    let row = map.get(typeId);
    if (!row) {
      row = { typeId, label, ...emptyTotal() };
      map.set(typeId, row);
    }
    return row;
  };
  for (const t of types) {
    const lab = typeLabel(t);
    if (lab) ensure(t.id, lab);
  }
  for (const b of bookings) {
    if (!countsRevenue(b)) continue;
    const tid = b.typeId || "_";
    const tmeta = types.find((x) => x.id === tid);
    const row = ensure(tid, tmeta ? typeLabel(tmeta) || "타입 미정" : "타입 미정");
    if (b.checkIn >= from && b.checkIn <= to) {
      row.count++;
      if (b.kind === "dayuse") row.dayuse++;
      else row.stay++;
      if (isActive(b) && b.kind === "stay") row.nights += usedNights(b) ?? 0;
      row.sales += b.price;
    }
    if (b.status === "active" && isEarlyOut(b) && b.refund && b.earlyOut! >= from && b.earlyOut! <= to) {
      row.refunds += b.refund;
    }
  }
  for (const row of map.values()) row.net = row.sales - row.refunds;

  const orderIds = types.filter((t) => typeLabel(t)).map((t) => t.id);
  const rows: TypeSaleRow[] = [];
  for (const id of orderIds) {
    const r = map.get(id);
    if (r) rows.push(r);
  }
  for (const [id, r] of map) {
    if (!orderIds.includes(id)) rows.push(r);
  }

  const total = emptyTotal();
  for (const r of rows) {
    total.count += r.count;
    total.stay += r.stay;
    total.dayuse += r.dayuse;
    total.nights += r.nights;
    total.sales += r.sales;
    total.refunds += r.refunds;
    total.net += r.net;
  }
  return { rows, total };
}

export type MethodSales = {
  card: number;
  cash: number;
  transfer: number;
  total: number;
  booking: { card: number; cash: number; transfer: number; credit: number; total: number };
  shop: { card: number; cash: number; none: number; total: number };
};

/** 객실 수납액 + 매점 카드·현금. 이체·잔액사용은 예약만. */
export function methodSales(
  booking: Pick<Record<BookPayMethod, number>, "card" | "cash" | "transfer"> & { credit?: number; total?: number },
  shop: PaySplit | null | undefined,
): MethodSales {
  const b = {
    card: booking.card || 0,
    cash: booking.cash || 0,
    transfer: booking.transfer || 0,
    credit: booking.credit || 0,
    total: booking.total ?? (booking.card || 0) + (booking.cash || 0) + (booking.transfer || 0) + (booking.credit || 0),
  };
  const sPay = shop ?? { card: 0, cash: 0, none: 0 };
  const s = {
    card: sPay.card,
    cash: sPay.cash,
    none: sPay.none,
    total: sPay.card + sPay.cash + sPay.none,
  };
  const card = b.card + s.card;
  const cash = b.cash + s.cash;
  const transfer = b.transfer;
  return { card, cash, transfer, total: card + cash + transfer, booking: b, shop: s };
}

export type PlatformPayRow = {
  platformId: string;
  label: string;
  card: number;
  cash: number;
  transfer: number;
  total: number;
  /** 매점 전용 행 */
  shop?: boolean;
};

export type PlatformPayTotal = {
  card: number;
  cash: number;
  transfer: number;
  total: number;
  credit: number;
};

export type PlatformPayMatrix = {
  rows: PlatformPayRow[];
  total: PlatformPayTotal;
};

const emptyMethods = (): Omit<PlatformPayRow, "platformId" | "label"> => ({
  card: 0,
  cash: 0,
  transfer: 0,
  total: 0,
});

const SHOP_ROW_ID = "__shop__";
const UNKNOWN_PLAT_ID = "__unknown__";

export type PlatformResolve = (p: { bookingId: string; groupId?: string | null }) => { id: string; name: string } | null;

/**
 * 플랫폼 × 카드/현금/이체 매트릭스 (수납일 기준).
 * 잔액 사용(credit)은 합계.credit만 · 칸/합계 금액에는 안 넣음.
 * 매점은 맨 아래 「매점」행(이체 0). 설정 플랫폼 순서 유지 · 금액 0인 설정 플랫폼은 생략.
 */
export function platformPayMatrix(
  payments: readonly Pick<Payment, "method" | "amount" | "bizDate" | "bookingId" | "groupId">[],
  from: string,
  to: string,
  resolve: PlatformResolve,
  platforms: readonly Pick<Platform, "id" | "name">[],
  shop?: PaySplit | null,
): PlatformPayMatrix {
  const map = new Map<string, PlatformPayRow>();
  const ensure = (platformId: string, label: string) => {
    let row = map.get(platformId);
    if (!row) {
      row = { platformId, label, ...emptyMethods() };
      map.set(platformId, row);
    }
    return row;
  };
  let credit = 0;
  for (const p of payments) {
    if (p.bizDate < from || p.bizDate > to) continue;
    if (p.method === "credit") {
      credit += p.amount;
      continue;
    }
    if (!isBookPayMethod(p.method)) continue;
    const plat = resolve({ bookingId: p.bookingId, groupId: p.groupId });
    const id = plat?.id || UNKNOWN_PLAT_ID;
    const label = plat?.name?.trim() || "플랫폼 미확인";
    const row = ensure(id, label);
    row[p.method] += p.amount;
    row.total += p.amount;
  }

  const orderIds = platforms.map((p) => p.id);
  const rows: PlatformPayRow[] = [];
  for (const id of orderIds) {
    const r = map.get(id);
    if (r && r.total > 0) rows.push(r);
  }
  for (const [id, r] of map) {
    if (!orderIds.includes(id) && r.total > 0) rows.push(r);
  }

  const sPay = shop ?? { card: 0, cash: 0, none: 0 };
  // methodSales와 동일: 매점 미지정(none)은 카드·현금·이체 합계에 안 넣음
  const shopCard = sPay.card;
  const shopCash = sPay.cash;
  const shopTotal = shopCard + shopCash;
  if (shopTotal > 0 || sPay.none > 0) {
    rows.push({
      platformId: SHOP_ROW_ID,
      label: "매점",
      card: shopCard,
      cash: shopCash,
      transfer: 0,
      total: shopTotal,
      shop: true,
    });
  }

  const total: PlatformPayTotal = { card: 0, cash: 0, transfer: 0, total: 0, credit };
  for (const r of rows) {
    total.card += r.card;
    total.cash += r.cash;
    total.transfer += r.transfer;
    total.total += r.total;
  }
  return { rows, total };
}

/** 예약·단체 결제 → 플랫폼 id/이름. 단체의 첫 멤버 플랫폼 사용. */
export function resolvePlatformForPay(
  p: { bookingId: string; groupId?: string | null },
  byBookingId: ReadonlyMap<string, Pick<Booking, "platformId" | "groupId">>,
  plats: ReadonlyMap<string, Pick<Platform, "id" | "name">>,
  byGroupId?: ReadonlyMap<string, string>,
): { id: string; name: string } | null {
  const fromPlatId = (platformId: string) => {
    const plat = plats.get(platformId);
    if (plat) return { id: plat.id, name: plat.name };
    return { id: platformId || UNKNOWN_PLAT_ID, name: "플랫폼 미확인" };
  };
  if (p.bookingId) {
    const b = byBookingId.get(p.bookingId);
    if (b) return fromPlatId(b.platformId);
  }
  // 단체 결제 · 또는 payFromRow(groupId)로 bookingId에 단체 id가 들어간 경우
  const gid = p.groupId || (p.bookingId && byGroupId?.has(p.bookingId) ? p.bookingId : null);
  if (gid) {
    const platId = byGroupId?.get(gid);
    if (platId) return fromPlatId(platId);
    for (const b of byBookingId.values()) {
      if (b.groupId === gid) return fromPlatId(b.platformId);
    }
  }
  return null;
}
