// 매점: 물품을 누를 때마다 판매 1개를 한 줄로 남겨요. 이름·가격은 판 그때 값으로 복사해 둬요.
import { SHOP_CATEGORY_MAX, SHOP_NAME_MAX, type ShopItem } from "./ledger";
import { hasProAccess } from "./proGates";

export type PayMethod = "card" | "cash";
export const PAY_LABEL: Record<PayMethod, string> = { card: "카드", cash: "현금" };
export const isPayMethod = (v: unknown): v is PayMethod => v === "card" || v === "cash";
/**
 * 매점 판매의 결제 방법. card·cash는 그 자리에서 받은 돈(수납),
 * room = 객실 외상(객실 후불, PMS의 Post to Room): 돈을 받은 게 아니라 투숙 중인 예약·단체 장부에 청구로 올려요.
 */
export type ShopMethod = PayMethod | "room";
export const SHOP_METHOD_LABEL: Record<ShopMethod, string> = { ...PAY_LABEL, room: "객실 외상" };
export const isShopMethod = (v: unknown): v is ShopMethod => isPayMethod(v) || v === "room";

export interface ShopSale {
  id: string;
  itemId: string;
  itemName: string; // 판 그때 이름
  unitPrice: number; // 판 그때 가격
  qty: number;
  bizDate: string; // 영업일 YYYY-MM-DD (새벽 6시 기준)
  createdAt: string;
  method: ShopMethod | null; // null = 미지정 (카드·현금을 나누기 전 기록)
  /** 객실 외상: 청구를 올린 예약 (method = room 일 때만) */
  bookingId?: string | null;
  /** 객실 외상: 청구를 올린 단체 장부 (method = room 일 때만) */
  groupId?: string | null;
}

