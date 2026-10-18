import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import {
  type Booking,
  type HotelSettings,
  type RoomSegment,
  fitSegments,
  addDays,
  businessDate,
  type ShopItem,
  normalizeSettings,
} from "../shared/ledger";
import { type PayMethod, type ShopSale, isPayMethod } from "../shared/shop";
import type { Expense } from "../shared/expense";

export interface Hotel {
  id: string;
  name: string;
  plan: "free" | "pro";
  isDemo: boolean;
  settings: HotelSettings;
}

interface BookingRow {
  id: string;
  kind: Booking["kind"];
  status: Booking["status"];
  platform_id: string;
  price: number;
  guest_name: string;
  type_id: string;
  room_id: string | null;
  room_segments?: unknown; // 객실 이동 [{room, nights}] (없으면 null)
  check_in: string;
  nights: number | null;
  start_time: string | null;
  end_time: string | null;
  arrived: boolean;
  memo: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}
const COLS =
  "id,kind,status,platform_id,price,guest_name,type_id,room_id,room_segments,check_in,nights,start_time,end_time,arrived,memo,cancelled_at,created_at,updated_at";

/** DB의 [{room, nights}] → [{roomId, nights}]. 모양이 이상하거나 박수 합이 안 맞으면 이동 없음 */
function segsFromRow(v: unknown, nights: number | null): RoomSegment[] | null {
  if (!Array.isArray(v) || v.length < 2 || !nights) return null;
  const out = v.map((x) => ({ roomId: typeof x?.room === "string" ? x.room : "", nights: Number(x?.nights) || 0 }));
  if (out.some((x) => !x.roomId || x.nights < 1) || out.reduce((n, x) => n + x.nights, 0) !== nights) return null;
  return out;
}
export function fromRow(r: BookingRow): Booking {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    platformId: r.platform_id,
    price: r.price,
    guestName: r.guest_name,
    typeId: r.type_id,
    roomId: r.room_id,
    segments: segsFromRow(r.room_segments, r.nights),
    checkIn: r.check_in,
    nights: r.nights,
    startTime: r.start_time ? r.start_time.slice(0, 5) : null,
    endTime: r.end_time ? r.end_time.slice(0, 5) : null,
    arrived: r.arrived,
    memo: r.memo,
    cancelledAt: r.cancelled_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function toRow(b: Booking) {
  const stay = b.kind === "stay";
  return {
    kind: b.kind,
    status: b.status,
    platform_id: b.platformId,
    price: Math.round(b.price),
    guest_name: b.guestName.trim(),
    type_id: b.typeId,
    room_id: b.roomId,
    // 객실 이동: 박수·첫 방에 맞춰 보내요 (첫 구간 방 = room_id)
    room_segments: stay ? (fitSegments(b.segments, b.roomId, b.nights)?.map((x) => ({ room: x.roomId, nights: x.nights })) ?? null) : null,
    check_in: b.checkIn,
    nights: stay ? b.nights : null,
    start_time: stay ? null : b.startTime,
    end_time: stay ? null : b.endTime,
    arrived: b.arrived,
    memo: b.memo?.trim() ? b.memo.trim().slice(0, 200) : null,
  };
}

export async function loadMyHotelId(): Promise<string | null> {
  const { data, error } = await supabase.from("hotel_members").select("hotel_id").limit(1);
  if (error) throw error;
  return data?.[0]?.hotel_id ?? null;
}
export async function createHotel(name: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_hotel", { hotel_name: name });
  if (error) throw error;
  return data as string;
}

/** 현황판에 필요한 범위: 영업일 120일 전 입실 ~ (장기 숙박도 포함) */
export const WINDOW_BACK = 120; // 현황판이 늘 들고 있는 예약: 입실일이 오늘 − 120일 이후

export function useHotelData(hotelId: string) {
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number>(0);
  const busy = useRef(false);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      const since = addDays(businessDate(), -WINDOW_BACK);
      const [h, b] = await Promise.all([
        supabase.from("hotels").select("id,name,plan,is_demo,settings").eq("id", hotelId).single(),
        supabase
          .from("bookings")
          .select(COLS)
          .eq("hotel_id", hotelId)
          .gte("check_in", since)
          .order("check_in")
          .limit(10000),
      ]);
      if (h.error) throw h.error;
      if (b.error) throw b.error;
      setHotel({
        id: h.data.id,
        name: h.data.name,
        plan: h.data.plan,
        isDemo: h.data.is_demo,
        settings: normalizeSettings(h.data.settings),
      });
      setBookings((b.data as BookingRow[]).map(fromRow));
      setError(null);
      setSyncedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했어요");
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        void refresh();
      }
    }
  }, [hotelId]);

  useEffect(() => {
    void refresh();
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(t);
      t = setTimeout(() => void refresh(), 250);
    };
    // 다른 기기에서 고친 내용: 실시간 알림 + 10초마다 한 번 더 확인
    const ch = supabase
      .channel(`hotel-${hotelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `hotel_id=eq.${hotelId}` }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "hotels", filter: `id=eq.${hotelId}` }, soon)
      .subscribe();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10000);
    const vis = () => document.visibilityState === "visible" && soon();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", vis);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("focus", vis);
      void supabase.removeChannel(ch);
    };
  }, [hotelId, refresh]);

  const saveBooking = useCallback(
    async (b: Booking, isNew: boolean): Promise<Booking> => {
      const row = toRow(b);
      const q = isNew
        ? supabase.from("bookings").insert({ ...row, hotel_id: hotelId }).select(COLS).single()
        : supabase.from("bookings").update(row).eq("id", b.id).select(COLS).single();
      const { data, error } = await q;
      if (error) throw error;
      const saved = fromRow(data as BookingRow);
      setBookings((list) => (isNew ? [...list, saved] : list.map((x) => (x.id === saved.id ? saved : x))));
      return saved;
    },
    [hotelId],
  );
  const patchBooking = useCallback(async (id: string, patch: Partial<Pick<Booking, "arrived" | "roomId" | "status">>) => {
    const row: Record<string, unknown> = {};
    if (patch.arrived !== undefined) row.arrived = patch.arrived;
    if (patch.roomId !== undefined) row.room_id = patch.roomId; // 방을 통째로 정하면 객실 이동 구간은 서버가 지워요
    if (patch.status !== undefined) row.status = patch.status;
    setBookings((list) => list.map((x) => (x.id === id ? { ...x, ...patch, ...(patch.roomId !== undefined ? { segments: null } : {}) } : x)));
    const { data, error } = await supabase.from("bookings").update(row).eq("id", id).select(COLS).single();
    if (error) {
      void refresh();
      throw error;
    }
    const saved = fromRow(data as BookingRow);
    setBookings((list) => list.map((x) => (x.id === id ? saved : x)));
  }, [refresh]);
  const deleteBooking = useCallback(async (id: string) => {
    const { error } = await supabase.from("bookings").delete().eq("id", id);
    if (error) throw error;
    setBookings((list) => list.filter((x) => x.id !== id));
  }, []);
  const saveHotel = useCallback(
    async (patch: { name?: string; settings?: HotelSettings }) => {
      const { error } = await supabase.from("hotels").update(patch).eq("id", hotelId);
      if (error) throw error;
      setHotel((h) => (h ? { ...h, ...patch } : h));
    },
    [hotelId],
  );

  return { hotel, bookings, error, syncedAt, refresh, saveBooking, patchBooking, deleteBooking, saveHotel };
}
export type HotelData = ReturnType<typeof useHotelData>;

/** 장부 화면: 기간으로 서버에서 불러와요 (오래된 기록까지) */
export async function queryLedger(hotelId: string, from: string, to: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select(COLS)
    .eq("hotel_id", hotelId)
    .gte("check_in", from)
    .lte("check_in", to)
    .order("check_in", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data as BookingRow[]).map(fromRow);
}

// ---------- 현황 공유 링크 (Pro) ----------
export interface ShareState {
  plan: "free" | "pro";
  enabled: boolean;
  token: string | null;
  updatedAt: string | null;
}
export const shareUrl = (token: string) => `${location.origin}/s/${token}`;
export async function shareStatus(hotelId: string): Promise<ShareState> {
  const { data, error } = await supabase.rpc("share_link_status", { hid: hotelId });
  if (error) throw error;
  return data as ShareState;
}
export async function shareCreate(hotelId: string): Promise<string> {
  const { data, error } = await supabase.rpc("share_link_create", { hid: hotelId });
  if (error) throw error;
  return data as string;
}
export async function shareDisable(hotelId: string): Promise<void> {
  const { error } = await supabase.rpc("share_link_disable", { hid: hotelId });
  if (error) throw error;
}
export interface SharedStatus {
  name: string;
  today: string;
  settings: HotelSettings;
  bookings: Booking[];
}
/** 로그인 없이 링크로 보기. 꺼졌거나 바뀐 링크면 null */
export async function fetchShared(token: string): Promise<SharedStatus | null> {
  const { data, error } = await supabase.rpc("get_shared_status", { share_token: token });
  if (error) throw error;
  if (!data) return null;
  const d = data as { name: string; today: string; settings: unknown; bookings: Omit<BookingRow, "price" | "memo" | "cancelled_at" | "created_at" | "updated_at">[] };
  return {
    name: d.name,
    today: d.today,
    settings: normalizeSettings(d.settings),
    // 공유 보기에는 판매 가격·메모가 오지 않아요
    bookings: d.bookings.map((r) => fromRow({ ...r, price: 0, memo: null, cancelled_at: null, created_at: "", updated_at: "" })),
  };
}

// ---------- 매점 ----------
interface ShopSaleRow {
  id: string;
  item_id: string;
  item_name: string;
  unit_price: number;
  qty: number;
  biz_date: string;
  created_at: string;
  payment_method: string | null;
}
const SHOP_COLS = "id,item_id,item_name,unit_price,qty,biz_date,created_at,payment_method";
const fromShopRow = (r: ShopSaleRow): ShopSale => ({
  id: r.id,
  itemId: r.item_id,
  itemName: r.item_name,
  unitPrice: r.unit_price,
  qty: r.qty,
  bizDate: r.biz_date,
  createdAt: r.created_at,
  method: isPayMethod(r.payment_method) ? r.payment_method : null,
});
export async function queryShopSales(hotelId: string, from: string, to: string): Promise<ShopSale[]> {
  const { data, error } = await supabase
    .from("shop_sales")
    .select(SHOP_COLS)
    .eq("hotel_id", hotelId)
    .gte("biz_date", from)
    .lte("biz_date", to)
    .order("created_at")
    .limit(20000);
  if (error) throw error;
  return (data as ShopSaleRow[]).map(fromShopRow);
}

/** 매점 판매: 기간(영업일)으로 불러오고, 다른 기기에서 판 것도 실시간 + 10초마다 맞춰요 */
export function useShopSales(hotelId: string, from: string, to: string) {
  const [sales, setSales] = useState<ShopSale[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(new Map<string, Promise<string>>()); // 임시 id → 진짜 id
  const salesRef = useRef<ShopSale[]>([]);
  salesRef.current = sales ?? [];
  const range = useRef({ from, to });
  range.current = { from, to };

  const refresh = useCallback(async () => {
    const want = `${from}~${to}`;
    try {
      const rows = await queryShopSales(hotelId, from, to);
      if (want !== `${range.current.from}~${range.current.to}`) return;
      // 아직 저장 중인 판매(임시 id)는 그대로 남겨요
      setSales((cur) => [...rows, ...(cur ?? []).filter((s) => pending.current.has(s.id))]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했어요");
    }
  }, [hotelId, from, to]);

  useEffect(() => {
    setSales(null);
    void refresh();
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(t);
      t = setTimeout(() => void refresh(), 250);
    };
    const ch = supabase
      .channel(`shop-${hotelId}-${from}-${to}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "shop_sales", filter: `hotel_id=eq.${hotelId}` }, soon)
      // 지운 알림은 거를 수 없어서, 내가 가진 판매일 때만 다시 불러와요
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "shop_sales" }, (p) => {
        const id = (p.old as { id?: string } | null)?.id;
        if (id && salesRef.current.some((s) => s.id === id)) soon();
      })
      .subscribe();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10000);
    const vis = () => document.visibilityState === "visible" && soon();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", vis);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("focus", vis);
      void supabase.removeChannel(ch);
    };
  }, [hotelId, from, to, refresh]);

  /** 1개 팔기: 화면에는 바로 보이고, 저장은 뒤에서 해요 */
  const sell = useCallback(
    async (item: ShopItem, bizDate: string, method: PayMethod): Promise<void> => {
      const tmp = `tmp-${Math.random().toString(36).slice(2)}`;
      const optimistic: ShopSale = {
        id: tmp,
        itemId: item.id,
        itemName: item.name.trim(),
        unitPrice: item.price,
        qty: 1,
        bizDate,
        createdAt: new Date().toISOString(),
        method,
      };
      setSales((cur) => [...(cur ?? []), optimistic]);
      const p = (async () => {
        const { data, error } = await supabase
          .from("shop_sales")
          .insert({ hotel_id: hotelId, item_id: item.id, item_name: optimistic.itemName, unit_price: item.price, qty: 1, biz_date: bizDate, payment_method: method })
          .select(SHOP_COLS)
          .single();
        if (error) throw error;
        const saved = fromShopRow(data as ShopSaleRow);
        setSales((cur) => (cur ?? []).map((s) => (s.id === tmp ? saved : s)).filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i));
        return saved.id;
      })();
      pending.current.set(tmp, p);
      try {
        await p;
      } catch (e) {
        setSales((cur) => (cur ?? []).filter((s) => s.id !== tmp));
        throw e;
      } finally {
        pending.current.delete(tmp);
      }
    },
    [hotelId],
  );
  /** 1개 되돌리기: 그날 그 물품의 가장 최근 판매를 지워요 */
  const undo = useCallback(async (sale: ShopSale): Promise<void> => {
    setSales((cur) => (cur ?? []).filter((s) => s.id !== sale.id));
    try {
      const id = pending.current.has(sale.id) ? await pending.current.get(sale.id)! : sale.id;
      setSales((cur) => (cur ?? []).filter((s) => s.id !== id));
      const { error } = await supabase.from("shop_sales").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      void refresh();
      throw e;
    }
  }, [refresh]);

  return { sales, error, refresh, sell, undo };
}
/** 이 물품을 판 기록이 있나요 (지우기 전에 확인) */
export async function hasShopSales(hotelId: string, itemId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("shop_sales")
    .select("id", { count: "exact", head: true })
    .eq("hotel_id", hotelId)
    .eq("item_id", itemId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** 재고 현황·객실 캘린더에서 오래전 기간을 볼 때만: 그 기간에 걸친 예약 (숙박은 최대 90박이라 입실일 90일 앞부터, 대실은 캘린더 점용) */
export async function queryStays(hotelId: string, from: string, to: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select(COLS)
    .eq("hotel_id", hotelId)
    .gte("check_in", addDays(from, -90))
    .lte("check_in", to)
    .limit(20000);
  if (error) throw error;
  return (data as BookingRow[]).map(fromRow);
}

// ---------- 지출 ----------
interface ExpenseRow {
  id: string;
  biz_date: string;
  category: string;
  amount: number;
  payment_method: string;
  memo: string | null;
  created_at: string;
}
const EXP_COLS = "id,biz_date,category,amount,payment_method,memo,created_at";
const fromExpRow = (r: ExpenseRow): Expense => ({
  id: r.id,
  bizDate: r.biz_date,
  category: r.category,
  amount: r.amount,
  method: r.payment_method === "cash" ? "cash" : "card",
  memo: r.memo,
  createdAt: r.created_at,
});
export async function queryExpenses(hotelId: string, from: string, to: string): Promise<Expense[]> {
  const { data, error } = await supabase
    .from("expenses")
    .select(EXP_COLS)
    .eq("hotel_id", hotelId)
    .gte("biz_date", from)
    .lte("biz_date", to)
    .order("biz_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20000);
  if (error) throw error;
  return (data as ExpenseRow[]).map(fromExpRow);
}
export type ExpenseDraft = Pick<Expense, "bizDate" | "category" | "amount" | "method" | "memo">;
/** 지출: 기간(영업일)으로 불러오고, 다른 기기에서 적은 것도 실시간 + 15초마다 맞춰요 */
export function useExpenses(hotelId: string, from: string, to: string) {
  const [list, setList] = useState<Expense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<Expense[]>([]);
  listRef.current = list ?? [];
  const range = useRef({ from, to });
  range.current = { from, to };
  const refresh = useCallback(async () => {
    const want = `${from}~${to}`;
    try {
      const rows = await queryExpenses(hotelId, from, to);
      if (want !== `${range.current.from}~${range.current.to}`) return;
      setList(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했어요");
    }
  }, [hotelId, from, to]);
  useEffect(() => {
    void refresh();
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(t);
      t = setTimeout(() => void refresh(), 250);
    };
    const ch = supabase
      .channel(`exp-${hotelId}-${from}-${to}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "expenses", filter: `hotel_id=eq.${hotelId}` }, soon)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "expenses", filter: `hotel_id=eq.${hotelId}` }, soon)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "expenses" }, (p) => {
        const id = (p.old as { id?: string } | null)?.id;
        if (id && listRef.current.some((x) => x.id === id)) soon();
      })
      .subscribe();
    const poll = setInterval(() => document.visibilityState === "visible" && void refresh(), 15000);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
      void supabase.removeChannel(ch);
    };
  }, [hotelId, from, to, refresh]);
  const save = useCallback(
    async (d: ExpenseDraft, id?: string): Promise<Expense> => {
      const row = { biz_date: d.bizDate, category: d.category.trim(), amount: Math.round(d.amount), payment_method: d.method, memo: d.memo?.trim() ? d.memo.trim().slice(0, 200) : null };
      const q = id
        ? supabase.from("expenses").update(row).eq("id", id).select(EXP_COLS).single()
        : supabase.from("expenses").insert({ ...row, hotel_id: hotelId }).select(EXP_COLS).single();
      const { data, error } = await q;
      if (error) throw error;
      const saved = fromExpRow(data as ExpenseRow);
      const inRange = saved.bizDate >= range.current.from && saved.bizDate <= range.current.to;
      setList((cur) => {
        const rest = (cur ?? []).filter((x) => x.id !== saved.id);
        return (inRange ? [saved, ...rest] : rest).sort((a, b) => b.bizDate.localeCompare(a.bizDate) || b.createdAt.localeCompare(a.createdAt));
      });
      return saved;
    },
    [hotelId],
  );
  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) throw error;
    setList((cur) => (cur ?? []).filter((x) => x.id !== id));
  }, []);
  return { list, error, save, remove, refresh };
}
