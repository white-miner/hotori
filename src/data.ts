import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
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
import { type Expense, type ExpenseVendor, type VendorType, isExpensePayMethod, isVendorType } from "../shared/expense";
import {
  type RoomMemo,
  type RoomMemoDraft,
  type RoomMemoKind,
  type RoomMemoStatus,
  isRoomMemoKind,
  isRoomMemoStatus,
  validateRoomMemoDraft,
} from "../shared/roomMemo";
import {
  type HotelNotice,
  type HotelNoticeDraft,
  type HotelNoticeStatus,
  isHotelNoticeStatus,
  validateHotelNoticeDraft,
} from "../shared/hotelNotice";
import {
  HOTEL_DOC_BUCKET,
  type HotelDocKind,
  type HotelDocMime,
  type HotelDocument,
  type HotelDocumentDraft,
  hotelDocStoragePath,
  isHotelDocKind,
  isHotelDocMime,
  mimeFromFile,
  validateHotelDocFile,
  validateHotelDocumentDraft,
} from "../shared/hotelDocuments";
import { type BookPayMethod, type PayKind, type Payment, type PaymentMethod, isBookPayMethod, isPaymentMethod } from "../shared/payment";
import {
  type StayCredit,
  type ApplyStayCreditPlan,
  STAY_CREDIT_PAY_METHOD,
  planApplyStayCredit,
  planVoidStayCredit,
} from "../shared/stayCredit";
import { clampHours } from "../shared/extratime";
import { CARS_MAX, cleanPlates } from "../shared/parking";
import { cleanCoupons } from "../shared/fee";
import { type GroupInfo, emptyGroupInfo, isGroupBadgeColor } from "../shared/settle";
import {
  type NightCharge,
  chargesOutsideWindow,
  longStayRateToJson,
  normalizeLongStayRate,
  parseSettleCycle,
  parseStayMode,
  planMissingCharges,
  priceCacheFromCharges,
} from "../shared/longstay";
import { parseStayNightRates, stayNightRatesToJson } from "../shared/nightrates";

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
  guest_phone?: string | null;
  type_id: string;
  room_id: string | null;
  room_segments?: unknown; // 객실 이동 [{room, nights}] (없으면 null)
  check_in: string;
  nights: number | null;
  start_time: string | null;
  end_time: string | null;
  arrived: boolean;
  tentative?: boolean; // 임시 배치
  no_clean?: boolean; // 청소X
  early_out_on?: string | null; // 중도 퇴실한 영업일 (없으면 끝까지)
  checked_out_at?: string | null; // 정상 퇴실처리 시각
  stay_mode?: string | null;
  long_stay_rate?: unknown;
  settle_cycle?: string | null;
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
  coupons?: unknown; // 쿠폰 [{amount, hotel}]
  payout_confirmed?: boolean | null; // 플랫폼 입금 확인
  payout_amount?: number | null; // 실제 입금액
  group_id?: string | null; // 단체 예약 묶음
  group_name?: string | null;
  succeeds_booking_id?: string | null; // 연박 연결 · 이전 투숙
  night_rates?: unknown; // 방×밤 요금 {flat,weekday, weekend, nights}
  /** 금액미정 (간단 예약) */
  price_unset?: boolean;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  booking_payments?: PaymentRow[];
  booking_night_charges?: ChargeRow[];
}
interface PaymentRow {
  id: string;
  booking_id?: string;
  group_id?: string | null;
  kind: PayKind;
  method: PaymentMethod;
  amount: number;
  biz_date: string;
  created_at: string;
  note?: string | null;
}
interface StayCreditRow {
  id: string;
  hotel_id: string;
  guest_name: string;
  guest_phone: string | null;
  amount_original: number;
  amount_remaining: number;
  preferred_recheckin_date: string | null;
  source_booking_id: string | null;
  status: string;
  expires_on: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}
const CREDIT_COLS =
  "id,hotel_id,guest_name,guest_phone,amount_original,amount_remaining,preferred_recheckin_date,source_booking_id,status,expires_on,note,created_at,updated_at";
