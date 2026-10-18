import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import {
  type Booking,
  type HotelSettings,
  type RoomSegment,
  fitSegments,
  normalizeSegments,
  type Placement,
  addDays,
  businessDate,
  isEarlyOut,
  type ShopItem,
  normalizeSettings,
} from "../shared/ledger";
import { type PayMethod, type ShopSale, isPayMethod } from "../shared/shop";
import type { Expense } from "../shared/expense";
import { type BookPayMethod, type PayKind, type Payment, isBookPayMethod } from "../shared/payment";
import { clampHours } from "../shared/extratime";
import { CARS_MAX, cleanPlates } from "../shared/parking";
import { type GroupInfo, emptyGroupInfo } from "../shared/settle";

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
  early_out_on?: string | null; // 중도 퇴실한 영업일 (없으면 끝까지)
  refund_amount?: number | null; // 중도 퇴실 환불 (공유 링크에는 없어요)
  memo: string | null;
  guests?: number | null; // 인원
  extra_fee?: number | null; // 판매 가격에 들어 있는 추가 인원 금액
  early_in_hours?: number | null; // 빠른 입실 시간 수
  late_out_hours?: number | null; // 늦은 퇴실 시간 수
  time_fee?: number | null; // 판매 가격에 들어 있는 시간 추가 금액
  arrival_mode?: string | null; // 도보(walk) · 차량(car)
  car_count?: number | null;
  car_plates?: string[] | null; // 공유 링크에는 없어요
  car_fee?: number | null; // 판매 가격에 들어 있는 추가 차량 금액
  walk_discount?: number | null; // 판매 가격에서 빠진 도보 할인
  group_id?: string | null; // 단체 예약 묶음
  group_name?: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  booking_payments?: PaymentRow[];
}
interface PaymentRow {
  id: string;
  booking_id?: string;
  kind: PayKind;
  method: BookPayMethod;
  amount: number;
  biz_date: string;
  created_at: string;
}
const PAY_COLS = "id,booking_id,kind,method,amount,biz_date,created_at";
const payFromRow = (r: PaymentRow, bookingId?: string): Payment => ({
  id: r.id,
  bookingId: r.booking_id ?? bookingId ?? "",
  kind: r.kind === "balance" ? "balance" : "deposit",
  method: isBookPayMethod(r.method) ? r.method : "card",
  amount: r.amount,
  bizDate: r.biz_date,
  createdAt: r.created_at,
});
const COLS_BASE =
  "id,kind,status,platform_id,price,guest_name,type_id,room_id,room_segments,check_in,nights,start_time,end_time,arrived,early_out_on,refund_amount,memo,guests,extra_fee,early_in_hours,late_out_hours,time_fee,arrival_mode,car_count,car_plates,car_fee,walk_discount,group_id,group_name,cancelled_at,created_at,updated_at";
// 받은 돈(선금·잔금)도 함께 불러와요
const COLS = `${COLS_BASE},booking_payments(${PAY_COLS})`;

