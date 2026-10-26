// 매점: 물품을 누를 때마다 판매 1개를 한 줄로 남겨요. 이름·가격은 판 그때 값으로 복사해 둬요.
import { SHOP_CATEGORY_MAX, SHOP_NAME_MAX, type ShopItem } from "./ledger";
import { hasProAccess } from "./proGates";

export type PayMethod = "card" | "cash";
export const PAY_LABEL: Record<PayMethod, string> = { card: "카드", cash: "현금" };
export const isPayMethod = (v: unknown): v is PayMethod => v === "card" || v === "cash";

export interface ShopSale {
  id: string;
  itemId: string;
  itemName: string; // 판 그때 이름
  unitPrice: number; // 판 그때 가격
  qty: number;
  bizDate: string; // 영업일 YYYY-MM-DD (새벽 6시 기준)
  createdAt: string;
  method: PayMethod | null; // null = 미지정 (카드·현금을 나누기 전 기록)
}

export interface PaySplit {
  card: number;
  cash: number;
  none: number; // 미지정
}
export interface ShopTotals {
  amount: number;
  count: number;
  /** 결제 방법별 금액 */
  pay: PaySplit;
  /** 물품 id → 개수·금액·마지막 이름 */
  byItem: Map<string, { count: number; amount: number; name: string; card: number; cash: number }>;
}
export function shopTotals(sales: ShopSale[], filter?: (s: ShopSale) => boolean): ShopTotals {
  const byItem = new Map<string, { count: number; amount: number; name: string; card: number; cash: number }>();
  let amount = 0;
  let count = 0;
  const pay: PaySplit = { card: 0, cash: 0, none: 0 };
  for (const s of sales) {
    if (filter && !filter(s)) continue;
    const q = Math.max(1, s.qty || 1);
    amount += s.unitPrice * q;
    count += q;
    pay[s.method ?? "none"] += s.unitPrice * q;
    const e = byItem.get(s.itemId) ?? { count: 0, amount: 0, name: s.itemName, card: 0, cash: 0 };
    if (s.method) e[s.method] += q; // 개수
    e.count += q;
    e.amount += s.unitPrice * q;
    e.name = s.itemName;
    byItem.set(s.itemId, e);
  }
  return { amount, count, pay, byItem };
}
export const onDay = (day: string) => (s: ShopSale) => s.bizDate === day;
export const inRange = (from: string, to: string) => (s: ShopSale) => s.bizDate >= from && s.bizDate <= to;

/**
 * 되돌리기: 그날 그 물품의 가장 최근 판매 1건.
 * method를 주면 그 결제 방법(카드·현금)으로 판 것 중에서만 골라요 (물품 칸의 카드 −, 현금 −).
 */
export function lastSaleOf(sales: ShopSale[], itemId: string, day: string, method?: PayMethod): ShopSale | null {
  let best: ShopSale | null = null;
  for (const s of sales) {
    if (s.itemId !== itemId || s.bizDate !== day || (method && s.method !== method)) continue;
    if (!best || s.createdAt > best.createdAt || (s.createdAt === best.createdAt && s.id > best.id)) best = s;
  }
  return best;
}

/** 매점 화면에 보일 물품: 이름 있고 숨기지 않은 것, 분류별로 묶되 설정 순서 그대로 */
export function shopGroups(items: ShopItem[]): { category: string; items: ShopItem[] }[] {
  const out: { category: string; items: ShopItem[] }[] = [];
  for (const it of items) {
    if (it.hidden || !it.name.trim()) continue;
    const c = it.category.trim() || "기타";
    let g = out.find((x) => x.category === c);
    if (!g) out.push((g = { category: c, items: [] }));
    g.items.push(it);
  }
  return out;
}

/** 'YYYY-MM' 달의 첫날·마지막 날 */
export function monthRange(ym: string): [string, string] {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`];
}
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export const canAddShopItem = (plan: "free" | "pro", count: number, limit: number) => hasProAccess(plan) || count < limit;

/** 설정·매점에서 같은 모양으로 물품 한 줄을 만들어요 */
export function makeShopItem(opts: { id: string; name?: string; price?: number; category?: string; hidden?: boolean }): ShopItem {
  const price = Math.round(Number(opts.price ?? 0));
  return {
    id: opts.id,
    name: (opts.name ?? "").trim().slice(0, SHOP_NAME_MAX),
    price: Number.isFinite(price) && price >= 0 ? Math.min(price, 10_000_000) : 0,
    category: (opts.category ?? "").trim().slice(0, SHOP_CATEGORY_MAX),
    hidden: opts.hidden === true,
  };
}

/** 매점 화면에서 바로 등록할 때: 이름·가격이 있어야 팔 수 있어요 */
export function validateShopDraft(d: { name: string; price: number }): string | null {
  if (!d.name.trim()) return "물품 이름을 적어 주세요";
  if (!Number.isFinite(d.price) || d.price < 0) return "가격을 확인해 주세요";
  if (d.price === 0) return "가격을 적어 주세요";
  return null;
}

/** '카드 18,000 · 현금 9,500' (미지정은 0이 아닐 때만) */
export function payLine(p: PaySplit, won: (v: number) => string): string {
  const parts = [`카드 ${won(p.card)}`, `현금 ${won(p.cash)}`];
  if (p.none) parts.push(`미지정 ${won(p.none)}`);
  return parts.join(" · ");
}

/** 장부 합계: 숙박·대실과 매점을 따로, 그리고 합쳐서. 매점이 null이면 (필터 중) 숙박·대실만 */
export function ledgerSummary(rooms: number, shop: number | null): { rooms: number; shop: number | null; total: number } {
  return { rooms, shop, total: rooms + (shop ?? 0) };
}