const creditFromRow = (r: StayCreditRow): StayCredit => ({
  id: r.id,
  hotelId: r.hotel_id,
  guestName: r.guest_name,
  guestPhone: r.guest_phone,
  amountOriginal: r.amount_original,
  amountRemaining: r.amount_remaining,
  preferredRecheckinDate: r.preferred_recheckin_date,
  sourceBookingId: r.source_booking_id,
  status: r.status === "depleted" ? "depleted" : r.status === "void" ? "void" : "open",
  expiresOn: r.expires_on,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
interface ChargeRow {
  id: string;
  booking_id?: string;
  night_date: string;
  amount: number;
  created_at: string;
}
const PAY_COLS = "id,booking_id,group_id,kind,method,amount,biz_date,created_at,note";
const CHARGE_COLS = "id,booking_id,night_date,amount,created_at";
const payFromRow = (r: PaymentRow, bookingId?: string): Payment => ({
  id: r.id,
  bookingId: r.booking_id ?? bookingId ?? "",
  groupId: r.group_id ?? null,
  kind: r.kind === "balance" ? "balance" : "deposit",
  method: isPaymentMethod(r.method) ? r.method : "card",
  amount: r.amount,
  bizDate: r.biz_date,
  createdAt: r.created_at,
  note: r.note?.trim() ? r.note.trim().slice(0, 80) : null,
});
const chargeFromRow = (r: ChargeRow, bookingId?: string): NightCharge => ({
  id: r.id,
  bookingId: r.booking_id ?? bookingId ?? "",
  nightDate: r.night_date,
  amount: r.amount,
  createdAt: r.created_at,
});
const COLS_BASE =
  "id,kind,status,platform_id,price,price_unset,guest_name,guest_phone,type_id,room_id,room_segments,check_in,nights,start_time,end_time,arrived,tentative,no_clean,early_out_on,checked_out_at,stay_mode,long_stay_rate,settle_cycle,refund_amount,memo,guests,extra_fee,early_in_hours,late_out_hours,time_fee,arrival_mode,car_count,car_plates,car_fee,walk_discount,coupons,payout_confirmed,payout_amount,group_id,group_name,succeeds_booking_id,night_rates,cancelled_at,created_at,updated_at";
// 받은 돈(선금·잔금) · 장기 원장도 함께 불러와요
const COLS = `${COLS_BASE},booking_payments(${PAY_COLS}),booking_night_charges(${CHARGE_COLS})`;

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
  badge_color: string | null;
  booking_payments?: PaymentRow[];
}
const GROUP_COLS = `id,pay_mode,due_on,payer_company,payer_name,payer_phone,rates,extras,badge_color,booking_payments(${PAY_COLS})`;
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
    badgeColor: isGroupBadgeColor(r.badge_color) ? r.badge_color : null,
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
    badge_color: g.badgeColor,
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
    priceUnset: r.price_unset === true,
    guestName: r.guest_name,
    guestPhone: r.guest_phone ?? null,
    typeId: r.type_id,
    roomId: r.room_id,
    segments: segsFromRow(r.room_segments, r.nights),
    checkIn: r.check_in,
    nights: r.nights,
    startTime: r.start_time ? r.start_time.slice(0, 5) : null,
    endTime: r.end_time ? r.end_time.slice(0, 5) : null,
    arrived: r.arrived,
    tentative: r.tentative === true,
    noClean: r.no_clean === true,
    earlyOut: r.early_out_on ?? null,
    checkedOutAt: r.checked_out_at ?? null,
    stayMode: parseStayMode(r.stay_mode),
    longStayRate: normalizeLongStayRate(r.long_stay_rate),
    settleCycle: parseSettleCycle(r.settle_cycle),
    charges: (r.booking_night_charges ?? []).map((x) => chargeFromRow(x, r.id)).sort((a, b) => a.nightDate.localeCompare(b.nightDate)),
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
    coupons: cleanCoupons(r.coupons).length ? cleanCoupons(r.coupons) : null,
    payoutOk: r.payout_confirmed === true,
    payoutAmount: r.payout_amount ?? null,
    groupId: r.group_id ?? null,
    groupName: r.group_name ?? null,
    succeedsBookingId: r.succeeds_booking_id ?? null,
    nightRates: parseStayNightRates(r.night_rates),
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
    price: b.priceUnset ? 0 : Math.round(b.price),
    price_unset: b.priceUnset === true,
    guest_name: b.guestName.trim(),
    guest_phone: t(b.guestPhone, 30),
    type_id: b.typeId,
    room_id: b.roomId,
    // 객실 이동: 박수·첫 방에 맞춰 보내요 (첫 구간 방 = room_id)
    room_segments: stay ? (fitSegments(b.segments, b.roomId, b.nights)?.map((x) => ({ room: x.roomId, nights: x.nights })) ?? null) : null,
    check_in: b.checkIn,
    nights: stay ? b.nights : null,
    start_time: stay ? null : b.startTime,
    end_time: stay ? null : b.endTime,
    arrived: b.arrived,
    // 임시 배치는 방 있을 때만 (미배정 roomId=null 은 타입 홀드)
    tentative: b.tentative === true && !!b.roomId,
    no_clean: b.noClean === true,
    // 중도 퇴실: 박수·입실일을 고쳐서 날짜가 범위를 벗어나면 지워요 (서버도 같은 규칙으로 맞춰요)
    early_out_on: stay && b.status === "active" && isEarlyOut(b) ? b.earlyOut : null,
    checked_out_at: stay && b.status === "active" && b.checkedOutAt ? b.checkedOutAt : null,
    stay_mode: stay && b.stayMode === "long_stay" ? "long_stay" : "standard",
    long_stay_rate: stay && b.stayMode === "long_stay" ? longStayRateToJson(b.longStayRate) : null,
    settle_cycle: stay && b.stayMode === "long_stay" ? b.settleCycle ?? "weekly" : null,
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
    coupons: cleanCoupons(b.coupons).length ? cleanCoupons(b.coupons) : null,
    payout_confirmed: b.payoutOk === true,
    payout_amount: b.payoutOk && b.payoutAmount != null ? Math.max(0, Math.min(100_000_000, Math.round(b.payoutAmount))) : null,
    group_id: b.groupId && b.groupName?.trim() ? b.groupId : null,
    group_name: b.groupId && b.groupName?.trim() ? b.groupName.trim().slice(0, 40) : null,
    succeeds_booking_id: b.succeedsBookingId || null,
    night_rates: stay && b.stayMode !== "long_stay" ? stayNightRatesToJson(b.nightRates) : null,
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
  /** 잔액 보관(Option A) — open/depleted/void 전부 로드(목록·매칭) */
  const [stayCredits, setStayCredits] = useState<StayCredit[]>([]);
  const busy = useRef(false);
  const again = useRef(false);
  /** 로컬 저장이 in-flight refresh 결과를 덮어쓰지 않게 (판매 캘린더 굳음 방지) */
  const mutateGen = useRef(0);
  const setBookingsLocal = useCallback((update: SetStateAction<Booking[]>) => {
    mutateGen.current += 1;
    setBookings(update);
  }, []);

  const refresh = useCallback(async () => {
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    const genAtStart = mutateGen.current;
    try {
      const since = addDays(businessDate(), -WINDOW_BACK);
      const [h, b, g, c] = await Promise.all([
        supabase.from("hotels").select("id,name,plan,is_demo,settings").eq("id", hotelId).single(),
        supabase
          .from("bookings")
          .select(COLS)
          .eq("hotel_id", hotelId)
          .gte("check_in", since)
          .order("check_in")
          .limit(10000),
        supabase.from("booking_groups").select(GROUP_COLS).eq("hotel_id", hotelId).limit(5000),
        supabase.from("stay_credits").select(CREDIT_COLS).eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(2000),
      ]);
      if (h.error) throw h.error;
      if (b.error) throw b.error;
      // 저장 직후 폴링/실시간 refresh가 예전 스냅샷으로 로컬 목록을 지우지 않게
      if (genAtStart !== mutateGen.current) {
        again.current = true;
        return;
      }
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
      // 마이그레이션 전이면 표가 없을 수 있음 → 빈 목록
      if (!c.error) setStayCredits((c.data as StayCreditRow[]).map(creditFromRow));
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
      .on("postgres_changes", { event: "*", schema: "public", table: "stay_credits", filter: `hotel_id=eq.${hotelId}` }, soon)
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

  /** 장기 원장: 재고 창 밤 ⊆ 청구 줄. 누락 삽입 · 창 밖 삭제 · price 캐시 갱신 */
  const syncNightCharges = useCallback(async (b: Booking): Promise<Booking> => {
    if (b.stayMode !== "long_stay" || !b.longStayRate || !b.nights) return b;
    const rate = b.longStayRate;
    const existing = b.charges ?? [];
    const planned = planMissingCharges(b.checkIn, b.nights, rate, existing);
    if ("err" in planned) throw new Error(planned.err);
    if (planned.length) {
      const { data, error } = await supabase
        .from("booking_night_charges")
        .insert(planned.map((p) => ({ booking_id: b.id, night_date: p.nightDate, amount: p.amount })))
        .select(CHARGE_COLS);
      if (error) throw error;
      const added = (data as ChargeRow[]).map((r) => chargeFromRow(r, b.id));
      existing.push(...added);
    }
    const drop = chargesOutsideWindow(b.checkIn, b.nights, existing);
    if (drop.length) {
      const { error } = await supabase.from("booking_night_charges").delete().in("id", drop.map((x) => x.id));
      if (error) throw error;
    }
    const keep = existing.filter((c) => !drop.some((d) => d.id === c.id)).sort((a, c) => a.nightDate.localeCompare(c.nightDate));
    const price = priceCacheFromCharges(keep);
    if (price !== b.price) {
      const { data, error } = await supabase.from("bookings").update({ price }).eq("id", b.id).select(COLS).single();
      if (error) throw error;
      const saved = fromRow(data as BookingRow);
      setBookingsLocal((list) => list.map((x) => (x.id === saved.id ? saved : x)));
      return saved;
    }
    const saved = { ...b, charges: keep, price };
    setBookingsLocal((list) => list.map((x) => (x.id === b.id ? saved : x)));
    return saved;
  }, []);

  const saveBooking = useCallback(
    async (b: Booking, isNew: boolean): Promise<Booking> => {
      const row = toRow(b);
      const q = isNew
        ? supabase.from("bookings").insert({ ...row, hotel_id: hotelId }).select(COLS).single()
        : supabase.from("bookings").update(row).eq("id", b.id).select(COLS).single();
      const { data, error } = await q;
      if (error) throw error;
      let saved = fromRow(data as BookingRow);
      setBookingsLocal((list) => (isNew ? [...list, saved] : list.map((x) => (x.id === saved.id ? saved : x))));
      if (saved.stayMode === "long_stay") saved = await syncNightCharges({ ...saved, longStayRate: b.longStayRate ?? saved.longStayRate });
      return saved;
    },
    [hotelId, syncNightCharges],
  );
  const patchBooking = useCallback(
    async (
      id: string,
      patch: Partial<Pick<Booking, "arrived" | "roomId" | "status" | "tentative" | "noClean" | "checkedOutAt" | "nights" | "price" | "segments">>,
    ) => {
      const row: Record<string, unknown> = {};
      if (patch.arrived !== undefined) row.arrived = patch.arrived;
      if (patch.roomId !== undefined) row.room_id = patch.roomId; // 방을 통째로 정하면 객실 이동 구간은 서버가 지워요
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.noClean !== undefined) row.no_clean = patch.noClean;
      if (patch.checkedOutAt !== undefined) row.checked_out_at = patch.checkedOutAt;
      if (patch.nights !== undefined) row.nights = patch.nights;
      if (patch.price !== undefined) row.price = Math.round(patch.price);
      if (patch.segments !== undefined) {
        row.room_segments = patch.segments?.map((x) => ({ room: x.roomId, nights: x.nights })) ?? null;
      }
      // 방 지우면 임시도 끔 · 임시=true는 방이 있을 때만 (타입 홀드와 분리)
      setBookingsLocal((list) => {
        const cur = list.find((x) => x.id === id);
        const nextRoom = patch.roomId !== undefined ? patch.roomId : cur?.roomId ?? null;
        let nextTent = patch.tentative !== undefined ? patch.tentative : !!cur?.tentative;
        if (!nextRoom) nextTent = false;
        if (patch.tentative !== undefined || patch.roomId === null || (patch.tentative === true && !nextRoom)) {
          row.tentative = nextTent;
        }
        return list.map((x) =>
          x.id === id
            ? {
                ...x,
                ...patch,
                ...(patch.roomId !== undefined ? { segments: null } : {}),
                tentative: nextTent,
              }
            : x,
        );
      });
      const { data, error } = await supabase.from("bookings").update(row).eq("id", id).select(COLS).single();
      if (error) {
        void refresh();
        throw error;
      }
      let saved = fromRow(data as BookingRow);
      if (saved.stayMode === "long_stay" && (patch.nights !== undefined || patch.checkedOutAt !== undefined)) {
        saved = await syncNightCharges(saved);
      } else {
        setBookingsLocal((list) => list.map((x) => (x.id === id ? saved : x)));
      }
      return saved;
    },
    [refresh, syncNightCharges],
  );
  /** 임시 배치를 한 번에 확정 (재고는 그대로, 표시만 확정) */
  const confirmTentative = useCallback(
    async (ids: string[]): Promise<Booking[]> => {
      if (!ids.length) return [];
      setBookingsLocal((list) => list.map((x) => (ids.includes(x.id) ? { ...x, tentative: false } : x)));
      const { data, error } = await supabase.from("bookings").update({ tentative: false }).in("id", ids).eq("hotel_id", hotelId).select(COLS);
      if (error) {
        void refresh();
        throw error;
      }
      const saved = (data as BookingRow[]).map(fromRow);
      const m = new Map(saved.map((b) => [b.id, b]));
      setBookingsLocal((list) => list.map((x) => m.get(x.id) ?? x));
      return saved;
    },
    [hotelId, refresh],
  );
  // 선금·잔금 받음: 한 줄씩 적고 지워요 (고치기는 지우고 다시 적기)
  const addPayment = useCallback(async (bookingId: string, p: { kind: PayKind; method: PaymentMethod; amount: number; bizDate: string; note?: string | null }) => {
    const note = p.note?.trim() ? p.note.trim().slice(0, 80) : null;
    const { data, error } = await supabase
      .from("booking_payments")
      .insert({ booking_id: bookingId, kind: p.kind, method: p.method, amount: Math.round(p.amount), biz_date: p.bizDate, note })
      .select(PAY_COLS)
      .single();
    if (error) throw error;
    const saved = payFromRow(data as PaymentRow);
    setBookingsLocal((list) => list.map((x) => (x.id === bookingId ? { ...x, payments: [...(x.payments ?? []), saved] } : x)));
    return saved;
  }, []);
  const deletePayment = useCallback(async (bookingId: string, id: string) => {
    const { error } = await supabase.from("booking_payments").delete().eq("id", id);
    if (error) throw error;
    setBookingsLocal((list) => list.map((x) => (x.id === bookingId ? { ...x, payments: (x.payments ?? []).filter((y) => y.id !== id) } : x)));
  }, []);
  /** 잔액 보관 생성 (중도퇴실 keep 경로 · refund_amount와 무관) */
  const createStayCredit = useCallback(
    async (input: {
      guestName: string;
      guestPhone?: string | null;
      amount: number;
      preferredRecheckinDate?: string | null;
      sourceBookingId: string;
      note?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("stay_credits")
        .insert({
          hotel_id: hotelId,
          guest_name: input.guestName.trim().slice(0, 40),
          guest_phone: input.guestPhone?.trim() ? input.guestPhone.trim().slice(0, 30) : null,
          amount_original: Math.round(input.amount),
          amount_remaining: Math.round(input.amount),
          preferred_recheckin_date: input.preferredRecheckinDate || null,
          source_booking_id: input.sourceBookingId,
          status: "open",
          note: input.note?.trim() ? input.note.trim().slice(0, 200) : null,
        })
        .select(CREDIT_COLS)
        .single();
      if (error) throw error;
      const saved = creditFromRow(data as StayCreditRow);
      setStayCredits((list) => [saved, ...list.filter((x) => x.id !== saved.id)]);
      return saved;
    },
    [hotelId],
  );
  /**
   * 잔액 사용: payment(method=credit) + application + remaining 차감.
   * refund_amount는 건드리지 않음.
   */
  const applyStayCredit = useCallback(
    async (credit: StayCredit, bookingId: string, amount: number, bizDate: string, kind: PayKind = "balance") => {
      const planned = planApplyStayCredit({ credit, bookingId, amount, bizDate, kind });
      if ("err" in planned) throw new Error(planned.err);
      const note = planned.paymentNote;
      const { data: payData, error: payErr } = await supabase
        .from("booking_payments")
        .insert({
          booking_id: bookingId,
          kind: planned.kind,
          method: STAY_CREDIT_PAY_METHOD,
          amount: planned.amount,
          biz_date: planned.bizDate,
          note,
        })
        .select(PAY_COLS)
        .single();
      if (payErr) throw payErr;
      const savedPay = payFromRow(payData as PaymentRow);
      const { error: appErr } = await supabase.from("stay_credit_applications").insert({
        credit_id: planned.creditId,
        booking_id: bookingId,
        payment_id: savedPay.id,
        amount: planned.amount,
        biz_date: planned.bizDate,
      });
      if (appErr) {
        await supabase.from("booking_payments").delete().eq("id", savedPay.id);
        throw appErr;
      }
      const { data: credData, error: credErr } = await supabase
        .from("stay_credits")
        .update({
          amount_remaining: planned.remainingAfter,
          status: planned.statusAfter,
        })
        .eq("id", planned.creditId)
        .select(CREDIT_COLS)
        .single();
      if (credErr) {
        await supabase.from("booking_payments").delete().eq("id", savedPay.id);
        throw credErr;
      }
      const savedCred = creditFromRow(credData as StayCreditRow);
      setStayCredits((list) => list.map((x) => (x.id === savedCred.id ? savedCred : x)));
      setBookingsLocal((list) =>
        list.map((x) => (x.id === bookingId ? { ...x, payments: [...(x.payments ?? []), savedPay] } : x)),
      );
      return { payment: savedPay, credit: savedCred, plan: planned as ApplyStayCreditPlan };
    },
    [setBookingsLocal],
  );
  const voidStayCredit = useCallback(async (credit: StayCredit) => {
    const planned = planVoidStayCredit(credit);
    if ("err" in planned) throw new Error(planned.err);
    const { data, error } = await supabase
      .from("stay_credits")
      .update({ status: "void" })
      .eq("id", planned.creditId)
      .select(CREDIT_COLS)
      .single();
    if (error) throw error;
    const saved = creditFromRow(data as StayCreditRow);
    setStayCredits((list) => list.map((x) => (x.id === saved.id ? saved : x)));
    return saved;
  }, []);
  // 중도 퇴실 · 되돌리기: 날짜와 환불만 바꿔요 (되돌릴 때 비운 밤이 다시 팔렸으면 서버가 막아요)
  const setEarlyOut = useCallback(async (id: string, earlyOut: string | null, refund: number | null) => {
    const box: { prev?: Booking } = {};
    setBookingsLocal((list) => list.map((x) => (x.id === id ? ((box.prev = x), { ...x, earlyOut, refund: earlyOut ? refund : null }) : x)));
    const { data, error } = await supabase
      .from("bookings")
      .update({ early_out_on: earlyOut, refund_amount: earlyOut && refund ? refund : null })
      .eq("id", id)
      .select(COLS)
      .single();
    if (error) {
      const prev = box.prev;
      if (prev) setBookingsLocal((list) => list.map((x) => (x.id === id ? prev : x)));
      void refresh();
      throw error;
    }
    const saved = fromRow(data as BookingRow);
    setBookingsLocal((list) => list.map((x) => (x.id === id ? saved : x)));
    return saved;
  }, [refresh]);
  // 객실 배치에서 옮기기·되돌리기: room_id와 구간을 함께 (구간이 null이면 한 방)
  const setPlacement = useCallback(async (id: string, p: Placement) => {
    const segs = normalizeSegments(p.segments);
    setBookingsLocal((list) => list.map((x) => (x.id === id ? { ...x, roomId: p.roomId, segments: segs } : x)));
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
    setBookingsLocal((list) => list.map((x) => (x.id === id ? saved : x)));
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
      setBookingsLocal((x) => [...x, ...saved]);
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
      setBookingsLocal((x) => x.map((b) => m.get(b.id) ?? b));
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
    setBookingsLocal((list) => list.filter((x) => x.id !== id));
  }, []);
  const saveHotel = useCallback(
    async (patch: { name?: string; settings?: HotelSettings }) => {
      const { error } = await supabase.from("hotels").update(patch).eq("id", hotelId);
      if (error) throw error;
      setHotel((h) => (h ? { ...h, ...patch } : h));
    },
    [hotelId],
  );

  return {
    hotel,
    bookings,
    error,
    syncedAt,
    refresh,
    saveBooking,
    patchBooking,
    syncNightCharges,
    confirmTentative,
    setPlacement,
    setEarlyOut,
    addPayment,
    deletePayment,
    deleteBooking,
    saveHotel,
    saveGroup,
    patchGroup,
    groups,
    saveGroupInfo,
    addGroupPayment,
    deleteGroupPayment,
    stayCredits,
    createStayCredit,
    applyStayCredit,
    voidStayCredit,
  };
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

// ---------- 지출 · 거래처 ----------
interface VendorEmbed {
  name: string;
  vendor_type: string;
}
interface ExpenseRow {
  id: string;
  biz_date: string;
  stock_in_date: string | null;
  category: string;
  amount: number;
  payment_method: string | null;
  paid: boolean;
  memo: string | null;
  vendor_id: string | null;
  created_at: string;
  expense_vendors?: VendorEmbed | VendorEmbed[] | null;
}
const EXP_COLS = "id,biz_date,stock_in_date,category,amount,payment_method,paid,memo,vendor_id,created_at,expense_vendors(name,vendor_type)";
const vendorFromEmbed = (v: ExpenseRow["expense_vendors"]): { name: string | null; type: VendorType | null } => {
  const one = Array.isArray(v) ? v[0] : v;
  if (!one) return { name: null, type: null };
  return { name: one.name, type: isVendorType(one.vendor_type) ? one.vendor_type : null };
};
const fromExpRow = (r: ExpenseRow): Expense => {
  const vend = vendorFromEmbed(r.expense_vendors);
  return {
    id: r.id,
    bizDate: r.biz_date,
    stockInDate: r.stock_in_date ?? null,
    category: r.category,
    amount: r.amount,
    method: isExpensePayMethod(r.payment_method) ? r.payment_method : null,
    paid: r.paid !== false,
    memo: r.memo,
    vendorId: r.vendor_id ?? null,
    vendorName: vend.name,
    vendorType: vend.type,
    createdAt: r.created_at,
  };
};
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
export type ExpenseDraft = Pick<Expense, "bizDate" | "stockInDate" | "category" | "amount" | "method" | "paid" | "memo" | "vendorId">;

interface VendorRow {
  id: string;
  name: string;
  vendor_type: string;
  created_at: string;
}
const VEN_COLS = "id,name,vendor_type,created_at";
const fromVenRow = (r: VendorRow): ExpenseVendor => ({
  id: r.id,
  name: r.name,
  vendorType: isVendorType(r.vendor_type) ? r.vendor_type : "other",
  createdAt: r.created_at,
});
export async function queryExpenseVendors(hotelId: string): Promise<ExpenseVendor[]> {
  const { data, error } = await supabase.from("expense_vendors").select(VEN_COLS).eq("hotel_id", hotelId).order("name").limit(2000);
  if (error) throw error;
  return (data as VendorRow[]).map(fromVenRow);
}
export type VendorDraft = Pick<ExpenseVendor, "name" | "vendorType">;
/** 거래처 목록 · 저장 · 실시간 */
export function useExpenseVendors(hotelId: string) {
  const [list, setList] = useState<ExpenseVendor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const rows = await queryExpenseVendors(hotelId);
      setList(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "거래처를 불러오지 못했어요");
    }
  }, [hotelId]);
  useEffect(() => {
    void refresh();
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(t);
      t = setTimeout(() => void refresh(), 250);
    };
    const ch = supabase
      .channel(`exp-vendors-${hotelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "expense_vendors", filter: `hotel_id=eq.${hotelId}` }, soon)
      .subscribe();
    return () => {
      clearTimeout(t);
      void supabase.removeChannel(ch);
    };
  }, [hotelId, refresh]);
  const save = useCallback(
    async (d: VendorDraft, id?: string): Promise<ExpenseVendor> => {
      const row = { name: d.name.trim().slice(0, 40), vendor_type: d.vendorType };
      const q = id
        ? supabase.from("expense_vendors").update(row).eq("id", id).select(VEN_COLS).single()
        : supabase.from("expense_vendors").insert({ ...row, hotel_id: hotelId }).select(VEN_COLS).single();
      const { data, error } = await q;
      if (error) throw error;
      const saved = fromVenRow(data as VendorRow);
      setList((cur) => {
        const rest = (cur ?? []).filter((x) => x.id !== saved.id);
        return [...rest, saved].sort((a, b) => a.name.localeCompare(b.name, "ko"));
      });
      return saved;
    },
    [hotelId],
  );
  return { list, error, save, refresh };
}

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
      const paid = !!d.paid;
      const amount = Math.max(0, Math.round(d.amount) || 0);
      const method = paid && isExpensePayMethod(d.method) ? d.method : isExpensePayMethod(d.method) ? d.method : null;
      const row = {
        biz_date: d.bizDate,
        stock_in_date: d.stockInDate && /^\d{4}-\d{2}-\d{2}$/.test(d.stockInDate) ? d.stockInDate : null,
        category: d.category.trim(),
        amount,
        payment_method: method,
        paid,
        memo: d.memo?.trim() ? d.memo.trim().slice(0, 200) : null,
        vendor_id: d.vendorId || null,
      };
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

// ---------- 객실 특이사항 (「현황」말풍선 · 인수인계용 room_memos) ----------
interface RoomMemoRow {
  id: string;
  room_id: string | null;
  body: string;
  status: string;
  kind: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}
const MEMO_COLS = "id,room_id,body,status,kind,resolved_at,created_at,updated_at";
const fromMemoRow = (r: RoomMemoRow): RoomMemo => ({
  id: r.id,
  roomId: r.room_id?.trim() ? r.room_id.trim() : null,
  body: r.body,
  status: isRoomMemoStatus(r.status) ? r.status : "open",
  kind: isRoomMemoKind(r.kind) ? r.kind : "issue",
  resolvedAt: r.resolved_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
export async function queryRoomMemos(hotelId: string): Promise<RoomMemo[]> {
  const { data, error } = await supabase
    .from("room_memos")
    .select(MEMO_COLS)
    .eq("hotel_id", hotelId)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data as RoomMemoRow[]).map(fromMemoRow);
}

/** 객실 특이사항: 호텔 전체 · 실시간 + 20초마다 맞춤 */
export function useRoomMemos(hotelId: string) {
  const [list, setList] = useState<RoomMemo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<RoomMemo[]>([]);
  listRef.current = list ?? [];
  const refresh = useCallback(async () => {
    try {
      const rows = await queryRoomMemos(hotelId);
      setList(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "특이사항을 불러오지 못했어요");
    }
  }, [hotelId]);
  useEffect(() => {
    void refresh();
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(t);
      t = setTimeout(() => void refresh(), 250);
    };
    // 채널명은 인스턴스마다 고유해야 함 — 같은 이름이면 subscribe() 뒤 .on()이 throw → 빈 화면
    // (#64 App Shell + Dashboard 이중 useRoomMemos가 원인)
    const ch = supabase
      .channel(`room-memos-${hotelId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_memos", filter: `hotel_id=eq.${hotelId}` }, soon)
      .subscribe();
    const poll = setInterval(() => document.visibilityState === "visible" && void refresh(), 20000);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
      void supabase.removeChannel(ch);
    };
  }, [hotelId, refresh]);
  const save = useCallback(
    async (d: RoomMemoDraft, id?: string): Promise<RoomMemo> => {
      const v = validateRoomMemoDraft(d);
      if (v) throw new Error(v);
      const status: RoomMemoStatus = d.status ?? "open";
      const kind: RoomMemoKind = d.kind ?? "issue";
      const roomTrim = d.roomId?.trim() ?? "";
      const row = {
        room_id: roomTrim ? roomTrim.slice(0, 40) : null,
        body: d.body.trim().slice(0, 120),
        kind,
        status,
        resolved_at: status === "resolved" ? new Date().toISOString() : null,
      };
      const q = id
        ? supabase.from("room_memos").update(row).eq("id", id).select(MEMO_COLS).single()
        : supabase.from("room_memos").insert({ ...row, hotel_id: hotelId }).select(MEMO_COLS).single();
      const { data, error } = await q;
      if (error) throw error;
      const saved = fromMemoRow(data as RoomMemoRow);
      setList((cur) => {
        const rest = (cur ?? []).filter((x) => x.id !== saved.id);
        return [saved, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
      return saved;
    },
    [hotelId],
  );
  const setStatus = useCallback(async (id: string, status: RoomMemoStatus): Promise<RoomMemo> => {
    const row = {
      status,
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
    };
    const { data, error } = await supabase.from("room_memos").update(row).eq("id", id).select(MEMO_COLS).single();
    if (error) throw error;
    const saved = fromMemoRow(data as RoomMemoRow);
    setList((cur) => {
      const rest = (cur ?? []).filter((x) => x.id !== saved.id);
      return [saved, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
    return saved;
  }, []);
  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("room_memos").delete().eq("id", id);
    if (error) throw error;
    setList((cur) => (cur ?? []).filter((x) => x.id !== id));
  }, []);
  return { list, error, save, setStatus, remove, refresh };
}

// ---------- 호텔 공지 (탑바 ClipboardList · hotel_notices) ----------
interface HotelNoticeRow {
  id: string;
  body: string;
  status: string;
  resolved_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}
interface NoticeReceiptRow {
  notice_id: string;
  staff_id: string;
  read_at: string | null;
  acked_at: string | null;
}
const NOTICE_COLS = "id,body,status,resolved_at,created_by,updated_by,created_at,updated_at";
const fromNoticeRow = (r: HotelNoticeRow, ack?: { ackedAt: string | null; ackCount: number }): HotelNotice => ({
  id: r.id,
  body: r.body,
  status: isHotelNoticeStatus(r.status) ? r.status : "open",
  resolvedAt: r.resolved_at,
  createdBy: r.created_by,
  updatedBy: r.updated_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  ackedAt: ack?.ackedAt ?? null,
  ackCount: ack?.ackCount ?? 0,
});

export async function queryHotelNotices(hotelId: string, staffId?: string | null): Promise<HotelNotice[]> {
  const { data, error } = await supabase
    .from("hotel_notices")
    .select(NOTICE_COLS)
    .eq("hotel_id", hotelId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (data as HotelNoticeRow[]) ?? [];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const { data: receipts, error: rErr } = await supabase
    .from("hotel_notice_receipts")
    .select("notice_id,staff_id,read_at,acked_at")
    .in("notice_id", ids);
  if (rErr) throw rErr;
  const recs = (receipts as NoticeReceiptRow[]) ?? [];
  const ackCount = new Map<string, number>();
  const myAck = new Map<string, string | null>();
  for (const x of recs) {
    if (x.acked_at) ackCount.set(x.notice_id, (ackCount.get(x.notice_id) ?? 0) + 1);
    if (staffId && x.staff_id === staffId) myAck.set(x.notice_id, x.acked_at);
  }
  return rows.map((r) =>
    fromNoticeRow(r, { ackedAt: myAck.get(r.id) ?? null, ackCount: ackCount.get(r.id) ?? 0 }),
  );
}

/** 호텔 공지: 실시간 + 20초마다 맞춤 · 채널명 인스턴스마다 고유 (#65) */
export function useHotelNotices(hotelId: string, staffId?: string | null) {
  const [list, setList] = useState<HotelNotice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const rows = await queryHotelNotices(hotelId, staffId);
      setList(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "공지를 불러오지 못했어요");
    }
  }, [hotelId, staffId]);
  useEffect(() => {
    void refresh();
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(t);
      t = setTimeout(() => void refresh(), 250);
    };
    const ch = supabase
      .channel(`hotel-notices-${hotelId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "hotel_notices", filter: `hotel_id=eq.${hotelId}` }, soon)
      .subscribe();
    const poll = setInterval(() => document.visibilityState === "visible" && void refresh(), 20000);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
      void supabase.removeChannel(ch);
    };
  }, [hotelId, refresh]);
  const save = useCallback(
    async (d: HotelNoticeDraft, id?: string): Promise<HotelNotice> => {
      const v = validateHotelNoticeDraft(d);
      if (v) throw new Error(v);
      const body = d.body.trim().slice(0, 280);
      if (id) {
        const patch: { body: string; status?: HotelNoticeStatus; resolved_at?: string | null } = { body };
        if (d.status != null) {
          patch.status = d.status;
          patch.resolved_at = d.status === "resolved" ? new Date().toISOString() : null;
        }
        const { data, error } = await supabase.from("hotel_notices").update(patch).eq("id", id).select(NOTICE_COLS).single();
        if (error) throw error;
        const saved = fromNoticeRow(data as HotelNoticeRow);
        setList((cur) => {
          const prev = (cur ?? []).find((x) => x.id === saved.id);
          const rest = (cur ?? []).filter((x) => x.id !== saved.id);
          return [{ ...saved, ackedAt: prev?.ackedAt ?? null, ackCount: prev?.ackCount ?? 0 }, ...rest].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          );
        });
        return saved;
      }
      const status: HotelNoticeStatus = d.status ?? "open";
      const { data, error } = await supabase
        .from("hotel_notices")
        .insert({
          hotel_id: hotelId,
          body,
          status,
          resolved_at: status === "resolved" ? new Date().toISOString() : null,
        })
        .select(NOTICE_COLS)
        .single();
      if (error) throw error;
      const saved = fromNoticeRow(data as HotelNoticeRow);
      setList((cur) => [saved, ...(cur ?? []).filter((x) => x.id !== saved.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      return saved;
    },
    [hotelId],
  );
  const setStatus = useCallback(async (id: string, status: HotelNoticeStatus): Promise<HotelNotice> => {
    const row = {
      status,
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
    };
    const { data, error } = await supabase.from("hotel_notices").update(row).eq("id", id).select(NOTICE_COLS).single();
    if (error) throw error;
    const saved = fromNoticeRow(data as HotelNoticeRow);
    setList((cur) => {
      const prev = (cur ?? []).find((x) => x.id === saved.id);
      const rest = (cur ?? []).filter((x) => x.id !== saved.id);
      return [{ ...saved, ackedAt: prev?.ackedAt ?? null, ackCount: prev?.ackCount ?? 0 }, ...rest].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    });
    return saved;
  }, []);
  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("hotel_notices").delete().eq("id", id);
    if (error) throw error;
    setList((cur) => (cur ?? []).filter((x) => x.id !== id));
  }, []);
  const ack = useCallback(
    async (id: string): Promise<void> => {
      if (!staffId) throw new Error("로그인이 필요해요");
      const now = new Date().toISOString();
      const { error } = await supabase.from("hotel_notice_receipts").upsert(
        { notice_id: id, staff_id: staffId, acked_at: now, read_at: now },
        { onConflict: "notice_id,staff_id" },
      );
      if (error) throw error;
      setList((cur) =>
        (cur ?? []).map((x) =>
          x.id === id
            ? { ...x, ackedAt: now, ackCount: x.ackedAt ? x.ackCount ?? 0 : (x.ackCount ?? 0) + 1 }
            : x,
        ),
      );
    },
    [staffId],
  );
  return { list, error, save, setStatus, remove, ack, refresh };
}

// ---------- 호텔 증서 보관함 (발급 · hotel_documents + Storage) ----------
interface HotelDocumentRow {
  id: string;
  hotel_id: string;
  kind: string;
  title: string;
  storage_path: string;
  mime: string;
  issued_on: string | null;
  expires_on: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
const DOC_COLS = "id,hotel_id,kind,title,storage_path,mime,issued_on,expires_on,notes,created_by,created_at,updated_at";

const fromDocRow = (r: HotelDocumentRow): HotelDocument => ({
  id: r.id,
  hotelId: r.hotel_id,
  kind: isHotelDocKind(r.kind) ? r.kind : "other",
  title: r.title,
  storagePath: r.storage_path,
  mime: isHotelDocMime(r.mime) ? r.mime : "application/pdf",
  issuedOn: r.issued_on,
  expiresOn: r.expires_on,
  notes: r.notes,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function queryHotelDocuments(hotelId: string): Promise<HotelDocument[]> {
  const { data, error } = await supabase
    .from("hotel_documents")
    .select(DOC_COLS)
    .eq("hotel_id", hotelId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data as HotelDocumentRow[]) ?? []).map(fromDocRow);
}

export function useHotelDocuments(hotelId: string) {
  const [list, setList] = useState<HotelDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const rows = await queryHotelDocuments(hotelId);
      setList(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "증서를 불러오지 못했어요");
    }
  }, [hotelId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upload = useCallback(
    async (draft: HotelDocumentDraft, file: File): Promise<HotelDocument> => {
      const v = validateHotelDocumentDraft(draft) ?? validateHotelDocFile(file);
      if (v) throw new Error(v);
      const mime = mimeFromFile(file)!;
      const id = crypto.randomUUID();
      const path = hotelDocStoragePath(hotelId, id, file.name);
      const { error: upErr } = await supabase.storage.from(HOTEL_DOC_BUCKET).upload(path, file, {
        contentType: mime,
        upsert: false,
      });
      if (upErr) throw upErr;
      const { data, error } = await supabase
        .from("hotel_documents")
        .insert({
          id,
          hotel_id: hotelId,
          kind: draft.kind,
          title: draft.title.trim().slice(0, 80),
          storage_path: path,
          mime,
          issued_on: draft.issuedOn || null,
          expires_on: draft.expiresOn || null,
          notes: draft.notes?.trim() ? draft.notes.trim().slice(0, 280) : null,
        })
        .select(DOC_COLS)
        .single();
      if (error) {
        void supabase.storage.from(HOTEL_DOC_BUCKET).remove([path]);
        throw error;
      }
      const saved = fromDocRow(data as HotelDocumentRow);
      setList((cur) => [saved, ...(cur ?? []).filter((x) => x.id !== saved.id)]);
      return saved;
    },
    [hotelId],
  );

  const remove = useCallback(async (doc: HotelDocument) => {
    const { error } = await supabase.from("hotel_documents").delete().eq("id", doc.id);
    if (error) throw error;
    if (doc.storagePath) {
      const { error: rmErr } = await supabase.storage.from(HOTEL_DOC_BUCKET).remove([doc.storagePath]);
      if (rmErr) console.warn("hotel doc storage remove", rmErr.message);
    }
    setList((cur) => (cur ?? []).filter((x) => x.id !== doc.id));
  }, []);

  const signedUrl = useCallback(async (doc: HotelDocument, expiresIn = 120): Promise<string> => {
    const { data, error } = await supabase.storage
      .from(HOTEL_DOC_BUCKET)
      .createSignedUrl(doc.storagePath, expiresIn);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("signed url missing");
    return data.signedUrl;
  }, []);

  return { list, error, refresh, upload, remove, signedUrl };
}

export type { HotelDocument, HotelDocumentDraft, HotelDocKind, HotelDocMime };

// ---------- 견적서 · 청구서 (발급 P1.1 / P1.2a) ----------
import {
  type QuoteDoc,
  type QuoteDraft,
  type QuoteSnapshot,
  normalizeQuoteLines,
  quoteTotal,
  freezeQuoteSnapshot,
  validateQuoteDraft,
} from "../shared/quoteDoc";
import {
  type InvoiceDoc,
  type InvoiceSnapshot,
  formatInvoiceNumber,
  parseInvoiceYear,
} from "../shared/invoiceDoc";

interface QuoteRow {
  id: string;
  hotel_id: string;
  status: string;
  title: string;
  client_name: string;
  client_phone: string;
  notes: string;
  check_in: string | null;
  nights: number;
  guest_count: number;
  lines: unknown;
  total: number;
  show_room_nos?: boolean;
  group_id?: string | null;
  booking_ids?: string[] | null;
  snapshot: unknown;
  issued_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
const QUOTE_COLS =
  "id,hotel_id,status,title,client_name,client_phone,notes,check_in,nights,guest_count,lines,total,show_room_nos,group_id,booking_ids,snapshot,issued_at,created_by,created_at,updated_at";

function fromQuoteRow(r: QuoteRow): QuoteDoc {
  const lines = normalizeQuoteLines(r.lines);
  const snapRaw = r.snapshot && typeof r.snapshot === "object" ? (r.snapshot as QuoteSnapshot) : null;
  const snap = snapRaw
    ? ({
        ...snapRaw,
        lines: normalizeQuoteLines(snapRaw.lines),
        showRoomNos: !!snapRaw.showRoomNos,
        groupId: snapRaw.groupId ?? r.group_id ?? null,
        bookingIds: snapRaw.bookingIds ?? r.booking_ids ?? [],
      } as QuoteSnapshot)
    : null;
  return {
    id: r.id,
    hotelId: r.hotel_id,
    status: r.status === "issued" ? "issued" : "draft",
    title: r.title ?? "",
    clientName: r.client_name ?? "",
    clientPhone: r.client_phone ?? "",
    notes: r.notes ?? "",
    checkIn: r.check_in,
    nights: r.nights ?? 0,
    guestCount: r.guest_count ?? 0,
    lines,
    total: r.total ?? quoteTotal(lines),
    showRoomNos: !!r.show_room_nos,
    groupId: r.group_id ?? null,
    bookingIds: r.booking_ids ?? [],
    snapshot: snap,
    issuedAt: r.issued_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function queryQuoteIssues(hotelId: string): Promise<QuoteDoc[]> {
  const { data, error } = await supabase
    .from("quote_issues")
    .select(QUOTE_COLS)
    .eq("hotel_id", hotelId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data as QuoteRow[]) ?? []).map(fromQuoteRow);
}

export function useQuoteIssues(hotelId: string) {
  const [list, setList] = useState<QuoteDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setList(await queryQuoteIssues(hotelId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "견적을 불러오지 못했어요");
    }
  }, [hotelId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveDraft = useCallback(
    async (draft: QuoteDraft, id?: string): Promise<QuoteDoc> => {
      const v = validateQuoteDraft(draft);
      if (v) throw new Error(v);
      const title = (draft.title.trim() || draft.clientName.trim()).slice(0, 80);
      const lines = draft.lines;
      const total = quoteTotal(lines);
      const payload = {
        hotel_id: hotelId,
        status: "draft" as const,
        title,
        client_name: draft.clientName.trim().slice(0, 60),
        client_phone: draft.clientPhone.trim().slice(0, 30),
        notes: draft.notes.trim().slice(0, 280),
        check_in: draft.checkIn,
        nights: Math.max(0, Math.round(draft.nights) || 0),
        guest_count: Math.max(0, Math.round(draft.guestCount) || 0),
        lines,
        total,
        show_room_nos: !!draft.showRoomNos,
      };
      if (id) {
        const { data, error } = await supabase.from("quote_issues").update(payload).eq("id", id).select(QUOTE_COLS).single();
        if (error) throw error;
        const saved = fromQuoteRow(data as QuoteRow);
        setList((cur) => [saved, ...(cur ?? []).filter((x) => x.id !== saved.id)]);
        return saved;
      }
      const { data, error } = await supabase.from("quote_issues").insert(payload).select(QUOTE_COLS).single();
      if (error) throw error;
      const saved = fromQuoteRow(data as QuoteRow);
      setList((cur) => [saved, ...(cur ?? [])]);
      return saved;
    },
    [hotelId],
  );

  const issue = useCallback(
    async (
      draft: QuoteDraft,
      id?: string,
      link?: { groupId: string | null; bookingIds: string[] },
    ): Promise<QuoteDoc> => {
      const v = validateQuoteDraft(draft);
      if (v) throw new Error(v);
      const issuedAt = new Date().toISOString();
      const snapshot = freezeQuoteSnapshot(draft, issuedAt, link);
      const title = snapshot.title;
      const base = {
        hotel_id: hotelId,
        status: "issued" as const,
        title,
        client_name: snapshot.clientName,
        client_phone: snapshot.clientPhone,
        notes: snapshot.notes,
        check_in: snapshot.checkIn,
        nights: snapshot.nights,
        guest_count: snapshot.guestCount,
        lines: snapshot.lines,
        total: snapshot.total,
        show_room_nos: !!draft.showRoomNos,
        group_id: link?.groupId ?? null,
        booking_ids: link?.bookingIds ?? [],
        snapshot,
        issued_at: issuedAt,
      };
      if (id) {
        const { data, error } = await supabase.from("quote_issues").update(base).eq("id", id).select(QUOTE_COLS).single();
        if (error) throw error;
        const saved = fromQuoteRow(data as QuoteRow);
        setList((cur) => [saved, ...(cur ?? []).filter((x) => x.id !== saved.id)]);
        return saved;
      }
      const { data, error } = await supabase.from("quote_issues").insert(base).select(QUOTE_COLS).single();
      if (error) throw error;
      const saved = fromQuoteRow(data as QuoteRow);
      setList((cur) => [saved, ...(cur ?? [])]);
      return saved;
    },
    [hotelId],
  );

  const linkBookings = useCallback(async (docId: string, groupId: string | null, bookingIds: string[]) => {
    const { data: cur, error: readErr } = await supabase.from("quote_issues").select(QUOTE_COLS).eq("id", docId).single();
    if (readErr) throw readErr;
    const row = cur as QuoteRow;
    const snap =
      row.snapshot && typeof row.snapshot === "object"
        ? { ...(row.snapshot as QuoteSnapshot), groupId, bookingIds }
        : row.snapshot;
    const { data, error } = await supabase
      .from("quote_issues")
      .update({ group_id: groupId, booking_ids: bookingIds, snapshot: snap })
      .eq("id", docId)
      .select(QUOTE_COLS)
      .single();
    if (error) throw error;
    const saved = fromQuoteRow(data as QuoteRow);
    setList((list) => [saved, ...(list ?? []).filter((x) => x.id !== saved.id)]);
    return saved;
  }, []);

  const remove = useCallback(async (doc: QuoteDoc) => {
    const { error } = await supabase.from("quote_issues").delete().eq("id", doc.id);
    if (error) throw error;
    setList((cur) => (cur ?? []).filter((x) => x.id !== doc.id));
  }, []);

  return { list, error, refresh, saveDraft, issue, linkBookings, remove };
}

interface InvoiceRow {
  id: string;
  hotel_id: string;
  status: string;
  issue_number: string | null;
  group_id: string | null;
  booking_ids: string[] | null;
  payer_name: string;
  payer_phone: string;
  is_mid_stay: boolean;
  snapshot: unknown;
  issued_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
const INVOICE_COLS =
  "id,hotel_id,status,issue_number,group_id,booking_ids,payer_name,payer_phone,is_mid_stay,snapshot,issued_at,created_by,created_at,updated_at";

function fromInvoiceRow(r: InvoiceRow): InvoiceDoc {
  return {
    id: r.id,
    hotelId: r.hotel_id,
    status: r.status === "issued" ? "issued" : "draft",
    issueNumber: r.issue_number,
    groupId: r.group_id,
    bookingIds: r.booking_ids ?? [],
    payerName: r.payer_name ?? "",
    payerPhone: r.payer_phone ?? "",
    isMidStay: !!r.is_mid_stay,
    snapshot: (r.snapshot as InvoiceSnapshot) ?? null,
    issuedAt: r.issued_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function queryInvoiceIssues(hotelId: string): Promise<InvoiceDoc[]> {
  const { data, error } = await supabase
    .from("invoice_issues")
    .select(INVOICE_COLS)
    .eq("hotel_id", hotelId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data as InvoiceRow[]) ?? []).map(fromInvoiceRow);
}

export function useInvoiceIssues(hotelId: string) {
  const [list, setList] = useState<InvoiceDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setList(await queryInvoiceIssues(hotelId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "청구서를 불러오지 못했어요");
    }
  }, [hotelId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const issue = useCallback(
    async (args: {
      payerName: string;
      payerPhone: string;
      snapshot: InvoiceSnapshot;
      groupId: string | null;
      bookingIds: string[];
      isMidStay: boolean;
    }): Promise<InvoiceDoc> => {
      const year = parseInvoiceYear(args.snapshot.issuedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10));
      const { data: numData, error: numErr } = await supabase.rpc("alloc_invoice_number", {
        p_hotel_id: hotelId,
        p_year: year,
      });
      if (numErr) throw numErr;
      const issueNumber = typeof numData === "string" ? numData : formatInvoiceNumber(year, 1);
      const issuedAt = new Date().toISOString();
      const snapshot: InvoiceSnapshot = { ...args.snapshot, issueNumber, issuedAt, payerName: args.payerName, payerPhone: args.payerPhone, isMidStay: args.isMidStay };
      const { data, error } = await supabase
        .from("invoice_issues")
        .insert({
          hotel_id: hotelId,
          status: "issued",
          issue_number: issueNumber,
          group_id: args.groupId,
          booking_ids: args.bookingIds,
          payer_name: args.payerName.trim().slice(0, 80),
          payer_phone: args.payerPhone.trim().slice(0, 30),
          is_mid_stay: args.isMidStay,
          snapshot,
          issued_at: issuedAt,
        })
        .select(INVOICE_COLS)
        .single();
      if (error) throw error;
      const saved = fromInvoiceRow(data as InvoiceRow);
      setList((cur) => [saved, ...(cur ?? [])]);
      return saved;
    },
    [hotelId],
  );

  return { list, error, refresh, issue };
}

