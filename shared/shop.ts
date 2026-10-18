// 매점: 물품을 누를 때마다 판매 1개를 한 줄로 남겨요. 이름·가격은 판 그때 값으로 복사해 둬요.
import type { ShopItem } from "./ledger";

export interface ShopSale {
  id: string;
  itemId: string;
  itemName: string; // 판 그때 이름
  unitPrice: number; // 판 그때 가격
  qty: number;
  bizDate: string; // 영업일 YYYY-MM-DD (새벽 6시 기준)
  createdAt: string;
}

export interface ShopTotals {
  amount: number;
  count: number;
  /** 물품 id → 개수·금액·마지막 이름 */
  byItem: Map<string, { count: number; amount: number; name: string }>;
}
export function shopTotals(sales: ShopSale[], filter?: (s: ShopSale) => boolean): ShopTotals {
  const byItem = new Map<string, { count: number; amount: number; name: string }>();
  let amount = 0;
  let count = 0;
  for (const s of sales) {
    if (filter && !filter(s)) continue;
    const q = Math.max(1, s.qty || 1);
    amount += s.unitPrice * q;
    count += q;
    const e = byItem.get(s.itemId) ?? { count: 0, amount: 0, name: s.itemName };
    e.count += q;
    e.amount += s.unitPrice * q;
    e.name = s.itemName;
    byItem.set(s.itemId, e);
  }
  return { amount, count, byItem };
}
export const onDay = (day: string) => (s: ShopSale) => s.bizDate === day;
export const inRange = (from: string, to: string) => (s: ShopSale) => s.bizDate >= from && s.bizDate <= to;

/** 되돌리기: 그날 그 물품의 가장 최근 판매 1건 */
export function lastSaleOf(sales: ShopSale[], itemId: string, day: string): ShopSale | null {
  let best: ShopSale | null = null;
  for (const s of sales) {
    if (s.itemId !== itemId || s.bizDate !== day) continue;
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
export const canAddShopItem = (plan: "free" | "pro", count: number, limit: number) => plan === "pro" || count < limit;

/** 장부 합계: 숙박·대실과 매점을 따로, 그리고 합쳐서. 매점이 null이면 (필터 중) 숙박·대실만 */
export function ledgerSummary(rooms: number, shop: number | null): { rooms: number; shop: number | null; total: number } {
  return { rooms, shop, total: rooms + (shop ?? 0) };
}