export interface PaySplit {
  card: number;
  cash: number;
  none: number; // 미지정
  /** 객실 외상 (예약·단체 장부의 청구. 받은 돈이 아니라 결제 등록으로 따로 받아요) */
  room?: number;
}
export interface ShopTotals {
  amount: number;
  count: number;
  /** 결제 방법별 금액 */
  pay: PaySplit;
  /** 물품 id → 개수·금액·마지막 이름 */
  byItem: Map<string, { count: number; amount: number; name: string; card: number; cash: number; room: number }>;
}
export function shopTotals(sales: ShopSale[], filter?: (s: ShopSale) => boolean): ShopTotals {
  const byItem = new Map<string, { count: number; amount: number; name: string; card: number; cash: number; room: number }>();
  let amount = 0;
  let count = 0;
  const pay: PaySplit = { card: 0, cash: 0, none: 0 }; // room은 객실 외상이 있을 때만 생겨요
  for (const s of sales) {
    if (filter && !filter(s)) continue;
    const q = Math.max(1, s.qty || 1);
    amount += s.unitPrice * q;
    count += q;
    const k = s.method ?? "none";
    pay[k] = (pay[k] ?? 0) + s.unitPrice * q;
    const e = byItem.get(s.itemId) ?? { count: 0, amount: 0, name: s.itemName, card: 0, cash: 0, room: 0 };
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
export function lastSaleOf(sales: ShopSale[], itemId: string, day: string, method?: ShopMethod): ShopSale | null {
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
  if (!d.name.trim()) return "물품 이름을 입력해 주세요";
  if (!Number.isFinite(d.price) || d.price < 0) return "가격을 확인해 주세요";
  if (d.price === 0) return "가격을 입력해 주세요";
  return null;
}

/** '카드 18,000 · 현금 9,500' (미지정은 0이 아닐 때만) */
export function payLine(p: PaySplit, won: (v: number) => string): string {
  const parts = [`카드 ${won(p.card)}`, `현금 ${won(p.cash)}`];
  if (p.room) parts.push(`객실 외상 ${won(p.room)}`);
  if (p.none) parts.push(`미지정 ${won(p.none)}`);
  return parts.join(" · ");
}

/** 장부 합계: 숙박·대실과 매점을 따로, 그리고 합쳐서. 매점이 null이면 (필터 중) 숙박·대실만 */
export function ledgerSummary(rooms: number, shop: number | null): { rooms: number; shop: number | null; total: number } {
  return { rooms, shop, total: rooms + (shop ?? 0) };
}

// ---------- 객실 외상 (매점 → 예약·단체 장부의 청구) ----------
/** 장부에 올라간 매점 청구 한 줄 (매점 판매 한 줄 그대로. 취소하면 판매와 같이 사라져요) */
export interface ShopCharge {
  id: string;
  itemName: string;
  unitPrice: number;
  qty: number;
  bizDate: string;
  amount: number;
}
export const shopChargeOf = (s: Pick<ShopSale, "id" | "itemName" | "unitPrice" | "qty" | "bizDate">): ShopCharge => {
  const qty = Math.max(1, s.qty || 1);
  return { id: s.id, itemName: s.itemName, unitPrice: s.unitPrice, qty, bizDate: s.bizDate, amount: Math.max(0, s.unitPrice) * qty };
};
export const shopChargesTotal = (list: readonly Pick<ShopCharge, "amount">[] | null | undefined): number =>
  (list ?? []).reduce((n, c) => n + Math.max(0, c.amount), 0);
/** 장부 줄 이름: '매점 · 컵라면 ×2' */
export const shopChargeLabel = (c: Pick<ShopCharge, "itemName" | "qty">): string => `매점 · ${c.itemName}${c.qty > 1 ? ` ×${c.qty}` : ""}`;

/** 객실 외상 판매를 예약·단체별로 묶어요 */
export function groupShopCharges(sales: readonly ShopSale[]): { byBooking: Map<string, ShopCharge[]>; byGroup: Map<string, ShopCharge[]> } {
  const byBooking = new Map<string, ShopCharge[]>();
  const byGroup = new Map<string, ShopCharge[]>();
  for (const s of sales) {
    if (s.method !== "room") continue;
    const c = shopChargeOf(s);
    if (s.groupId) byGroup.set(s.groupId, [...(byGroup.get(s.groupId) ?? []), c]);
    else if (s.bookingId) byBooking.set(s.bookingId, [...(byBooking.get(s.bookingId) ?? []), c]);
  }
  const order = (m: Map<string, ShopCharge[]>) => m.forEach((v) => v.sort((a, b) => a.bizDate.localeCompare(b.bizDate)));
  order(byBooking);
  order(byGroup);
  return { byBooking, byGroup };
}

/** 객실 외상을 올릴 곳: 지금 투숙 중(입실 처리, 퇴실 전) 예약. 단체 객실은 단체 장부 하나로 올려요 */
export interface ShopTabTarget {
  key: string;
  bookingId: string | null;
  groupId: string | null;
  /** '301호 · 홍길동' · '단체 한빛상사 (301·302호)' */
  label: string;
  rooms: string[];
}
export interface ShopTabBooking {
  id: string;
  guestName: string;
  groupId?: string | null;
  groupName?: string | null;
}
/** inHouse = 지금 투숙 중인 예약만 (부르는 쪽에서 stayPhase === "in"으로 골라 줘요) · roomOf = 오늘 머무는 방 번호 */
export function shopTabTargets<B extends ShopTabBooking>(
  inHouse: readonly B[],
  roomOf: (b: B) => string | null | undefined,
  /** 단체 장부로 올릴지: 단체 id (장기 숙박처럼 단체 장부에서 빠지는 예약은 null을 돌려 줘요) */
  ledgerGroupOf: (b: B) => string | null | undefined = (b) => b.groupId,
): ShopTabTarget[] {
  const out: ShopTabTarget[] = [];
  const groups = new Map<string, { t: ShopTabTarget; name: string }>();
  const byRoom = (a: string, b: string) => a.localeCompare(b, "ko", { numeric: true });
  for (const b of inHouse) {
    const room = roomOf(b) ?? null;
    const gid = ledgerGroupOf(b);
    if (gid) {
      let g = groups.get(gid);
      if (!g) {
        g = { t: { key: `g:${gid}`, bookingId: null, groupId: gid, label: "", rooms: [] }, name: (b.groupName ?? "").trim() || b.guestName };
        groups.set(gid, g);
        out.push(g.t);
      }
      if (room) g.t.rooms.push(room);
      continue;
    }
    out.push({ key: `b:${b.id}`, bookingId: b.id, groupId: null, label: `${room ? `${room}호 · ` : ""}${b.guestName}`, rooms: room ? [room] : [] });
  }
  for (const { t, name } of groups.values()) {
    t.rooms.sort(byRoom);
    t.label = `단체 ${name}${t.rooms.length ? ` (${t.rooms.join("·")}호)` : ""}`;
  }
  const first = (t: ShopTabTarget) => t.rooms[0] ?? "\uffff";
  return out.sort((a, b) => byRoom(first(a), first(b)));
}