// 단체 정산
interface GroupRow {
  id: string;
  pay_mode: string;
  due_on: string | null;
  payer_company: string | null;
  payer_name: string | null;
  payer_phone: string | null;
  rates: unknown;
  extras: unknown;
  booking_payments?: PaymentRow[];
}
const GROUP_COLS = `id,pay_mode,due_on,payer_company,payer_name,payer_phone,rates,extras,booking_payments(${PAY_COLS})`;
function groupFromRow(r: GroupRow): GroupInfo {
  const rates: Record<string, number> = {};
  if (r.rates && typeof r.rates === "object") for (const [k, v] of Object.entries(r.rates as Record<string, unknown>)) if (Number.isFinite(Number(v))) rates[k] = Number(v);
  const extras = Array.isArray(r.extras)
    ? (r.extras as { name?: unknown; amount?: unknown }[]).filter((x) => x && typeof x.name === "string").map((x) => ({ name: String(x.name), amount: Math.max(0, Math.round(Number(x.amount) || 0)) }))
    : [];
  return {
    id: r.id,
    payMode: r.pay_mode === "postpaid" ? "postpaid" : "prepaid",
    dueOn: r.due_on,
    payerCompany: r.payer_company,
    payerName: r.payer_name,
    payerPhone: r.payer_phone,
    rates: Object.keys(rates).length ? rates : null,
    extras,
    payments: (r.booking_payments ?? []).map((x) => payFromRow(x, r.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}
const t = (v: string | null | undefined, max: number) => (v && v.trim() ? v.trim().slice(0, max) : null);
function groupToRow(g: Omit<GroupInfo, "payments">) {
  return {
    pay_mode: g.payMode,
    due_on: g.payMode === "postpaid" ? g.dueOn : null,
    payer_company: t(g.payerCompany, 60),
    payer_name: t(g.payerName, 40),
    payer_phone: t(g.payerPhone, 30),
    rates: g.rates && Object.keys(g.rates).length ? g.rates : null,
    extras: g.extras.slice(0, 50).map((x) => ({ name: x.name.trim().slice(0, 30), amount: Math.round(x.amount) })),
  };
}

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
    earlyOut: r.early_out_on ?? null,
    refund: r.refund_amount ?? null,
    memo: r.memo,
    guests: r.guests ?? null,
    extraFee: r.extra_fee ?? null,
    earlyIn: r.early_in_hours ?? null,
    lateOut: r.late_out_hours ?? null,
    timeFee: r.time_fee ?? null,
    arrival: r.arrival_mode === "walk" || r.arrival_mode === "car" ? r.arrival_mode : null,
    cars: r.car_count ?? null,
    plates: r.car_plates ?? null,
    carFee: r.car_fee ?? null,
    walkOff: r.walk_discount ?? null,
    groupId: r.group_id ?? null,
    groupName: r.group_name ?? null,
    payments: (r.booking_payments ?? []).map((x) => payFromRow(x, r.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
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
    // 중도 퇴실: 박수·입실일을 고쳐서 날짜가 범위를 벗어나면 지워요 (서버도 같은 규칙으로 맞춰요)
    early_out_on: stay && b.status === "active" && isEarlyOut(b) ? b.earlyOut : null,
    refund_amount: stay && b.status === "active" && isEarlyOut(b) && b.refund ? Math.round(b.refund) : null,
    memo: b.memo?.trim() ? b.memo.trim().slice(0, 200) : null,
    guests: b.guests && b.guests >= 1 ? Math.min(99, Math.round(b.guests)) : null,
    extra_fee: b.extraFee && b.extraFee > 0 ? Math.min(Math.round(b.extraFee), Math.round(b.price)) : null,
    early_in_hours: stay && clampHours(b.earlyIn) ? clampHours(b.earlyIn) : null,
    late_out_hours: stay && clampHours(b.lateOut) ? clampHours(b.lateOut) : null,
    time_fee: stay && (clampHours(b.earlyIn) || clampHours(b.lateOut)) ? Math.min(Math.max(0, Math.round(b.timeFee ?? 0)), Math.round(b.price)) : null,
    arrival_mode: b.arrival === "walk" || b.arrival === "car" ? b.arrival : null,
    car_count: b.arrival === "car" ? Math.max(1, Math.min(CARS_MAX, Math.round(b.cars ?? 1))) : null,
    car_plates: b.arrival === "car" && cleanPlates(b.plates, b.cars ?? 1).length ? cleanPlates(b.plates, b.cars ?? 1) : null,
    car_fee: b.arrival === "car" && b.carFee && b.carFee > 0 ? Math.min(Math.round(b.carFee), Math.round(b.price)) : null,
    walk_discount: b.arrival === "walk" && b.walkOff && b.walkOff > 0 ? Math.min(Math.round(b.walkOff), 100_000_000) : null,
    group_id: b.groupId && b.groupName?.trim() ? b.groupId : null,
    group_name: b.groupId && b.groupName?.trim() ? b.groupName.trim().slice(0, 40) : null,
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
  // 단체 정산 정보 (id = group_id)
  const [groups, setGroups] = useState<Map<string, GroupInfo>>(new Map());
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
      const [h, b, g] = await Promise.all([
        supabase.from("hotels").select("id,name,plan,is_demo,settings").eq("id", hotelId).single(),
        supabase
          .from("bookings")
          .select(COLS)
          .eq("hotel_id", hotelId)
          .gte("check_in", since)
          .order("check_in")
          .limit(10000),
        supabase.from("booking_groups").select(GROUP_COLS).eq("hotel_id", hotelId).limit(5000),
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
      // 정산 표를 못 읽어도 예약 화면은 그대로 (정산 정보만 비어요)
      if (!g.error) setGroups(new Map((g.data as unknown as GroupRow[]).map((r) => [r.id, groupFromRow(r)])));
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
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_groups", filter: `hotel_id=eq.${hotelId}` }, soon)
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
  // 선금·잔금 받음: 한 줄씩 적고 지워요 (고치기는 지우고 다시 적기)
  const addPayment = useCallback(async (bookingId: string, p: { kind: PayKind; method: BookPayMethod; amount: number; bizDate: string }) => {
    const { data, error } = await supabase
      .from("booking_payments")
      .insert({ booking_id: bookingId, kind: p.kind, method: p.method, amount: Math.round(p.amount), biz_date: p.bizDate })
      .select(PAY_COLS)
      .single();
    if (error) throw error;
    const saved = payFromRow(data as PaymentRow);
    setBookings((list) => list.map((x) => (x.id === bookingId ? { ...x, payments: [...(x.payments ?? []), saved] } : x)));
    return saved;
  }, []);
  const deletePayment = useCallback(async (bookingId: string, id: string) => {
    const { error } = await supabase.from("booking_payments").delete().eq("id", id);
    if (error) throw error;
    setBookings((list) => list.map((x) => (x.id === bookingId ? { ...x, payments: (x.payments ?? []).filter((y) => y.id !== id) } : x)));
  }, []);
  // 중도 퇴실 · 되돌리기: 날짜와 환불만 바꿔요 (되돌릴 때 비운 밤이 다시 팔렸으면 서버가 막아요)
  const setEarlyOut = useCallback(async (id: string, earlyOut: string | null, refund: number | null) => {
    const box: { prev?: Booking } = {};
    setBookings((list) => list.map((x) => (x.id === id ? ((box.prev = x), { ...x, earlyOut, refund: earlyOut ? refund : null }) : x)));
    const { data, error } = await supabase
      .from("bookings")
      .update({ early_out_on: earlyOut, refund_amount: earlyOut && refund ? refund : null })
      .eq("id", id)
      .select(COLS)
      .single();
    if (error) {
      const prev = box.prev;
      if (prev) setBookings((list) => list.map((x) => (x.id === id ? prev : x)));
      void refresh();
      throw error;
    }
    const saved = fromRow(data as BookingRow);
    setBookings((list) => list.map((x) => (x.id === id ? saved : x)));
    return saved;
  }, [refresh]);
  // 객실 배치에서 옮기기·되돌리기: room_id와 구간을 함께 (구간이 null이면 한 방)
  const setPlacement = useCallback(async (id: string, p: Placement) => {
    const segs = normalizeSegments(p.segments);
    setBookings((list) => list.map((x) => (x.id === id ? { ...x, roomId: p.roomId, segments: segs } : x)));
    const { data, error } = await supabase
      .from("bookings")
      .update({ room_id: p.roomId, room_segments: segs ? segs.map((x) => ({ room: x.roomId, nights: x.nights })) : null })
      .eq("id", id)
      .select(COLS)
      .single();
    if (error) {
      void refresh();
      throw error;
    }
    const saved = fromRow(data as BookingRow);
    setBookings((list) => list.map((x) => (x.id === id ? saved : x)));
    return saved;
  }, [refresh]);
  // 단체 예약: 여러 줄을 한 번에 (한 문장이라 모두 되거나 모두 안 돼요)
  const saveGroup = useCallback(
    async (list: Booking[], info?: Omit<GroupInfo, "payments">): Promise<Booking[]> => {
      // 정산 정보를 먼저 만들고, 예약이 안 되면 다시 지워요 (모두 되거나 모두 안 돼요)
      if (info) {
        const r = await supabase.from("booking_groups").insert({ ...groupToRow(info), id: info.id, hotel_id: hotelId }).select(GROUP_COLS).single();
        if (r.error) throw r.error;
        setGroups((m) => new Map(m).set(info.id, groupFromRow(r.data as unknown as GroupRow)));
      }
      const { data, error } = await supabase
        .from("bookings")
        .insert(list.map((b) => ({ ...toRow(b), hotel_id: hotelId })))
        .select(COLS);
      if (error) {
        if (info) {
          await supabase.from("booking_groups").delete().eq("id", info.id);
          setGroups((m) => {
            const n = new Map(m);
            n.delete(info.id);
            return n;
          });
        }
        throw error;
      }
      const saved = (data as BookingRow[]).map(fromRow);
      setBookings((x) => [...x, ...saved]);
      return saved;
    },
    [hotelId],
  );
  // 단체 한꺼번에: 모두 입실 · 단체 취소 · 이름/날짜 (정상 예약만, 한 문장)
  const patchGroup = useCallback(
    async (groupId: string, patch: { arrived?: boolean; status?: "cancelled"; groupName?: string; oldName?: string; checkIn?: string; nights?: number }): Promise<Booking[]> => {
      const row: Record<string, unknown> = {};
      if (patch.arrived !== undefined) row.arrived = patch.arrived;
      if (patch.status) row.status = patch.status;
      if (patch.groupName !== undefined) row.group_name = patch.groupName.trim().slice(0, 40);
      if (patch.checkIn !== undefined) row.check_in = patch.checkIn;
      if (patch.nights !== undefined) row.nights = patch.nights;
      let q = supabase.from("bookings").update(row).eq("hotel_id", hotelId).eq("group_id", groupId);
      // 이름만 바꿀 때는 취소된 방도 같이 (묶음 이름은 하나), 나머지는 정상 예약만
      if (patch.groupName === undefined || patch.checkIn !== undefined || patch.nights !== undefined) q = q.eq("status", "active");
      const { data, error } = await q.select(COLS);
      if (error) {
        void refresh();
        throw error;
      }
      let saved = (data as BookingRow[]).map(fromRow);
      // 손님 이름을 단체명 그대로 둔 방만 새 이름으로 (방마다 적은 손님 이름은 그대로)
      if (patch.groupName !== undefined && patch.oldName && patch.oldName !== patch.groupName.trim()) {
        const r2 = await supabase
          .from("bookings")
          .update({ guest_name: patch.groupName.trim().slice(0, 60) })
          .eq("hotel_id", hotelId)
          .eq("group_id", groupId)
          .eq("guest_name", patch.oldName)
          .select(COLS);
        if (!r2.error) {
          const m2 = new Map((r2.data as BookingRow[]).map((r) => [r.id, fromRow(r)]));
          saved = saved.map((b) => m2.get(b.id) ?? b);
        }
      }
      const m = new Map(saved.map((b) => [b.id, b]));
      setBookings((x) => x.map((b) => m.get(b.id) ?? b));
      return saved;
    },
    [hotelId, refresh],
  );
  // 단체 정산 정보 저장 (없으면 만들어요)
  const saveGroupInfo = useCallback(
    async (id: string, info: Omit<GroupInfo, "payments" | "id">): Promise<void> => {
      const { data, error } = await supabase
        .from("booking_groups")
        .upsert({ ...groupToRow({ ...info, id }), id, hotel_id: hotelId }, { onConflict: "id" })
        .select(GROUP_COLS)
        .single();
      if (error) throw error;
      setGroups((m) => new Map(m).set(id, groupFromRow(data as unknown as GroupRow)));
    },
    [hotelId],
  );
  const addGroupPayment = useCallback(
    async (id: string, p: { method: BookPayMethod; amount: number; bizDate: string }) => {
      if (!groups.has(id)) {
        const r = await supabase.from("booking_groups").upsert({ id, hotel_id: hotelId }, { onConflict: "id", ignoreDuplicates: true });
        if (r.error) throw r.error;
      }
      const { data, error } = await supabase
        .from("booking_payments")
        .insert({ group_id: id, kind: "balance", method: p.method, amount: Math.round(p.amount), biz_date: p.bizDate })
        .select(PAY_COLS)
        .single();
      if (error) throw error;
      const saved = payFromRow(data as PaymentRow, id);
      setGroups((m) => {
        const n = new Map(m);
        const g = n.get(id) ?? emptyGroupInfo(id);
        n.set(id, { ...g, payments: [...g.payments, saved] });
        return n;
      });
      return saved;
    },
    [hotelId, groups],
  );
  const deleteGroupPayment = useCallback(async (id: string, payId: string) => {
    const { error } = await supabase.from("booking_payments").delete().eq("id", payId);
    if (error) throw error;
    setGroups((m) => {
      const n = new Map(m);
      const g = n.get(id);
      if (g) n.set(id, { ...g, payments: g.payments.filter((x) => x.id !== payId) });
      return n;
    });
  }, []);
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

  return { hotel, bookings, error, syncedAt, refresh, saveBooking, patchBooking, setPlacement, setEarlyOut, addPayment, deletePayment, deleteBooking, saveHotel, saveGroup, patchGroup, groups, saveGroupInfo, addGroupPayment, deleteGroupPayment };
}
export type HotelData = ReturnType<typeof useHotelData>;

/** 장부 화면: 기간으로 서버에서 불러와요 (오래된 기록까지) */
export async function queryLedger(hotelId: string, from: string, to: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select(COLS)
    .eq("hotel_id", hotelId)
    // 입실일이 기간 안이거나, 기간 안에 중도 퇴실(환불)한 예약 (환불은 퇴실한 날 매출에서 빠져요)
    .or(`and(check_in.gte.${from},check_in.lte.${to}),and(early_out_on.gte.${from},early_out_on.lte.${to})`)
    .order("check_in", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data as BookingRow[]).map(fromRow);
}

/** 장부 현금 시재: 그 기간에 받은 선금·잔금 (받은 날 기준) */
export async function queryPayments(hotelId: string, from: string, to: string): Promise<Payment[]> {
  const { data, error } = await supabase
    .from("booking_payments")
    .select(PAY_COLS)
    .eq("hotel_id", hotelId)
    .gte("biz_date", from)
    .lte("biz_date", to)
    .limit(10000);
  if (error) throw error;
  return (data as PaymentRow[]).map((r) => payFromRow(r));
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
