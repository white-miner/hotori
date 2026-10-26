/**
 * 경영 요약(CEO): 기간 타입별 객실 판매 · 결제수단 합산.
 * 가짜 숫자 금지 — Ledger가 이미 쓰는 rows / paySplit / shopTotals / expenseTotals와 같은 원천.
 */
import { type Booking, countsRevenue, isActive, isEarlyOut, typeLabel, usedNights, type RoomType } from "./ledger";
import { type BookPayMethod } from "./payment";
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

/** 객실 받은 돈 + 매점 카드·현금. 이체·잔액사용은 예약만. */
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
