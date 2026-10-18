import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import {
  type Booking,
  type HotelSettings,
  addDays,
  businessDate,
  normalizeSettings,
} from "../shared/ledger";

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
  "id,kind,status,platform_id,price,guest_name,type_id,room_id,check_in,nights,start_time,end_time,arrived,memo,cancelled_at,created_at,updated_at";

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
const WINDOW_BACK = 120;

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
    if (patch.roomId !== undefined) row.room_id = patch.roomId;
    if (patch.status !== undefined) row.status = patch.status;
    setBookings((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
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
