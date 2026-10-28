import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, ArrowRightLeft, CalendarDays, CalendarPlus, Check, Clock, DoorOpen, FileText, Minus, Plus, Undo2, X } from "lucide-react";
import { STAY_CONFIRM_COPY } from "../shared/hotelBiz";
import { DAMAGE_COPY } from "../shared/damageDoc";
import StayConfirmLetter from "./StayConfirmLetter";
import DamageLetter from "./DamageLetter";
import { useDamageIssues } from "./data";
import {
  type Booking,
  type Kind,
  type Status,
  addMinutesToTime,
  dayuseMinutes,
  nowRounded,
  parseTime,
  addDays,
  allRooms as placedRooms,
  dayLabel,
  freeRooms,
  md,
  daysBetween,
  fitSegments,
  legConflicts,
  placementOf,
  proposeRoomSwap,
  type RoomSwapPlan,
  fullLegsOf,
  canEarlyOutToday,
  checkOut,
  checkOutFromStayNights,
  clampStayNights,
  earlyOutDates,
  isEarlyOut,
  nightsFromStayDates,
  roomOnNight,
  usedLabel,
  usedNights,
  validateEarlyOut,
  revenueOf,
  moveStay,
  undoMove,
  type RoomSegment,
  isActive,
  previewChange,
  stockLevel,
  stockTable,
  typeLabel,
  typeTotals,
  usableTypes,
  validateBooking,
  won,
  STAY_NIGHTS_MAX,
} from "../shared/ledger";
import { dayuseStayOverlapWarn } from "../shared/dayuseOverlap";
import type { HotelData } from "./data";
import type { EntryRequest, ToastOpt } from "./App";
import { PlatBadge, TypeBadge, isTypingTarget, lookups } from "./ui";
import DayuseStayOverlapConfirm from "./DayuseStayOverlapConfirm";
import { askConfirm } from "./ConfirmDialog";
import { ensureHotelBizReady } from "./hotelBizGate";
import GroupEntry from "./GroupEntry";
import GroupAdd from "./GroupAdd";
import { GUESTS_MAX, SURCHARGE_MAX, surchargeOf, typeGuests } from "../shared/surcharge";
import {
  BOOK_PAY_LABEL,
  BOOK_PAY_METHODS,
  type BookPayMethod,
  type OnsitePayMode,
  type PayKind,
  isOnsite,
  onsiteCreatePayTail,
  guestPhoneOptsForBooking,
  isGuestPhoneRequired,
  paySplit,
  payState,
  planOnsiteCreatePay,
  splitLine,
  validateGuestPhone,
  validateOnsiteCreateDeposit,
  validatePayment,
  walkInDisplayName,
} from "../shared/payment";
import { saveFailMessage } from "../shared/errors";
import { ARRIVAL_LABEL, type Arrival, CARS_MAX, PLATE_MAX, autoCarFee, autoWalkOff, carFeeLine } from "../shared/parking";
import { COUPON_AMOUNT_MAX, COUPON_MAX, cleanCoupons, payoutLine, payoutOf } from "../shared/fee";
import { EXTRA_HOURS_MAX, autoTimeFee, clampHours, hasExtraTime, inTimeOf, outTimeOf, timeLine, turnoverWarnings } from "../shared/extratime";
import {
  EXTEND_COPY,
  NIGHTS_PRICE_WARN,
  applyExtend,
  canExtend,
  extendBlock,
  extendDraftBooking,
  extendNotifyLine,
  extendOverlaps,
  nightRate,
  nightsChangedWithoutPrice,
  planExtend,
  repriceForNights,
  roomNightRate,
  stayAddons,
  unusedNightRefund,
  validateExtendRate,
} from "../shared/extend";
import { type NightShiftMode, shiftDays, shiftDifferences, shiftNightRates } from "../shared/nightShift";
import { EDIT_COPY, commitEditStayDates, nightsUpOpensExtendPanel } from "../shared/bookingEdit";
import {
  STAY_CREDIT_COPY,
  type EarlyOutDisposition,
  defaultKeepAmount,
  keepCreditNotifyLine,
  applyCreditNotifyLine,
  matchOpenCredits,
  planApplyStayCredit,
  planCreateStayCredit,
  validateEarlyOutKeep,
} from "../shared/stayCredit";
import { paidOf } from "../shared/payment";
import ExtendOverlapConfirm from "./ExtendOverlapConfirm";
import {
  type StayNightRates,
  hasFullNightMatrix,
  nightRatesFromTotal,
  priceFromNightMatrix,
  refillFromDefaults,
  setNightAmount,
  syncStayNightRates,
} from "../shared/nightrates";

/** 플랫폼 판매금: 박당 | 총액(기본 · OTA 총액 그대로) */
type SalesMode = "perNight" | "total";
import {
  SURCHARGE_COPY,
  SURCHARGE_REASON_LABEL,
  SURCHARGE_REASONS,
  type SurchargeReason,
  canAddSurcharge,
  defaultSurchargeAmount,
  planAddSurcharge,
  suggestElapsedLateHours,
  surchargeNotifyLine,
} from "../shared/addSurcharge";
import { canCheckOut, canEndDayuse, groupStayPeers, isCheckedOut, hotelWallClock } from "../shared/nowboard";
import {
  CHECKOUT_UNDO_CTA,
  CHECKOUT_UNDO_TITLE,
  DAYUSE_UNDO_TITLE,
  canUndoCheckout,
  checkoutUndoBlock,
  checkoutUndoConfirmBody,
  dayuseUndoConfirmBody,
  restoreCheckoutPatch,
} from "../shared/checkoutUndo";
import CheckoutConfirmModal from "./CheckoutConfirmModal";
import {
  checkoutLeaveBalanceNotifyLine,
  checkoutPayNotifyLine,
} from "../shared/checkoutConfirm";
import { sameGroupId, type PaymentDeskPayPlan } from "../shared/paymentDesk";
import { settle } from "../shared/settle";
import {
  LONG_STAY_WINDOW_DEFAULT,
  WINDOW_EXTEND_DEFAULT,
  type SettleCycle,
  type StayMode,
  flatRate,
  isLongStay,
  longPayState,
  nightAmount,
  nightsAtCheckout,
  planLongStayExtend,
  planWindowExtend,
  settleHint,
  validateLongStayRate,
  windowExtendBlock,
  withPlannedCharges,
} from "../shared/longstay";
import NightPickCalendar from "./NightPickCalendar";
import MiniFloorPlan, { type BuildingFilter } from "./MiniFloorPlan";
import OpenStayToggle from "./OpenStayToggle";
import NightRatesTable from "./NightRatesTable";
import RoomClashNote from "./RoomClashNote";
import PayEvidence from "./PayEvidence";
import RecordSheet from "./RecordSheet";
import { payLines } from "../shared/recordTimeline";
import { OPEN_HOLD_DEFAULT, openStayNights } from "../shared/openStay";
import { groupDrafts, hashGroupBadgeColor } from "../shared/group";
import GroupRoomRates from "./GroupRoomRates";
import { type RateEdits, roomSlots, slotRows, unpricedMessage } from "../shared/groupRates";
import OnsitePayModeFields from "./OnsitePayModeFields";
import { entryStayDateUx } from "../shared/nightpick";
import AssignSwapConfirm from "./AssignSwapConfirm";
import { stopSellDatesForStay } from "../shared/salesCalendar";
import {
  BookPayMethodCircles,
  BookingModeSeg,
  Chip,
  ChipGroup,
  GuestNamePhone,
  Inp,
  PriceInp,
  PriceRow,
  Stepper,
} from "./primitives";

interface Props {
  data: HotelData;
  today: string;
  req: EntryRequest;
  onClose: () => void;
  onSaved: (msg: string, again?: Partial<Booking>) => void;
  /** 객실 배치에서 열었으면: 창을 닫고 빈 방을 눌러 옮기기 */
  onBoardMove?: () => void;
  notify: (m: string, opt?: ToastOpt) => void;
  /** 조기 퇴실 되돌리기 (비운 밤이 다시 팔렸으면 막고 false) */
  undoEarlyOut: (id: string) => Promise<boolean>;
  /** 새 예약 상세 → 간단 셸 (progressive disclosure) */
  onOpenSimple?: (preset: Partial<Booking>) => void;
}
const TYPE_KEYS = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO"];
const TYPE_LABEL = "QWERTYUIO";
const DURATIONS = [1, 2, 3, 4, 5, 6];
const durLabel = (min: number) => (min % 60 ? `${Math.floor(min / 60)}시간 ${min % 60}분` : `${min / 60}시간`);

/** 작은 시계 단추: 누르면 기기 시간 고르기가 열려요 (값은 언제나 24시간 HH:MM) */
function TimePick({ value, label, onPick }: { value: string; label: string; onPick: (v: string) => void }) {
  return (
    <span className="tpick" title={label}>
      <Clock size={15} />
      <input
        type="time"
        tabIndex={-1}
        aria-label={label}
        value={value}
        onChange={(e) => e.target.value && onPick(e.target.value)}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker?.();
          } catch {
            /* 기본 동작 */
          }
        }}
      />
    </span>
  );
}

/** 새 예약에서는 자주 안 쓰는 칸을 접어 둬요 — 고치는 예약은 그대로 펼쳐 보여요 */
function AdvWrap({ on, label, children }: { on: boolean; label: string; children: ReactNode }) {
  return on ? (
    <details className="adv">
      <summary>
        {label} <span className="muted sm">· 필요할 때만</span>
      </summary>
      {children}
    </details>
  ) : (
    <>{children}</>
  );
}

export default function Entry({ data, today, req, onClose, onSaved, onBoardMove, notify, undoEarlyOut, onOpenSimple }: Props) {
  const s = data.hotel!.settings;
  const L = useMemo(() => lookups(s), [s]);
  const base = req.booking;
  // 이름이 빈 타입은 고를 수 없어요 (고치는 예약에 이미 붙은 타입은 그대로 보여요)
  const pickTypes = s.types.filter((t) => typeLabel(t) || t.id === base?.typeId);
  const p = req.preset ?? {};
  const isNew = !base;
  const initKind: Kind = base?.kind ?? p.kind ?? "stay";
  const [kind, setKind] = useState<Kind>(initKind);
  // 단체 예약: 신규 등록할 때만 '단체'로 바꿔서 여러 방을 한 번에
  const [group, setGroup] = useState(false);
  const [addGroup, setAddGroup] = useState(false);
  /** 혼자 묵는 예약에서 「객실 추가」를 누르면 한 단체로 묶고 그 id를 여기 둬요 */
  const [soloGid, setSoloGid] = useState<string | null>(null);
  const [soloBusy, setSoloBusy] = useState(false);
  /** 기록 정정 시트 */
  const [recOpen, setRecOpen] = useState(false);
  // 이용 기간 미정(∞) · 추가 객실(신규 숙박 여러 방) — 새 예약에서만 고르고, 고치는 예약은 저장된 값을 그대로 이어요
  const [openOn, setOpenOn] = useState(base?.openEnded === true);
  const [openHold, setOpenHold] = useState(base?.holdAhead ?? OPEN_HOLD_DEFAULT);
  const [extraRooms, setExtraRooms] = useState<string[]>([]);
  /** 방이 2개 이상일 때 객실별 요금 수정분 (비어 있으면 호텔 요금표 제안) */
  const [rateEdits, setRateEdits] = useState<RateEdits>({});
  const [platformId, setPlatformId] = useState(base?.platformId ?? p.platformId ?? s.platforms[0]?.id ?? "");
  const [typeId, setTypeId] = useState(base?.typeId ?? p.typeId ?? usableTypes(s.types)[0]?.id ?? "");
  const [checkIn, setCheckIn] = useState(base?.checkIn ?? p.checkIn ?? today);
  const [stayMode, setStayMode] = useState<StayMode>(base?.stayMode === "long_stay" ? "long_stay" : "standard");
  const [flatAmt, setFlatAmt] = useState(() => String(base?.longStayRate?.kind === "flat" ? base.longStayRate.flatAmount ?? "" : ""));
  const [settleCycle, setSettleCycle] = useState<SettleCycle>(base?.settleCycle === "adhoc" ? "adhoc" : "weekly");
  const [nights, setNights] = useState(() =>
    clampStayNights(base?.nights ?? p.nights ?? (base?.stayMode === "long_stay" ? LONG_STAY_WINDOW_DEFAULT : 1)),
  );
  // 숙박: 퇴실 = 입실 + 박수. 입실·박수 바꾸면 퇴실이, 퇴실 고르면 박수가 맞춰져요 (장기는 재고 창만)
  const checkOutDate = checkOutFromStayNights(checkIn, nights);
  const long = stayMode === "long_stay";
  /** 수정 표준 숙박만 탭 사용 · 신규 표준은 night-pick only (Option D absorb #1) */
  const [stayTab, setStayTab] = useState<"period" | "paint">("period");
  const longRate = long ? flatRate(Number(flatAmt || 0)) : null;
  const setStayCheckIn = (d: string) => setCheckIn(d);
  const stayDateUx = entryStayDateUx({ isNew, kind, longStay: long });
  const showNightPick = stayDateUx === "night-pick" || (stayDateUx === "period-tabs" && stayTab === "paint");
  useEffect(() => {
    if (long || kind !== "stay") setStayTab("period");
  }, [long, kind]);
  // 대실 시간: 입력 중인 글자(raw)는 그대로 두고, 알아볼 수 있으면 HH:MM으로 저장해요
  // 신규: 설정 dayuseDefaults 우선 (수정·preset 값은 유지)
  const [startRaw, setStartRaw] = useState(
    () => base?.startTime ?? p.startTime ?? (isNew && initKind === "dayuse" ? s.dayuseDefaults.startTime : ""),
  );
  const [endRaw, setEndRaw] = useState(
    () => base?.endTime ?? p.endTime ?? (isNew && initKind === "dayuse" ? s.dayuseDefaults.endTime : ""),
  );
  const startTime = parseTime(startRaw);
  const [dur, setDur] = useState<number | null>(() => {
    const m = base?.startTime && base?.endTime ? dayuseMinutes(base.startTime, base.endTime) : null;
    return m && DURATIONS.includes(m / 60) ? m / 60 : null;
  });
  // 이용 시간을 골랐으면 끝 시간은 시작 + 이용 시간
  const endTime = dur != null && startTime ? addMinutesToTime(startTime, dur * 60) : parseTime(endRaw);
  const useMin = dayuseMinutes(startTime, endTime);
  const startRef = useRef<HTMLInputElement>(null);
  // 신규 대실: 설정 기본 채움 · 설정 없고 오늘이면 예전처럼 nowRounded
  useEffect(() => {
    if (!isNew || kind !== "dayuse") return;
    if (!startRaw) {
      if (s.dayuseDefaults.startTime) setStartRaw(s.dayuseDefaults.startTime);
      else if (checkIn === today) setStartRaw(nowRounded());
    }
    if (!endRaw && s.dayuseDefaults.endTime) setEndRaw(s.dayuseDefaults.endTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, checkIn]);
  const [guestName, setName] = useState(base?.guestName ?? "");
  const [guestPhone, setPhone] = useState(base?.guestPhone ?? "");
  const [company, setCompany] = useState(base?.company ?? "");
  const [price, setPrice] = useState(() =>
    base
      ? String(base.price)
      : p.price != null
        ? String(p.price)
        : isNew && initKind === "dayuse"
          ? String(s.dayuseDefaults.price)
          : "",
  );
  const pickDayuseKind = () => {
    setKind("dayuse");
    if (!isNew) return;
    if (!startRaw) setStartRaw(s.dayuseDefaults.startTime || (checkIn === today ? nowRounded() : ""));
    if (!endRaw) setEndRaw(s.dayuseDefaults.endTime);
    setPrice((cur) => (cur ? cur : String(s.dayuseDefaults.price)));
  };
  /** 표준 숙박 1박 요금 (편집 가능). 박수↓ 시 총액 = 이 값 × 박수 + 가산분 */
  const initGroupRates = base?.groupId ? data.groups.get(base.groupId)?.rates ?? null : null;
  const [rateStr, setRateStr] = useState(() => {
    if (!base || base.kind !== "stay" || base.stayMode === "long_stay" || !base.nights) return "";
    return String(roomNightRate(base, initGroupRates?.[base.typeId]));
  });
  /** 플랫폼 전용 판매금 모드 · 기본 총액 */
  const [salesMode, setSalesMode] = useState<SalesMode>("total");
  /** 방×밤 요금 행렬 (있으면 총액 = Σ 셀 + 가산) */
  const [nightRates, setNightRates] = useState<StayNightRates | null>(() => {
    if (!base || base.kind !== "stay" || base.stayMode === "long_stay" || !base.nights) return null;
    if (base.nightRates) return syncStayNightRates(base.checkIn, base.nights, base.nightRates, { typeRate: initGroupRates?.[base.typeId] });
    const flat = roomNightRate(base, initGroupRates?.[base.typeId]);
    return flat > 0 ? syncStayNightRates(base.checkIn, base.nights, { flat }) : null;
  });
  const [wdStr, setWdStr] = useState(() => (base?.nightRates?.weekday != null ? String(base.nightRates.weekday) : ""));
  const [weStr, setWeStr] = useState(() => (base?.nightRates?.weekend != null ? String(base.nightRates.weekend) : ""));
  const [roomId, setRoomId] = useState<string | null>(base?.roomId ?? p.roomId ?? null);
  // 객실 이동 구간 (첫 구간 방 = roomId). 저장할 때 같이 저장돼요
  const [segs, setSegs] = useState<RoomSegment[] | null>(base?.segments ?? null);
  const [mv, setMv] = useState<{ from: number; room: string | null; other: boolean } | null>(null);
  const [arrived, setArrived] = useState(base?.arrived ?? false);
  const [checkedOutAt, setCheckedOutAt] = useState<string | null>(base?.checkedOutAt ?? null);
  const [tentative, setTentative] = useState(base?.tentative ?? false);
  const [noClean, setNoClean] = useState(base?.noClean ?? false);
  /** Mobile: 날짜·객실 pane collapsible after pick · desktop always expanded (CSS) */
  const [leftPaneOpen, setLeftPaneOpen] = useState(true);
  const [memo, setMemo] = useState(base?.memo ?? "");
  // 인원 · 추가 인원 금액 (판매 가격에 들어 있어요)
  const baseOf = (tid: string) => typeGuests(s.types.find((t) => t.id === tid)).base;
  const [guests, setGuests] = useState<number>(base?.guests ?? baseOf(base?.typeId ?? p.typeId ?? usableTypes(s.types)[0]?.id ?? ""));
  const gTouched = useRef(!!base?.guests);
  const [extraFee, setExtraFee] = useState<number>(base?.extraFee ?? 0);
  const [xManual, setXManual] = useState(false);
  const [xEdit, setXEdit] = useState(false);
  // 빠른 입실 · 늦은 퇴실: 시간 수 + 금액 (판매 가격에 들어 있어요). 서비스 = 시간은 두고 0원
  const [earlyIn, setEarlyIn] = useState(clampHours(base?.earlyIn));
  const [lateOut, setLateOut] = useState(clampHours(base?.lateOut));
  const [timeFee, setTimeFee] = useState<number>(base && hasExtraTime(base) ? Math.max(0, base.timeFee ?? 0) : 0);
  const [tMode, setTMode] = useState<"auto" | "manual" | "service">(() => {
    if (!base || !hasExtraTime(base)) return "auto";
    if (!base.timeFee) return "service";
    return base.timeFee === autoTimeFee(s, clampHours(base.earlyIn), clampHours(base.lateOut)) ? "auto" : "manual";
  });
  const [tEdit, setTEdit] = useState(false);
  // 주차 (설정에서 켠 호텔만): 도보 · 차량, 대수 · 번호, 추가 차량 금액(+) · 도보 할인(−)은 판매 가격에 들어 있어요
  const pk = s.parking.enabled;
  const [arrival, setArrival] = useState<Arrival | null>(base?.arrival ?? null);
  const [cars, setCars] = useState<number>(Math.max(1, base?.cars ?? 1));
  const [plates, setPlates] = useState<string[]>(base?.plates ?? []);
  const [carFee, setCarFee] = useState<number>(base?.arrival === "car" ? Math.max(0, base.carFee ?? 0) : 0);
  const [walkOff, setWalkOff] = useState<number>(base?.arrival === "walk" ? Math.max(0, base.walkOff ?? 0) : 0);
  const [cMan, setCMan] = useState(false);
  const [wMan, setWMan] = useState(false);
  // 쿠폰 · 플랫폼 입금 확인 (저장할 때 같이)
  const [coupons, setCoupons] = useState<{ amount: string; hotel: boolean }[]>(() => (base?.coupons ?? []).map((c) => ({ amount: String(c.amount), hotel: c.hotel })));
  const [payOk, setPayOk] = useState(base?.payoutOk === true);
  const [payAmt, setPayAmt] = useState(base?.payoutOk && base.payoutAmount != null ? String(base.payoutAmount) : "");
  // 결제 Option A: 금액 한 칸 공유 · [받기]/[선금]으로 kind 분기 (수정·장기)
  const initLeft = (() => {
    if (!base) return "";
    const paid = (base.payments ?? []).reduce((n, x) => n + x.amount, 0);
    if (isLongStay(base)) {
      const due = (base.charges ?? []).reduce((n, x) => n + x.amount, 0);
      const left = Math.max(0, due - paid);
      return left > 0 ? String(left) : "";
    }
    const plat = s.platforms.find((p) => p.id === base.platformId);
    // OTA는 잔금 없음 (payState와 동일 · 결제 내역이 있어도 현장 결제만 따짐)
    if (!isOnsite(plat)) return "";
    const left = Math.max(0, revenueOf(base) - paid);
    return left > 0 ? String(left) : "";
  })();
  const [recv, setRecv] = useState<{ amount: string; method: BookPayMethod; date: string }>({
    amount: initLeft,
    method: "card",
    date: today,
  });
  const [payBusy, setPayBusy] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);
  /** 신규 표준 숙박 · 현장: 간단과 같은 완납/후불/선금 progressive (Option D absorb #3) */
  const [createPayMode, setCreatePayMode] = useState<OnsitePayMode>("prepaid");
  const [createDepAmt, setCreateDepAmt] = useState("");
  const [createDepMethod, setCreateDepMethod] = useState<BookPayMethod>("card");
  // 조기 퇴실: 날짜 · (환불 | 잔액 보관 | 없음) → 바로 저장 · refund_amount≠보관
  const [eo, setEo] = useState<{
    date: string;
    disposition: EarlyOutDisposition;
    refund: string;
    keepAmount: string;
    preferredDate: string;
    note: string;
  } | null>(null);
  const [eoBusy, setEoBusy] = useState(false);
  const [eoErr, setEoErr] = useState<string | null>(null);
  const live = base ? (data.bookings.find((x) => x.id === base.id) ?? base) : null;
  const eoNow = !!live && isEarlyOut(live) && live.status === "active";
  const eoToday = !!live && canEarlyOutToday(live, today);
  // 지난 숙박 바로잡기: 이미 끝난 2박 이상 숙박은 아래 버튼으로 날짜를 선택해 입력해요
  const eoPast = !!live && !eoNow && !eoToday && live.status === "active" && live.kind === "stay" && (live.nights ?? 0) >= 2 && today >= checkOut(live);
  // 1박 연장: 박수+1 · 오늘 요금 가산 · 수납 또는 잔금
  const groupRates = live?.groupId ? (data.groups.get(live.groupId)?.rates ?? null) : null;
  const defaultExRate = live && canExtend(live) ? nightRate(live, groupRates?.[live.typeId]) : 0;
  const [ex, setEx] = useState<{ rate: string; collect: boolean; method: BookPayMethod } | null>(() =>
    req.openExtend && !req.openSurcharge && live && canExtend(live) ? { rate: String(defaultExRate), collect: true, method: "card" } : null,
  );
  const [exBusy, setExBusy] = useState(false);
  const [exErr, setExErr] = useState<string | null>(null);
  /** 연장 겹침 경고: 승인 시에만 저장 */
  const [exOverlap, setExOverlap] = useState<{ rate: number; others: Booking[]; extraNight: string } | null>(null);
  // +추가금: 할증·시간료·기타 (박수 불변 · 받기/잔금)
  const initAsHours = () => {
    if (!live) return 1;
    const cur = clampHours(live.lateOut);
    if (cur >= 1) return cur;
    const elapsed = suggestElapsedLateHours(s.stayTimes.checkOut, hotelWallClock().time);
    return elapsed >= 1 ? elapsed : 1;
  };
  const [as, setAs] = useState<{
    reason: SurchargeReason;
    hours: number;
    amount: string;
    memo: string;
    collect: boolean;
    method: BookPayMethod;
  } | null>(() => {
    if (!req.openSurcharge || !live || !canAddSurcharge(live)) return null;
    const hours = initAsHours();
    return {
      reason: clampHours(live.lateOut) ? "late_out" : suggestElapsedLateHours(s.stayTimes.checkOut, hotelWallClock().time) >= 1 ? "late_fee" : "late_out",
      hours,
      amount: String(defaultSurchargeAmount(s.extraHourFee, hours)),
      memo: "",
      collect: true,
      method: "transfer",
    };
  });
  const [asBusy, setAsBusy] = useState(false);
  const [asErr, setAsErr] = useState<string | null>(null);
  const [winBusy, setWinBusy] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const canEx = !!live && canExtend(live);
  const canAs = !!live && canAddSurcharge(live);
  const eocRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (eo || ex || as) eocRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!eo, !!ex, !!as]);
  const openEo = () => {
    if (!live) return;
    const ds = earlyOutDates(live);
    setEoErr(null);
    setEx(null);
    setExOverlap(null);
    setAs(null);
    const date = ds.includes(today) ? today : ds[ds.length - 1];
    const sug = unusedNightRefund(live, date, groupRates?.[live.typeId]);
    const keep = defaultKeepAmount(live, date, groupRates?.[live.typeId]);
    const onsite = isOnsite(L.plats.get(live.platformId));
    setEo({
      date,
      disposition: onsite && keep > 0 ? "keep" : sug > 0 ? "refund" : "none",
      refund: sug > 0 ? String(sug) : "",
      keepAmount: keep > 0 ? String(keep) : "",
      preferredDate: "",
      note: "",
    });
  };
  const openAs = () => {
    if (!live || !canAddSurcharge(live)) return;
    setAsErr(null);
    setEx(null);
    setExOverlap(null);
    setEo(null);
    const hours = initAsHours();
    const elapsed = suggestElapsedLateHours(s.stayTimes.checkOut, hotelWallClock().time);
    setAs({
      reason: clampHours(live.lateOut) ? "late_out" : elapsed >= 1 ? "late_fee" : "late_out",
      hours,
      amount: String(defaultSurchargeAmount(s.extraHourFee, hours)),
      memo: "",
      collect: true,
      method: "transfer",
    });
  };
  const openEx = () => {
    if (!live || !canExtend(live)) return;
    setExErr(null);
    setExOverlap(null);
    setEo(null);
    setAs(null);
    const rate =
      isLongStay(live) && live.longStayRate
        ? nightAmount(live.longStayRate, addDays(live.checkIn, live.nights ?? 0)) ?? 0
        : nightRate(live, groupRates?.[live.typeId]);
    setEx({ rate: String(rate), collect: !isLongStay(live), method: "card" });
  };
  /** 박수↓이면 판매가 = 행렬 Σ 또는 1박 × 새박수 + 가산분. 박수↑도 본문 반영 · 「1박 연장」은 별도 CTA. */
  const applyStayNights = (nextRaw: number, opts?: { checkIn?: string; shift?: NightShiftMode }): void => {
    const committed = commitEditStayDates({
      nextNights: nextRaw,
      nextCheckIn: opts?.checkIn ?? checkIn,
    });
    const next = committed.nights;
    const nextCheckIn = committed.checkIn;
    // P0: nights↑로 연장 패널 가로채기 금지 (ops 「1박 연장」 CTA만)
    if (nightsUpOpensExtendPanel()) {
      openEx();
      return;
    }
    if (!long && kind === "stay" && next >= 1 && (next !== nights || nextCheckIn !== checkIn)) {
      const addons = stayAddons({ kind: "stay", extraFee, earlyIn, lateOut, timeFee, arrival, carFee, walkOff });
      // 총액 모드(플랫폼 + 현장·전화): 총액 유지 · night_rates만 재분배(나머지 마지막 박)
      if (salesMode === "total" && Number(price || 0) > 0) {
        const room = Math.max(0, Number(price || 0) - addons);
        const redistributed = nightRatesFromTotal(nextCheckIn, next, room);
        setNightRates(redistributed);
        setRateStr(String(redistributed.flat ?? (next >= 1 ? Math.floor(room / next) : 0)));
      } else {
        const typeRate = base?.groupId ? data.groups.get(base.groupId)?.rates?.[typeId] : undefined;
        const rate = Number(rateStr || 0) > 0 ? Math.round(Number(rateStr)) : roomNightRate(
          { kind: "stay", price: Number(price || 0), nights, nightRates, extraFee, earlyIn, lateOut, timeFee, arrival, carFee, walkOff },
          typeRate,
        );
        const prevRates: StayNightRates = {
          ...(nightRates ?? {}),
          flat: rate || nightRates?.flat || null,
          weekday: wdStr ? Number(wdStr) : nightRates?.weekday ?? null,
          weekend: weStr ? Number(weStr) : nightRates?.weekend ?? null,
        };
        const fb = { typeRate: typeRate ?? rate };
        let synced: StayNightRates;
        if (nextCheckIn !== checkIn && nightRates?.nights) {
          // 입실일이 바뀌면 고쳐 둔 박별 요금을 지우지 않고, 어떻게 할지 물어요
          if (!opts?.shift && shiftDifferences(prevRates, checkIn, nights, nextCheckIn, Math.min(next, nights), fb).length) {
            const d = shiftDays(checkIn, nextCheckIn);
            void askConfirm({
              title: "입실일 변경 · 박별 요금",
              body: `입실일이 ${Math.abs(d)}일 ${d > 0 ? "뒤로" : "앞으로"} 바뀌어요. 고쳐 둔 박별 요금을 어떻게 할까요?\n· 박 따라 옮기기: 1박째 요금은 새 1박째로, 2박째는 새 2박째로 가요.\n· 날짜에 그대로 두기: 같은 날짜는 그 요금 그대로, 새 날짜는 기본 요금이에요. (창을 닫아도 이쪽이에요)`,
              confirmLabel: "박 따라 옮기기",
              cancelLabel: "날짜에 그대로 두기",
            }).then((ok) => applyStayNights(nextRaw, { ...opts, shift: ok ? "move" : "keep" }));
            return;
          }
          synced = shiftNightRates(prevRates, checkIn, nights, nextCheckIn, next, opts?.shift ?? "move", fb);
        } else synced = syncStayNightRates(nextCheckIn, next, prevRates, fb);
        setNightRates(synced);
        if (hasFullNightMatrix(nextCheckIn, next, synced)) {
          setRateStr(String(synced.flat ?? rate));
          setPrice(String(priceFromNightMatrix(synced, addons)));
        } else if (next < nights) {
          const snap = {
            kind: "stay" as const,
            price: Number(price || 0),
            nights,
            checkIn: nextCheckIn,
            nightRates: synced,
            extraFee,
            earlyIn,
            lateOut,
            timeFee,
            arrival,
            carFee,
            walkOff,
          };
          const r = repriceForNights(snap, next, rate);
          setRateStr(String(r.rate));
          setPrice(String(r.price));
          if (r.nightRates) setNightRates(r.nightRates);
        }
      }
    }
    if (opts?.checkIn != null) setCheckIn(opts.checkIn);
    setNights(next);
  };
  const setStayNights = (n: number) => applyStayNights(n);
  const setStayCheckOut = (d: string) => setStayNights(nightsFromStayDates(checkIn, d));
  const setRateAndTotal = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 9);
    setRateStr(digits);
    if (long || kind !== "stay" || nights < 1) return;
    const rate = Number(digits || 0);
    const addons = stayAddons({ kind: "stay", extraFee, earlyIn, lateOut, timeFee, arrival, carFee, walkOff });
    const next = syncStayNightRates(
      checkIn,
      nights,
      { ...(nightRates ?? {}), flat: rate, weekday: wdStr ? Number(wdStr) : nightRates?.weekday, weekend: weStr ? Number(weStr) : nightRates?.weekend },
      { typeRate: rate },
    );
    // flat만 바꾸면 셀을 새 단가로 다시 채움 (날짜 오버라이드 일괄 리셋)
    const refilled = refillFromDefaults(checkIn, nights, next);
    setNightRates(refilled);
    setPrice(String(priceFromNightMatrix(refilled, addons)));
  };
  const setTotalAndRate = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 9);
    setPrice(digits);
    if (long || kind !== "stay" || nights < 1) return;
    const addons = stayAddons({ kind: "stay", extraFee, earlyIn, lateOut, timeFee, arrival, carFee, walkOff });
    const room = Math.max(0, Number(digits || 0) - addons);
    // 총액 모드(플랫폼 + 현장·전화): Σ = 총액(나머지 마지막 박)
    if (salesMode === "total") {
      const next = nightRatesFromTotal(checkIn, nights, room);
      setNightRates(next);
      setRateStr(String(next.flat ?? Math.floor(room / nights)));
      return;
    }
    const rate = Math.round(room / nights);
    setRateStr(String(rate));
    // 총액 오버라이드: flat·셀을 균등 단가로 맞춤 (이후 행렬이 진실)
    const next = refillFromDefaults(checkIn, nights, { ...(nightRates ?? {}), flat: rate, weekday: wdStr ? Number(wdStr) : null, weekend: weStr ? Number(weStr) : null });
    setNightRates(next);
  };
  const applyWdWe = (wd: string, we: string) => {
    setWdStr(wd);
    setWeStr(we);
    if (long || kind !== "stay" || nights < 1) return;
    const next = refillFromDefaults(checkIn, nights, {
      ...(nightRates ?? {}),
      flat: Number(rateStr || 0) || nightRates?.flat || null,
      weekday: wd ? Number(wd) : null,
      weekend: we ? Number(we) : null,
    });
    setNightRates(next);
    const addons = stayAddons({ kind: "stay", extraFee, earlyIn, lateOut, timeFee, arrival, carFee, walkOff });
    setPrice(String(priceFromNightMatrix(next, addons)));
  };
  const editNightAmount = (date: string, amount: number) => {
    if (long || kind !== "stay") return;
    const baseRates =
      nightRates ??
      syncStayNightRates(checkIn, nights, { flat: Number(rateStr || 0) || null }, {});
    const next = setNightAmount(baseRates, date, amount);
    setNightRates(next);
    const addons = stayAddons({ kind: "stay", extraFee, earlyIn, lateOut, timeFee, arrival, carFee, walkOff });
    setPrice(String(priceFromNightMatrix(next, addons)));
  };
  const confirmAs = async () => {
    if (!live || !as || asBusy) return;
    setAsBusy(true);
    setAsErr(null);
    try {
      const amount = Number(as.amount || 0);
      const planned = planAddSurcharge(live, {
        reason: as.reason,
        hours: as.hours,
        amount,
        memo: as.memo,
        collect: as.collect,
        method: as.method,
        bizDate: today,
      });
      if ("err" in planned) return setAsErr(planned.err);
      const next: Booking = {
        ...live,
        price: planned.draft.price,
        lateOut: planned.draft.lateOut,
        timeFee: planned.draft.timeFee,
        memo: planned.draft.memo,
        // nights · segments · stayEnd 불변
      };
      const saved = await data.saveBooking(next, false);
      let collected = false;
      if (planned.collectAmount > 0) {
        try {
          await data.addPayment(saved.id, {
            kind: "balance",
            method: as.method,
            amount: planned.collectAmount,
            bizDate: today,
            note: planned.payNote,
          });
          collected = true;
        } catch (e) {
          onClose();
          notify(
            `${surchargeNotifyLine(saved.guestName, as.reason, amount, false, planned.draft.lateOut)} · 수납하지 못했어요: ${e instanceof Error ? e.message : "다시 시도해 주세요"}`,
          );
          return;
        }
      }
      // 폼 상태 동기 (창을 닫지 않고 이어 볼 때도)
      setPrice(String(saved.price));
      setLateOut(clampHours(saved.lateOut));
      setTimeFee(Math.max(0, saved.timeFee ?? 0));
      // 0원 확정 = 서비스 유지(이후 시간 스텝이 auto로 다시 1만을 넣지 않게)
      if (amount === 0 && (planned.draft.lateOut || planned.draft.timeFee === 0)) setTMode("service");
      else if (amount > 0) setTMode(planned.draft.timeFee === autoTimeFee(s, clampHours(saved.earlyIn), clampHours(saved.lateOut)) ? "auto" : "manual");
      setMemo(saved.memo ?? "");
      setAs(null);
      notify(surchargeNotifyLine(saved.guestName, as.reason, amount, collected, planned.draft.lateOut));
    } catch (e) {
      setAsErr(saveFailMessage(e));
    } finally {
      setAsBusy(false);
    }
  };
  const confirmEx = async (opts?: { allowOverlap?: boolean }) => {
    if (!live || !ex || exBusy) return;
    setExBusy(true);
    setExErr(null);
    try {
      if (isLongStay(live) && live.longStayRate) {
        const planned = planLongStayExtend(live, live.longStayRate);
        if ("err" in planned) return setExErr(planned.err);
        const block = extendBlock(s, data.bookings, live, planned.line.amount, (id) => L.roomLabel(id));
        if (block) return setExErr(block);
        if (!opts?.allowOverlap) {
          const others = extendOverlaps(data.bookings, live, planned.line.amount);
          if (others.length) {
            const { extraNight } = extendDraftBooking(live, planned.line.amount);
            setExOverlap({ rate: planned.line.amount, others, extraNight });
            return;
          }
        }
        setExOverlap(null);
        const next: Booking = {
          ...live,
          nights: planned.draft.nights,
          price: planned.draft.price,
          segments: planned.draft.segments,
          stayMode: "long_stay",
          longStayRate: live.longStayRate,
          settleCycle: live.settleCycle ?? "weekly",
        };
        const saved = await data.saveBooking(next, false);
        onClose();
        notify(`${saved.guestName} 님 재고 창 +1박 · ${planned.draft.nights}박 · 원장 +${won(planned.line.amount)}원`);
        return;
      }
      const rate = Number(ex.rate || 0);
      const rv = validateExtendRate(rate);
      if (rv) return setExErr(rv);
      const block = extendBlock(s, data.bookings, live, rate, (id) => L.roomLabel(id));
      if (block) return setExErr(block);
      if (!opts?.allowOverlap) {
        const others = extendOverlaps(data.bookings, live, rate);
        if (others.length) {
          const { extraNight } = extendDraftBooking(live, rate);
          setExOverlap({ rate, others, extraNight });
          return;
        }
      }
      setExOverlap(null);
      const plan = planExtend(live, rate, ex.collect);
      if (ex.collect && plan.collectAmount > 0) {
        const pv = validatePayment(plan.collectAmount, ex.method, today);
        if (pv) return setExErr(pv);
      }
      const next: Booking = {
        ...live,
        nights: plan.draft.nights,
        price: plan.draft.price,
        segments: plan.draft.segments,
        nightRates: plan.draft.nightRates ?? live.nightRates ?? null,
      };
      const saved = await data.saveBooking(next, false);
      let collected = false;
      if (ex.collect && plan.collectAmount > 0) {
        try {
          await data.addPayment(saved.id, { kind: "balance", method: ex.method, amount: plan.collectAmount, bizDate: today });
          collected = true;
        } catch (e) {
          onClose();
          notify(
            `${extendNotifyLine(saved.guestName, plan.draft, false)} · 수납하지 못했어요: ${e instanceof Error ? e.message : "다시 시도해 주세요"}`,
          );
          return;
        }
      }
      onClose();
      notify(extendNotifyLine(saved.guestName, applyExtend(live, rate), collected));
    } catch (e) {
      setExErr(saveFailMessage(e));
    } finally {
      setExBusy(false);
    }
  };
  const confirmWinExtend = async () => {
    if (!live || !isLongStay(live) || !live.longStayRate || winBusy) return;
    const block = windowExtendBlock(s, data.bookings, live, WINDOW_EXTEND_DEFAULT, live.longStayRate, (id) => L.roomLabel(id));
    if (block) return notify(block);
    const plan = planWindowExtend(live, WINDOW_EXTEND_DEFAULT, live.longStayRate);
    if ("err" in plan) return notify(plan.err);
    setWinBusy(true);
    try {
      const next: Booking = {
        ...live,
        nights: plan.nights,
        price: plan.price,
        segments: plan.segments,
        stayMode: "long_stay",
        longStayRate: live.longStayRate,
        settleCycle: live.settleCycle ?? "weekly",
      };
      const saved = await data.saveBooking(next, false);
      notify(`${saved.guestName} 님 재고 창 +${WINDOW_EXTEND_DEFAULT}박 · ${plan.nights}박 · 원장 +${won(plan.totalRate)}원`);
    } catch (e) {
      notify(saveFailMessage(e, "창 연장을 저장하지 못했어요"));
    } finally {
      setWinBusy(false);
    }
  };
  const confirmEo = async () => {
    if (!live || !eo || eoBusy) return;
    const onsite = isOnsite(L.plats.get(live.platformId));
    const refund =
      eo.disposition === "refund" && eo.refund.trim() ? Number(eo.refund.replace(/\D/g, "")) : null;
    const keepAmount =
      eo.disposition === "keep" && eo.keepAmount.trim() ? Number(eo.keepAmount.replace(/\D/g, "")) : 0;
    if (eo.disposition === "keep") {
      const kv = validateEarlyOutKeep(
        live,
        eo.date,
        keepAmount,
        eo.preferredDate || null,
        today,
        onsite,
      );
      if (kv) return setEoErr(kv);
      const planned = planCreateStayCredit({
        guestName: live.guestName,
        guestPhone: live.guestPhone,
        amount: keepAmount,
        preferredRecheckinDate: eo.preferredDate || null,
        sourceBookingId: live.id,
        note: eo.note || null,
        today,
        onsite,
      });
      if ("err" in planned) return setEoErr(planned.err);
    } else {
      const v = validateEarlyOut(live, eo.date, refund);
      if (v) return setEoErr(v);
    }
    setEoBusy(true);
    setEoErr(null);
    try {
      // 보관 경로: refund_amount는 항상 null (현금 환불과 분리)
      const saved = await data.setEarlyOut(live.id, eo.date, eo.disposition === "refund" ? refund || null : null);
      let keepTail = "";
      if (eo.disposition === "keep") {
        const created = await data.createStayCredit({
          guestName: live.guestName,
          guestPhone: live.guestPhone,
          amount: keepAmount,
          preferredRecheckinDate: eo.preferredDate || null,
          sourceBookingId: live.id,
          note: eo.note || null,
        });
        keepTail = ` · ${keepCreditNotifyLine(created.guestName, created.amountOriginal, created.preferredRecheckinDate)}`;
      }
      const freed = (saved.nights ?? 0) - (usedNights(saved) ?? 0);
      const room = L.roomLabel(roomOnNight(live, eo.date) ?? null);
      const refundTail =
        eo.disposition === "refund" && refund ? ` · 환불 ${won(refund)}원` : eo.disposition === "none" ? " · 환불 없음" : "";
      onClose();
      notify(
        `${saved.guestName} 님 ${eo.date === today ? "오늘" : dayLabel(eo.date)} 조기 퇴실 · ${usedLabel(saved)} · ${room ? `${room}호 ` : ""}${freed}박 비웠어요${refundTail}${keepTail}`,
        { action: { label: "되돌리기", run: () => void undoEarlyOut(saved.id) }, ms: 8000 },
      );
    } catch (e) {
      setEoErr(saveFailMessage(e));
    } finally {
      setEoBusy(false);
    }
  };
  const undoEo = async () => {
    if (!live || eoBusy) return;
    setEoBusy(true);
    const ok = await undoEarlyOut(live.id);
    setEoBusy(false);
    if (ok) onClose();
  };
  const [inErr, setInErr] = useState<string | null>(null);
  const [ncxBusy, setNcxBusy] = useState(false);
  const [coBusy, setCoBusy] = useState(false);
  const [coConfirm, setCoConfirm] = useState<{ booking: Booking; members: Booking[] } | null>(null);

  const applyEntryCheckOut = async (liveB: Booking, isDayuse: boolean, notifyLine?: string) => {
    if (!base || coBusy) return;
    setCoBusy(true);
    setInErr(null);
    const at = new Date().toISOString();
    setCheckedOutAt(at);
    setArrived(true);
    try {
      const patch: Parameters<typeof data.patchBooking>[1] = { checkedOutAt: at, arrived: true };
      if (!isDayuse && isLongStay(liveB) && checkOut(liveB) > today) {
        const n = nightsAtCheckout(liveB.checkIn, today);
        patch.nights = n;
        patch.segments = fitSegments(liveB.segments, liveB.roomId, n);
        setNights(n);
      }
      await data.patchBooking(base.id, patch);
      notify(
        notifyLine ??
          (isDayuse ? `${base.guestName} 님 대실 이용을 종료했어요` : `${base.guestName} 님 퇴실처리했어요`),
      );
    } catch {
      setCheckedOutAt(null);
      setInErr(isDayuse ? "이용 종료를 저장하지 못했어요. 다시 눌러 주세요." : "퇴실처리를 저장하지 못했어요. 다시 눌러 주세요.");
    } finally {
      setCoBusy(false);
    }
  };

  const confirmEntryCheckoutOnly = async () => {
    if (!coConfirm || !base) return;
    const b = coConfirm.booking;
    const members = coConfirm.members.map((m) => data.bookings.find((x) => x.id === m.id) ?? m);
    const plat = L.plats.get(b.platformId);
    const info = b.groupId ? data.groups.get(b.groupId) ?? null : null;
    const left = b.groupId ? settle(members, info, plat).left : payState(b, plat).left;
    setCoConfirm(null);
    await applyEntryCheckOut(b, false, left > 0 ? checkoutLeaveBalanceNotifyLine(b.guestName, left) : undefined);
  };

  const confirmEntryCheckoutPayThen = async (plan: PaymentDeskPayPlan) => {
    if (!coConfirm || !base || coBusy) return;
    const b = coConfirm.booking;
    const members = coConfirm.members.map((m) => data.bookings.find((x) => x.id === m.id) ?? m);
    setCoBusy(true);
    setInErr(null);
    const at = new Date().toISOString();
    setCheckedOutAt(at);
    setArrived(true);
    try {
      if (plan.asGroup) {
        const gid = sameGroupId(members);
        if (!gid) {
          setInErr("같은 단체만 한 번에 수납할 수 있어요.");
          setCheckedOutAt(null);
          return;
        }
        await data.addGroupPayment(gid, { method: plan.method, amount: plan.amount, bizDate: today });
      } else {
        await data.addPayment(b.id, {
          kind: plan.kind,
          method: plan.method,
          amount: plan.amount,
          bizDate: today,
        });
      }
      const patch: Parameters<typeof data.patchBooking>[1] = { checkedOutAt: at, arrived: true };
      if (isLongStay(b) && checkOut(b) > today) {
        const n = nightsAtCheckout(b.checkIn, today);
        patch.nights = n;
        patch.segments = fitSegments(b.segments, b.roomId, n);
        setNights(n);
      }
      await data.patchBooking(base.id, patch);
      setCoConfirm(null);
      notify(checkoutPayNotifyLine(b.guestName, plan.amount, plan.method, plan.asGroup));
    } catch (e) {
      setCheckedOutAt(null);
      setInErr(saveFailMessage(e, "결제·퇴실처리를 저장하지 못했어요"));
    } finally {
      setCoBusy(false);
    }
  };

  const toggleCheckOut = async () => {
    if (!base || coBusy) return;
    const isDayuse = base.kind === "dayuse";
    if (!isDayuse && base.kind !== "stay") return;
    const done = isCheckedOut({ checkedOutAt });
    if (done) {
      const liveUndo = data.bookings.find((x) => x.id === base.id) ?? { ...base, checkedOutAt };
      if (!canUndoCheckout(liveUndo)) {
        setInErr("퇴실처리된 예약만 되돌릴 수 있어요.");
        return;
      }
      const block = checkoutUndoBlock(data.bookings, liveUndo, today, (id) => L.roomLabel(id));
      if (block) {
        setInErr(block);
        return;
      }
      const roomLab = liveUndo.roomId ? L.roomLabel(liveUndo.roomId) ?? "" : "";
      const undoOk = await askConfirm({
        title: isDayuse ? DAYUSE_UNDO_TITLE : CHECKOUT_UNDO_TITLE,
        body: isDayuse ? dayuseUndoConfirmBody(liveUndo, roomLab) : checkoutUndoConfirmBody(liveUndo, roomLab),
        confirmLabel: CHECKOUT_UNDO_CTA,
      });
      if (!undoOk) return;
      setCoBusy(true);
      setInErr(null);
      const prev = checkedOutAt;
      setCheckedOutAt(null);
      try {
        await data.patchBooking(base.id, restoreCheckoutPatch());
        notify(isDayuse ? `${base.guestName} 님 이용 종료를 되돌렸어요` : `${base.guestName} 님 퇴실처리를 되돌렸어요`);
      } catch {
        setCheckedOutAt(prev);
        setInErr(isDayuse ? "이용 종료 되돌리기를 저장하지 못했어요. 다시 눌러 주세요." : "퇴실처리 되돌리기를 저장하지 못했어요. 다시 눌러 주세요.");
      } finally {
        setCoBusy(false);
      }
      return;
    }
    const liveB = data.bookings.find((x) => x.id === base.id) ?? base;
    if (isDayuse) {
      if (!canEndDayuse({ ...liveB, checkedOutAt: null })) {
        setInErr("이미 이용이 끝났거나 취소된 대실이에요.");
        return;
      }
      const endOk = await askConfirm({
        title: "이용 종료",
        body: `대실 이용을 종료할까요?\n${liveB.startTime ?? ""}~${liveB.endTime ?? ""} · ${liveB.guestName}`,
        confirmLabel: "이용 종료",
        danger: true,
      });
      if (!endOk) return;
      await applyEntryCheckOut(liveB, true);
      return;
    }
    if (!canCheckOut({ ...liveB, checkedOutAt: null }, today)) {
      setInErr(
        isLongStay(liveB)
          ? "입실일 전부터는 퇴실처리할 수 없어요."
          : "퇴실일은 퇴실 아침부터 퇴실처리할 수 있어요. 그보다 일찍 나가면 조기 퇴실을 써 주세요.",
      );
      return;
    }
    const peers = liveB.groupId ? groupStayPeers(data.bookings, liveB.groupId) : [];
    setCoConfirm({ booking: liveB, members: peers.length ? peers : [liveB] });
  };
  const [swapChoice, setSwapChoice] = useState<RoomSwapPlan | null>(null);
  const [swapBusy, setSwapBusy] = useState(false);
  /** 방 고르기 · 간단 예약(미배정). 방 지우면 임시도 끔 · 점유 방이면 맞교환 모달 */
  const pickRoom = (id: string | null) => {
    if (id && roomId && id !== roomId && kind === "stay" && base && isActive(base) && !base.checkedOutAt) {
      const live: Booking = {
        ...base,
        roomId,
        segments: fitSegments(segs, roomId, nights),
        checkIn,
        nights,
        typeId,
        guestName,
      };
      const plan = proposeRoomSwap(data.bookings, live, id);
      if (plan) {
        setSwapChoice(plan);
        return;
      }
    }
    setRoomId(id);
    if (!id) {
      setTentative(false);
      setSegs(null);
      setMv(null);
    }
  };
  const doEntrySwap = async (plan: RoomSwapPlan) => {
    if (swapBusy) return;
    const aBefore = placementOf(plan.a);
    const bBefore = placementOf(plan.b);
    setSwapBusy(true);
    try {
      await data.setPlacement(plan.a.id, { roomId: null, segments: null });
      try {
        await data.setPlacement(plan.b.id, plan.bPlace);
        await data.setPlacement(plan.a.id, plan.aPlace);
      } catch (e) {
        await data.setPlacement(plan.a.id, aBefore).catch(() => {});
        await data.setPlacement(plan.b.id, bBefore).catch(() => {});
        throw e;
      }
      setRoomId(plan.aPlace.roomId);
      setSegs(plan.aPlace.segments);
      setMv(null);
      setSwapChoice(null);
      notify(`${plan.a.guestName || "손님"} ↔ ${plan.b.guestName || "손님"} 맞교환했어요`);
    } catch {
      setInErr("맞교환하지 못했어요. 다시 해 주세요.");
      setSwapChoice(null);
    } finally {
      setSwapBusy(false);
    }
  };
  const toggleNoClean = async () => {
    if (!base || ncxBusy) return;
    const next = !noClean;
    setNcxBusy(true);
    setInErr(null);
    setNoClean(next);
    try {
      await data.patchBooking(base.id, { noClean: next });
    } catch {
      setNoClean(!next);
      setInErr("청소X를 저장하지 못했어요. 다시 눌러 주세요.");
    } finally {
      setNcxBusy(false);
    }
  };
  const [status] = useState<Status>(base?.status ?? "active");
  /** 미니 배치도 건물 칩 (간단 예약 · Entry 숙박/대실 공용 MiniFloorPlan) */
  const [buildingFilter, setBuildingFilter] = useState<BuildingFilter>("all");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [stayConfirm, setStayConfirm] = useState(false);
  const [damageOpen, setDamageOpen] = useState(false);
  const [damageBusy, setDamageBusy] = useState(false);
  const damages = useDamageIssues(data.hotel!.id);
  const [dayuseWarn, setDayuseWarn] = useState<{ message: string; again: boolean; override?: Status } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  // PC 크롬·엣지는 날짜 칸을 눌러도 달력 아이콘이 아니면 달력이 안 열려요 → 직접 열어 줘요
  const openPicker = (el: HTMLInputElement) => {
    try {
      el.showPicker?.();
    } catch {
      /* 이미 열려 있거나 지원하지 않는 브라우저: 기본 동작에 맡겨요 */
    }
  };

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const liveCharges = (base ? data.bookings.find((x) => x.id === base.id)?.charges : null) ?? base?.charges ?? [];
  const draftLongPreview =
    long && longRate && kind === "stay"
      ? withPlannedCharges(
          {
            id: base?.id ?? "__draft__",
            kind: "stay",
            status: "active",
            platformId,
            price: 0,
            guestName,
            guestPhone: guestPhone || null,
            company: company.trim() || null,
            typeId,
            roomId,
            segments: null,
            checkIn,
            nights,
            startTime: null,
            endTime: null,
            arrived,
            memo: null,
            cancelledAt: null,
            createdAt: "",
            updatedAt: "",
            stayMode: "long_stay",
            longStayRate: longRate,
            settleCycle,
            charges: liveCharges,
            payments: [],
          },
          longRate,
        )
      : null;
  // 2실 이상: 객실마다 자기 요금표 — 총액을 나누지도 같은 금액을 복사하지도 않아요
  const multi = isNew && kind === "stay" && !long && !!roomId && extraRooms.length > 0;
  const multiIds = multi && roomId ? [roomId, ...extraRooms] : [];
  const multiSlots = roomSlots(multiIds, (id) => {
    const tid = L.rooms.get(id)?.typeId ?? "";
    return { typeId: tid, label: `${L.roomLabel(id) ?? "?"}호`, sub: typeLabel(L.types.get(tid)) };
  });
  const multiRows = multi ? slotRows(s, multiSlots, rateEdits, checkIn, nights) : [];
  const multiAddons = stayAddons({ kind: "stay", extraFee, earlyIn, lateOut, timeFee, arrival, carFee, walkOff });
  const multiPrices = multiRows.map((r) => r.subtotal + multiAddons);
  const multiTotal = multiPrices.reduce((a, b) => a + b, 0);
  const draftPrice =
    long && draftLongPreview && !("err" in draftLongPreview)
      ? draftLongPreview.price
      : multi
        ? (multiPrices[0] ?? 0)
        : Number(price || 0);
  const draftBase: Booking = {
    id: base?.id ?? "__draft__",
    kind,
    status,
    platformId,
    price: draftPrice,
    // Entry에서 판매가를 입력하면 금액미정 해제
    priceUnset: !!(base?.priceUnset && !(Number(draftPrice) > 0)),
    guestName: guestName.trim() || guestName,
    guestPhone: guestPhone || null,
    company: company.trim() || null,
    typeId,
    roomId,
    segments: kind === "stay" ? fitSegments(segs, roomId, nights) : null,
    checkIn,
    nights: kind === "stay" ? nights : null,
    startTime: kind === "dayuse" ? startTime : null,
    endTime: kind === "dayuse" ? endTime : null,
    arrived,
    tentative: !!roomId && tentative,
    noClean,
    earlyOut: base?.earlyOut ?? null,
    checkedOutAt,
    stayMode: kind === "stay" ? stayMode : "standard",
    longStayRate: kind === "stay" && long ? longRate : null,
    settleCycle: kind === "stay" && long ? settleCycle : null,
    charges: long && draftLongPreview && !("err" in draftLongPreview) ? draftLongPreview.charges : liveCharges,
    refund: base?.refund ?? null,
    memo: memo || null,
    groupId: base?.groupId ?? null,
    groupName: base?.groupName ?? null,
    nightRates: kind === "stay" && !long ? (multi ? (multiRows[0]?.rates ?? null) : nightRates) : null,
    ...(openOn && kind === "stay" && !long ? { openEnded: true, holdAhead: openHold } : {}),
    guests,
    extraFee: long ? null : extraFee || null,
    earlyIn: kind === "stay" && earlyIn ? earlyIn : null,
    lateOut: kind === "stay" && lateOut ? lateOut : null,
    timeFee: kind === "stay" && (earlyIn || lateOut) ? timeFee : null,
    arrival: pk ? arrival : (base?.arrival ?? null),
    cars: pk ? (arrival === "car" ? cars : null) : (base?.cars ?? null),
    plates: pk ? (arrival === "car" ? plates : null) : (base?.plates ?? null),
    carFee: pk ? (arrival === "car" && carFee ? carFee : null) : (base?.carFee ?? null),
    walkOff: pk ? (arrival === "walk" && walkOff ? walkOff : null) : (base?.walkOff ?? null),
    coupons: cleanCoupons(coupons.map((c) => ({ amount: Number(c.amount || 0), hotel: c.hotel }))),
    payoutOk: payOk,
    payoutAmount: payOk && payAmt !== "" ? Number(payAmt) : null,
    cancelledAt: base?.cancelledAt ?? null,
    createdAt: base?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const draft = draftBase;
  // 인원 추가금: 밤마다 그 밤 방의 타입으로 계산 → 자동이면 판매 가격에 차이만큼 더하고 빼요
  const sur = surchargeOf(s, draftBase, guests);
  const prevAuto = useRef<number | null>(null);
  useEffect(() => {
    // 처음 열 때: 저장된 금액이 자동 계산과 다르면 직접 고친 걸로 봐요
    if (prevAuto.current === null) {
      prevAuto.current = sur.total;
      if (base && (base.extraFee ?? 0) !== sur.total && base.guests != null) setXManual(true);
      return;
    }
    if (prevAuto.current === sur.total) return;
    prevAuto.current = sur.total;
    if (xManual) return;
    const delta = sur.total - extraFee;
    if (delta) setPrice((v) => String(Math.max(0, Number(v || 0) + delta)));
    setExtraFee(sur.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sur.total]);
  // 새 예약: 인원을 안 건드렸으면 타입을 바꿀 때 기본 인원으로
  useEffect(() => {
    if (!gTouched.current) setGuests(baseOf(typeId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId]);
  const setXFee = (v: number, manual: boolean) => {
    const n = Math.max(0, Math.min(SURCHARGE_MAX, v));
    const delta = n - extraFee;
    if (delta) setPrice((x) => String(Math.max(0, Number(x || 0) + delta)));
    setExtraFee(n);
    setXManual(manual);
  };
  // 시간 추가 금액: 바뀐 만큼 판매 가격에 더하고 빼요
  const setTFee = (v: number, mode: "auto" | "manual" | "service") => {
    const n = Math.max(0, Math.min(SURCHARGE_MAX, Math.round(v)));
    const delta = n - timeFee;
    if (delta) setPrice((x) => String(Math.max(0, Number(x || 0) + delta)));
    setTimeFee(n);
    setTMode(mode);
  };
  const stepTime = (which: "in" | "out", d: number) => {
    const e = which === "in" ? clampHours(earlyIn + d) : earlyIn;
    const l = which === "out" ? clampHours(lateOut + d) : lateOut;
    const wasNone = !earlyIn && !lateOut;
    const wasServiceFee = timeFee === 0 && (earlyIn > 0 || lateOut > 0);
    setEarlyIn(e);
    setLateOut(l);
    if (!e && !l) return setTFee(0, "auto");
    // 첫 마킹 = 서비스(0원). 자동 시간당 요금은 옵트인.
    if (wasNone && (e || l)) return setTFee(0, "service");
    if (tMode === "service" || wasServiceFee) return setTFee(0, "service");
    // E 가드: auto여도 기존 서비스(timeFee=0) earlyIn에 late만 올릴 때 early분 재청구 금지
    if (tMode === "auto") setTFee(autoTimeFee(s, e, l), "auto");
  };
  // 대실로 바꾸면 시간 추가는 빼요
  useEffect(() => {
    if (kind !== "stay" && (earlyIn || lateOut)) {
      setEarlyIn(0);
      setLateOut(0);
      setTFee(0, "auto");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  const tAuto = autoTimeFee(s, earlyIn, lateOut);
  // 주차 금액: 자동이면 대수 · 박수 · 도보/차량이 바뀔 때 다시 계산해서 판매 가격에 차이만큼
  const cAuto = autoCarFee(s, arrival, cars, kind === "stay" ? nights : 1);
  const wAuto = autoWalkOff(s, arrival);
  const setCFee = (v: number, manual: boolean) => {
    const n = Math.max(0, Math.min(SURCHARGE_MAX, Math.round(v)));
    const d = n - carFee;
    if (d) setPrice((x) => String(Math.max(0, Number(x || 0) + d)));
    setCarFee(n);
    setCMan(manual);
  };
  const setWOff = (v: number, manual: boolean) => {
    const n = Math.max(0, Math.min(SURCHARGE_MAX, Math.round(v)));
    const d = n - walkOff;
    if (d) setPrice((x) => String(Math.max(0, Number(x || 0) - d)));
    setWalkOff(n);
    setWMan(manual);
  };
  const pkInit = useRef(false);
  useEffect(() => {
    if (!pk) return;
    if (!pkInit.current) {
      // 처음 열 때: 저장된 금액이 자동 계산과 다르면 직접 고친 걸로 봐요
      pkInit.current = true;
      if (base?.arrival === "car" && (base.carFee ?? 0) !== cAuto) setCMan(true);
      if (base?.arrival === "walk" && (base.walkOff ?? 0) !== wAuto) setWMan(true);
      if (base) return;
    }
    if (arrival !== "car") {
      if (carFee) setCFee(0, false);
    } else if (!cMan && carFee !== cAuto) setCFee(cAuto, false);
    if (arrival !== "walk") {
      if (walkOff) setWOff(0, false);
    } else if (!wMan && walkOff !== wAuto) setWOff(wAuto, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pk, arrival, cAuto, wAuto]);
  // 같은 방 같은 날: 앞 손님 늦은 퇴실 · 빠른 입실이 겹치면 경고만
  const turnWarns = kind === "stay" && status === "active" ? turnoverWarnings(s, [...data.bookings.filter((x) => x.id !== draftBase.id), draftBase]).filter((w) => w.id === draftBase.id) : [];
  const livePays = (base ? data.bookings.find((x) => x.id === base.id)?.payments : null) ?? base?.payments ?? [];
  const evidence = useMemo(() => {
    if (!base) return null;
    const gid = base.groupId ?? null;
    const mem = gid ? data.bookings.filter((x) => x.groupId === gid && x.status !== "cancelled") : [data.bookings.find((x) => x.id === base.id) ?? base];
    const info = gid ? data.groups.get(gid) : undefined;
    const rn = (bid: string) => {
      const bk = mem.find((x) => x.id === bid);
      return bk?.roomId ? `${L.roomLabel(bk.roomId) ?? "?"}호` : "미배정";
    };
    return {
      members: mem,
      groupId: gid,
      title: (gid ? base.groupName : null) ?? base.guestName,
      lines: payLines([...mem.flatMap((m) => m.payments ?? []), ...(info?.payments ?? [])], { roomName: rn, meId: data.meId }),
    };
  }, [base, data.bookings, data.groups, data.meId, L]);
  const entryOpenCredits = useMemo(
    () => matchOpenCredits(data.stayCredits, guestName || live?.guestName, guestPhone || live?.guestPhone),
    [data.stayCredits, guestName, guestPhone, live?.guestName, live?.guestPhone],
  );
  // 현장 결제·장기만 잔금 UI. OTA는 결제 내역이 있어도 「플랫폼에서 결제 · 잔금 없음」.
  const payTracked = long || isOnsite(L.plats.get(platformId));
  const curPlat = L.plats.get(platformId);
  /** 라벨 * · HTML required · save validateGuestPhone 동일 SoT (바로입실 빈 연락처 수정 완화) */
  const phoneRequired = isGuestPhoneRequired(
    curPlat,
    guestPhoneOptsForBooking({
      existing: base ? { guestPhone: base.guestPhone, guestName: base.guestName } : null,
      guestName,
    }),
  );
  /** 신규 표준 숙박·현장만 progressive · 수정/장기/대실/플랫폼은 Option A 또는 OTA */
  const createOnsitePay = isNew && kind === "stay" && !long && isOnsite(curPlat);
  const leftPaneSummary = (() => {
    const roomPart = roomId
      ? `${L.roomLabel(roomId) ?? "?"}호`
      : typeId
        ? `${typeLabel(L.types.get(typeId)) || "타입"} · 미배정`
        : "객실 미선택";
    if (kind === "dayuse") return `${dayLabel(checkIn)} · ${roomPart}`;
    return `${md(checkIn)} → ${md(checkOutDate)} · ${nights}박 · ${roomPart}`;
  })();
  const po = payoutOf(draftBase, curPlat);
  const poLine = payoutLine(po);
  // 쿠폰 · 입금 칸: 플랫폼 예약이거나 수수료율이 있는 플랫폼 (또는 이미 쿠폰을 적었으면)
  const feeOn = !long && !!curPlat && (!isOnsite(curPlat) || !!curPlat.feeRate || coupons.length > 0);
  const payPaid = livePays.reduce((n, x) => n + x.amount, 0);
  const longPay = long
    ? longPayState({
        status: "active",
        charges: draftBase.charges,
        payments: livePays,
      })
    : null;
  const payDue = longPay ? longPay.accrued : multi ? multiTotal : revenueOf({ ...draftBase, status: "active" });
  const payLeft = longPay ? Math.max(0, longPay.accrued - payPaid) : Math.max(0, payDue - payPaid);
  // 잔금이 생겼는데 금액 칸이 비어 있으면 기본값으로 채워요 (선금용으로 비운 경우는 유지)
  useEffect(() => {
    if (!payTracked || payLeft <= 0) return;
    setRecv((r) => (r.amount ? r : { ...r, amount: String(payLeft) }));
  }, [payTracked, payLeft]);
  const payNoteOf = (kind: PayKind, amount: number, method: BookPayMethod, left: number) =>
    kind === "deposit"
      ? long
        ? `${guestName} 님 선수 ${won(amount)}원 (${BOOK_PAY_LABEL[method]})${left ? ` · 미수 ${won(left)}원` : ""}`
        : `${guestName} 님 선금 ${won(amount)}원 (${BOOK_PAY_LABEL[method]})${left ? ` · 잔금 ${won(left)}원` : ""}`
      : long
        ? `${guestName} 님 미수 ${won(amount)}원 수납 (${BOOK_PAY_LABEL[method]})${left ? ` · 미수금 잔액 ${won(left)}원` : " · 정산됨"}`
        : `${guestName} 님 ${won(amount)}원 수납 (${BOOK_PAY_LABEL[method]})${left ? ` · 잔금 ${won(left)}원` : " · 완납"}`;
  /** 새 숙박 저장: 방이 여러 개면 한 단체로 묶어 저장 (객실마다 자기 요금표 · 합계는 소계의 합) */
  const nRooms = isNew && kind === "stay" && !long ? 1 + extraRooms.length : 1;
  /** 이 예약(단체면 전체)의 판매 합계 */
  const saleAll = multi ? multiTotal : draftBase.price;
  const saveNewDraft = async (d: Booking): Promise<Booking> => {
    if (!isNew || d.kind !== "stay" || !d.roomId || !extraRooms.length) return data.saveBooking(d, true);
    const groupId = crypto.randomUUID();
    const drafts = groupDrafts({
      groupId,
      groupName: d.guestName,
      platformId: d.platformId,
      checkIn: d.checkIn,
      nights: d.nights ?? 1,
      roomIds: [d.roomId, ...extraRooms],
      prices: multiPrices,
      memberNightRates: multiRows.map((r) => r.rates),
      s,
      guestsOf: () => d.guests ?? 1,
      arrived: !!d.arrived,
    }).map((g, i) => ({
      ...d,
      ...g,
      id: g.id,
      price: multiPrices[i] ?? g.price,
      nightRates: g.nightRates,
      memo: d.memo,
    }));
    const list = await data.saveGroup(drafts, {
      id: groupId,
      payMode: "prepaid",
      dueOn: null,
      payerCompany: null,
      payerName: d.guestName,
      payerPhone: d.guestPhone ?? null,
      rates: null,
      extras: [],
      badgeColor: hashGroupBadgeColor(groupId),
    });
    return list[0] ?? (await data.saveBooking(d, true));
  };
  const recordPay = async (kind: PayKind) => {
    if (payBusy || busy) return;
    const amount = Number(recv.amount || 0);
    const v = validatePayment(amount, recv.method, recv.date);
    if (v) return setPayErr(v);
    if (!long && kind === "deposit" && amount > saleAll) return setPayErr("선금이 판매 가격보다 커요.");
    // 신규: 저장과 같은 턴에 결제 내역 기록 (선금·당일 완납)
    if (!base) {
      const draft = draftBase;
      if (multi) {
        const unpriced = unpricedMessage(multiRows);
        if (unpriced) return setPayErr(unpriced);
      }
      {
        const phoneErr = validateGuestPhone(curPlat, guestPhone);
        if (phoneErr) return setPayErr(phoneErr);
      }
      if (draft.kind === "stay" && draft.stayMode === "long_stay") {
        const rv = validateLongStayRate(draft.longStayRate);
        if (rv) return setPayErr(rv);
        if (draftLongPreview && "err" in draftLongPreview) return setPayErr(draftLongPreview.err);
      }
      const bv = validateBooking(draft, s);
      if (bv) return setPayErr(bv);
      if (roomBusy && isActive(draft) && String(draft.kind) !== "stay")
        return setPayErr(
          draft.kind === "stay" && busyLegs.length
            ? `${busyLegs.map((l) => `${L.roomLabel(l.roomId)}호(${md(l.checkIn)}~${md(addDays(l.checkIn, l.nights))})`).join(", ")}는 그 기간에 다른 예약이 있어요.`
            : `${L.roomLabel(roomId)}호는 그 ${draft.kind === "stay" ? "기간" : "시간"}에 다른 예약이 있어요.`,
        );
      setPayBusy(true);
      setPayErr(null);
      try {
        const saved = await saveNewDraft(draft);
        let payTail = "";
        if (isActive(saved)) {
          try {
            await data.addPayment(saved.id, { kind, method: recv.method, amount, bizDate: recv.date });
            const left = Math.max(0, payDue - amount);
            payTail = ` · ${kind === "deposit" ? (long ? "선수" : "선금") : long ? "미수 수납" : "수납"} ${won(amount)}원(${BOOK_PAY_LABEL[recv.method]})`;
            if (left) payTail += long ? ` · 미수 ${won(left)}원` : ` · 잔금 ${won(left)}원`;
            else if (kind === "balance") payTail += long ? " · 정산됨" : " · 완납";
          } catch (e) {
            payTail = ` · 결제는 적지 못했어요: ${e instanceof Error ? e.message : "다시 시도해 주세요"}`;
          }
        }
        onSaved(`${saved.guestName} 님 예약을 기록했어요${payTail}`);
      } catch (e) {
        setPayErr(saveFailMessage(e));
      } finally {
        setPayBusy(false);
      }
      return;
    }
    if (!isActive(live ?? base)) return setPayErr("정상 예약만 수납할 수 있어요.");
    setPayBusy(true);
    setPayErr(null);
    try {
      await data.addPayment(base.id, { kind, method: recv.method, amount, bizDate: recv.date });
      const left = Math.max(0, payDue - payPaid - amount);
      setRecv((r) => ({ ...r, amount: left > 0 && kind === "balance" ? String(left) : "" }));
      notify(payNoteOf(kind, amount, recv.method, left));
    } catch (e) {
      setPayErr(saveFailMessage(e));
    } finally {
      setPayBusy(false);
    }
  };
  const nightDates = useMemo(
    () => Array.from({ length: kind === "stay" ? nights : 1 }, (_, i) => addDays(checkIn, i)),
    [kind, nights, checkIn],
  );
  const others = useMemo(() => data.bookings.filter((b) => b.id !== draft.id), [data.bookings, draft.id]);
  const table = useMemo(() => stockTable(s, others, nightDates), [s, others, nightDates]);
  const totals = useMemo(() => typeTotals(s), [s]);
  const minRemain = (tid: string) => Math.min(...nightDates.map((d) => table.get(tid)?.get(d) ?? 0));
  const legs = fullLegsOf(draft);
  const moved = legs.length > 1;
  // 방 번호 고르기: 객실 이동이 있으면 첫 방에 묵는 밤만 봐요 (조기 퇴실했으면 실제로 묵은 밤까지만)
  const firstNights = Math.min(moved ? legs[0].nights : nights, usedNights(draft) ?? nights);
  const free = useMemo(() => {
    const f = freeRooms(s, data.bookings, { ...draft, nights: kind === "stay" ? firstNights : null });
    // 편집 중 현재 호실·대실 선택 호실은 배치도에서 켜 둘 수 있게
    if (roomId) f.add(roomId);
    return f;
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, data.bookings, draft.id, kind, checkIn, nights, firstNights, startTime, endTime, roomId],
  );
  /** 배치도: 단실 토글 · 호실 타입 → typeId 동기(Path B) · 숙박 신규·대실 공용 */
  const multiPick = isNew && kind === "stay" && !long;
  const toggleFloorRoom = (id: string) => {
    if (multiPick) {
      // 새 숙박: 여러 방을 한 예약(단체)으로 — 어떤 방이든 고를 수 있어요 (겹치면 아래에 안내)
      if (extraRooms.includes(id)) return setExtraRooms((x) => x.filter((r) => r !== id));
      if (roomId === id) {
        if (extraRooms.length) {
          const [first, ...rest] = extraRooms;
          setExtraRooms(rest);
          setRoomId(first);
          const ft = L.rooms.get(first)?.typeId;
          if (ft) setTypeId(ft);
          return;
        }
        return pickRoom(null);
      }
      if (!roomId) {
        const r = L.rooms.get(id);
        if (r?.typeId) setTypeId(r.typeId);
        return pickRoom(id);
      }
      return setExtraRooms((x) => [...x, id]);
    }
    if (roomId === id) {
      if (kind === "dayuse") return; // 대실은 호실 필수 · 해제 금지
      pickRoom(null);
      return;
    }
    if (!free.has(id)) return;
    const r = L.rooms.get(id);
    if (r?.typeId) setTypeId(r.typeId);
    pickRoom(id);
  };
  // 날짜 바뀌어 불가해진 신규 선택 호실 정리 (간단 예약과 동일)
  useEffect(() => {
    // 겹쳐도 방을 지우지 않아요 — RoomClashNote가 알려 줘요 (조용히 사라지지 않게)
    if (!isNew || kind !== "stay" || !roomId) return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [free, roomId, isNew, kind]);
  // 객실 이동: k박째부터 끝까지 비어 있는 방
  const mvFree = useMemo(
    () =>
      mv && kind === "stay"
        ? freeRooms(s, data.bookings, { id: draft.id, kind: "stay", checkIn: addDays(checkIn, mv.from - 1), nights: nights - mv.from + 1, startTime: null, endTime: null })
        : new Set<string>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mv?.from, s, data.bookings, draft.id, kind, checkIn, nights],
  );
  const busyLegs = kind === "stay" ? legConflicts(data.bookings, draft) : [];
  const allRooms = placedRooms(s); // 건물 → 층 순서
  const bpre = (bid: string) => (L.multi ? <em className="bpre">{L.buildings.get(bid)?.name}</em> : null);
  const roomBusy = kind === "stay" ? busyLegs.length > 0 : !!roomId && !free.has(roomId);
  const preview = kind === "stay" && status === "active" ? previewChange(s, data.bookings, draft) : [];

  async function save(
    again = false,
    override?: Status,
    opts?: { allowDayuseOverlap?: boolean; walkInImmediate?: boolean },
  ) {
    const walkInImmediate = !!opts?.walkInImmediate;
    let draft = override ? { ...draftBase, status: override } : { ...draftBase };
    if (walkInImmediate) {
      draft = {
        ...draft,
        guestName: guestName.trim() || walkInDisplayName(checkIn),
        arrived: true,
      };
    }
    // 되살리기: 로컬 status가 아직 cancelled/noshow여도 저장 draft 기준으로 재고 미리보기
    const savePreview =
      kind === "stay" && isActive(draft)
        ? status === "active" && !override
          ? preview
          : previewChange(s, data.bookings, draft)
        : [];
    setDayuseWarn(null);
    // 현장·전화만 연락처 필수 · 바로입실·이미 빈 연락처 수정·OTA는 선택 (SoT)
    {
      const phoneOpts = guestPhoneOptsForBooking({
        walkInImmediate,
        existing: base ? { guestPhone: base.guestPhone, guestName: base.guestName } : null,
        guestName,
      });
      const phoneErr = validateGuestPhone(curPlat, guestPhone, phoneOpts);
      if (phoneErr) return setErr(phoneErr);
    }
    if (multi) {
      const unpriced = unpricedMessage(multiRows);
      if (unpriced) return setErr(unpriced);
    }
    if (walkInImmediate && draft.kind === "stay" && !draft.roomId) return setErr("바로 입실은 호실을 골라 주세요.");
    if (!walkInImmediate && !draft.guestName.trim()) return setErr("이름을 입력해 주세요.");
    if (draft.kind === "stay" && draft.stayMode === "long_stay") {
      const rv = validateLongStayRate(draft.longStayRate);
      if (rv) return setErr(rv);
      if (draftLongPreview && "err" in draftLongPreview) return setErr(draftLongPreview.err);
    }
    // 신규 현장 progressive: 선금 액수 검증 (판매금은 validateBooking)
    if (createOnsitePay) {
      const depErr = validateOnsiteCreateDeposit(createPayMode, {
        saleTotal: saleAll,
        depAmt: createDepAmt,
        depMethod: createDepMethod,
        bizDate: today,
      });
      if (depErr) return setErr(depErr);
    }
    const v = validateBooking(draft, s);
    if (v) return setErr(v);
    if (base && !override && nightsChangedWithoutPrice(base, draft)) {
      const nightsOk = await askConfirm({
        title: "박수 변경",
        body: NIGHTS_PRICE_WARN,
        confirmLabel: "저장",
      });
      if (!nightsOk) return;
    }
    const slotChanged =
      !base ||
      !isActive(base) ||
      base.roomId !== draft.roomId ||
      JSON.stringify(base.segments ?? null) !== JSON.stringify(draft.segments ?? null) ||
      base.checkIn !== draft.checkIn ||
      base.nights !== draft.nights ||
      base.startTime !== draft.startTime ||
      base.endTime !== draft.endTime ||
      base.kind !== draft.kind;
    if (roomBusy && isActive(draft) && slotChanged && !(isNew && kind === "stay"))
      return setErr(
        kind === "stay" && busyLegs.length
          ? `${busyLegs.map((l) => `${L.roomLabel(l.roomId)}호(${md(l.checkIn)}~${md(addDays(l.checkIn, l.nights))})`).join(", ")}는 그 기간에 다른 예약이 있어요.`
          : `${L.roomLabel(roomId)}호는 그 ${kind === "stay" ? "기간" : "시간"}에 다른 예약이 있어요.`,
      );
    // 판매중지: 신규·기간 변경 시 해당 숙박일 차단 (취소·노쇼는 통과)
    if (kind === "stay" && isActive(draft) && !override && draft.nights) {
      const stopped = stopSellDatesForStay(s, draft.typeId, draft.checkIn, draft.nights);
      if (stopped.length)
        return setErr(`판매중지된 숙박일이 있어요 (${stopped.map(md).join(", ")}). 판매 캘린더에서 중지를 풀어 주세요.`);
    }
    // 타입 오버부킹: 경고만 · 저장 허용 (물리 방 겹침은 위에서 차단)
    // 되살리기(override active)도 재고 경고 — 취소 때와 대칭
    const typeOver = kind === "stay" && isActive(draft) && savePreview.some((r) => r.after < 0);
    if (typeOver && (!override || override === "active")) {
      const overOk = await askConfirm({
        title: "타입 재고 부족",
        body: "타입 재고가 모자랍니다(오버부킹). 그래도 저장할까요?",
        confirmLabel: "저장",
      });
      if (!overOk) return;
    }
    // 대실 ∩ 숙박 입실/점유: 주의 팝업 · 동일 손님은 skip (하드블록 아님)
    if (kind === "dayuse" && isActive(draft) && draft.roomId && !opts?.allowDayuseOverlap) {
      const w = dayuseStayOverlapWarn(s, data.bookings, draft);
      if (!w.ok) {
        setDayuseWarn({ message: w.message, again, override });
        return;
      }
    }
    setBusy(true);
    setErr(null);
    try {
      const saved = isNew ? await saveNewDraft(draft) : await data.saveBooking(draft, isNew);
      let payTail = "";
      if (
        isNew &&
        !override &&
        createOnsitePay &&
        isActive(saved) &&
        isOnsite(s.platforms.find((x) => x.id === saved.platformId))
      ) {
        const plan = planOnsiteCreatePay(createPayMode, {
          saleTotal: saleAll,
          depAmt: createDepAmt,
          depMethod: createDepMethod,
        });
        if (plan.kind !== "none") {
          try {
            await data.addPayment(saved.id, {
              kind: plan.kind === "balance" ? "balance" : "deposit",
              method: plan.method,
              amount: plan.amount,
              bizDate: today,
            });
            payTail = onsiteCreatePayTail(plan);
          } catch (e) {
            payTail = ` · 결제는 적지 못했어요: ${e instanceof Error ? e.message : "다시 시도"}`;
          }
        }
      }
      const t = L.types.get(saved.typeId);
      const hold =
        kind === "stay" && isActive(saved) && !saved.roomId
          ? ` · ${t?.name ?? "타입"} ${saved.nights}박 · 재고 반영 · 호실 미정`
          : nRooms > 1
            ? ` · ${nRooms}실 한 예약(단체)`
            : "";
      const stockTail =
        !hold && kind === "stay" && isActive(saved) && savePreview[0]
          ? ` · ${L.types.get(savePreview[0].typeId)?.name} 잔여 객실 ${savePreview[0].after}`
          : hold;
      const tail = `${stockTail}${payTail}`;
      const revived = override === "active" && !!base && !isActive(base);
      onSaved(
        override === "cancelled"
          ? `${saved.guestName} 님 예약을 취소했어요 · 잔여 객실이 늘었어요`
          : override === "noshow"
            ? `${saved.guestName} 님 노쇼로 표시했어요 · 수납액은 매출에 남고 잔여 객실이 늘었어요`
            : revived
              ? `${saved.guestName} 님 예약을 되살렸어요${tail}`
              : `${saved.guestName} 님 예약을 ${isNew ? "기록" : "수정"}했어요${tail}`,
        again ? { kind, platformId, typeId: t?.id, checkIn, nights: kind === "stay" ? nights : undefined } : undefined,
      );
    } catch (e) {
      setErr(saveFailMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!base) return;
    setBusy(true);
    try {
      await data.deleteBooking(base.id);
      onSaved(`${base.guestName} 님 예약을 삭제했어요`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "삭제하지 못했어요");
      setBusy(false);
    }
  }

  // 단축키: 입력 칸 밖에서는 그대로, 입력 칸 안에서는 Alt와 함께
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (group) {
        if (e.key === "Escape" && !(e.target instanceof HTMLInputElement && e.target.type === "date")) onClose();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // 날짜 칸에서 Esc는 날짜 고르기만 닫고, 적던 예약은 그대로 둬요
        if (e.target instanceof HTMLInputElement && (e.target.type === "date" || e.target.type === "time" || e.target.classList.contains("tm-in"))) return e.target.blur();
        return onClose();
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        return void save(true);
      }
      const typing = isTypingTarget(e.target);
      if (typing && !e.altKey) return;
      if (e.ctrlKey || e.metaKey) return;
      const dn = /^Digit([1-9])$/.exec(e.code);
      if (dn) {
        const pl = s.platforms[Number(dn[1]) - 1];
        if (pl) {
          e.preventDefault();
          setPlatformId(pl.id);
        }
        return;
      }
      const ti = TYPE_KEYS.indexOf(e.code);
      if (ti >= 0 && pickTypes[ti]) {
        e.preventDefault();
        setTypeId(pickTypes[ti].id);
        return;
      }
      if (kind === "stay" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        setStayNights(nights + (e.key === "ArrowRight" ? 1 : -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const dateChips = [
    { d: today, l: `오늘 ${dayLabel(today)}` },
    { d: addDays(today, 1), l: `내일 ${dayLabel(addDays(today, 1))}` },
    { d: addDays(today, 2), l: `모레 ${dayLabel(addDays(today, 2))}` },
  ];
  const custom = !dateChips.some((c) => c.d === checkIn);

  if (group)
    return (
      <GroupEntry
        data={data}
        today={today}
        init={{ platformId, checkIn, nights }}
        onBack={() => setGroup(false)}
        onClose={onClose}
        onSaved={(m) => onSaved(m)}
      />
    );
  if (addGroup && (base?.groupId || soloGid)) {
    const gidAdd = base?.groupId ?? soloGid;
    const members = data.bookings.filter((b) => b.groupId === gidAdd);
    return (
      <GroupAdd
        data={data}
        today={today}
        members={members}
        onClose={() => setAddGroup(false)}
        onSaved={(m) => onSaved(m)}
      />
    );
  }
  return (
    <>
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal book-shell book-two-pane"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <div className="grab" />
        <div className="mh">
          <h2>{isNew ? "상세 예약" : EDIT_COPY}</h2>
          {!isNew && onBoardMove ? (
            <Chip
              sm
              className="edit-room-move"
              onClick={onBoardMove}
              title={`창을 닫고 옮길 빈 방을 눌러요${base?.kind === "stay" && base.nights && base.nights > 1 && req.night && req.night > base.checkIn ? ` · ${dayLabel(req.night)}부터 옮겨요` : ""}`}
            >
              <ArrowRightLeft size={14} /> 객실 이동
            </Chip>
          ) : null}
          {isNew && kind === "stay" ? (
            <BookingModeSeg
              mode="detail"
              onSimple={
                onOpenSimple
                  ? () =>
                      onOpenSimple({
                        kind: "stay",
                        checkIn,
                        nights,
                        platformId,
                        typeId,
                        roomId,
                        guestName: guestName || undefined,
                        guestPhone: guestPhone || undefined,
                        guests,
                        price: Number(price) || undefined,
                      })
                  : undefined
              }
            />
          ) : null}
          <div className="seg">
            <button type="button" className={kind === "stay" ? "on" : ""} onClick={() => setKind("stay")}>
              숙박
            </button>
            <button type="button" className={kind === "dayuse" ? "on" : ""} onClick={pickDayuseKind}>
              대실
            </button>
            {isNew ? (
              <button type="button" onClick={() => setGroup(true)} title="여러 방을 한 번에 (단체·워크숍)">
                단체
              </button>
            ) : null}
          </div>
          {!isActive(draft) ? <span className="cxt big">{status === "noshow" ? "노쇼 처리된" : "취소된"} 예약</span> : null}
          <button type="button" className="x" onClick={onClose}>
            <kbd>Esc</kbd>닫기
          </button>
        </div>
        {base ? (
          <div
            className={`mtop n${
              (isActive(base)
                ? (base.kind === "stay" ? 1 : 0) +
                  (eoNow || eoToday ? 1 : 0) +
                  (canEx ? 1 : 0) +
                  (live && isLongStay(live) && canExtend(live) ? 1 : 0) +
                  (base.groupId ? 1 : 0) +
                  (canAs ? 1 : 0) +
                  (base.kind === "stay" && (isCheckedOut({ checkedOutAt }) || canCheckOut({ ...(live ?? base), checkedOutAt: null }, today)) ? 1 : 0) +
                  (base.kind === "dayuse" && (isCheckedOut({ checkedOutAt }) || canEndDayuse({ ...base, checkedOutAt: null })) ? 1 : 0) +
                  (isActive(draft) ? 2 : 0)
                : 0) +
              (base.kind === "stay" ? 2 : 0) +
              1
            }`}
          >
            {base.kind === "stay" ? (
              <button
                type="button"
                className="beo"
                onClick={() => {
                  void (async () => {
                    if (!(await ensureHotelBizReady(s.hotelBiz, data.hotel!.name))) return;
                    setStayConfirm(true);
                  })();
                }}
                title="숙박확인서 인쇄·PDF"
              >
                <FileText size={17} />
                <b>{STAY_CONFIRM_COPY}</b>
              </button>
            ) : null}
            {base.kind === "stay" ? (
              <button
                type="button"
                className="beo"
                onClick={() => {
                  void (async () => {
                    if (!(await ensureHotelBizReady(s.hotelBiz, data.hotel!.name))) return;
                    setDamageOpen(true);
                  })();
                }}
                title={DAMAGE_COPY.title}
              >
                <AlertTriangle size={17} />
                <b>{DAMAGE_COPY.cta}</b>
              </button>
            ) : null}
            {isActive(base) && base.kind === "stay" && (isCheckedOut({ checkedOutAt }) || canCheckOut({ ...base, checkedOutAt: null }, today)) ? (
              <button
                type="button"
                className={`beo cout ${checkedOutAt ? "on" : ""}`}
                aria-pressed={!!checkedOutAt}
                disabled={coBusy}
                onClick={() => void toggleCheckOut()}
                title="정상 퇴실 · 누르면 바로 저장 · 조기 퇴실과 다름"
              >
                <DoorOpen size={17} />
                <b>{checkedOutAt ? `퇴실처리됨 · ${CHECKOUT_UNDO_CTA}` : "퇴실처리"}</b>
              </button>
            ) : null}
            {isActive(base) && base.kind === "dayuse" && (isCheckedOut({ checkedOutAt }) || canEndDayuse({ ...base, checkedOutAt: null })) ? (
              <button
                type="button"
                className={`beo cout ${checkedOutAt ? "on" : ""}`}
                aria-pressed={!!checkedOutAt}
                disabled={coBusy}
                onClick={() => void toggleCheckOut()}
                title="대실 이용 종료 · 누르면 확인 후 저장 · 숙박 퇴실과 별축"
              >
                <DoorOpen size={17} />
                <b>{checkedOutAt ? `이용 종료됨 · ${CHECKOUT_UNDO_CTA}` : "이용 종료"}</b>
              </button>
            ) : null}
            {isActive(base) && base.kind === "stay" ? (
              <button type="button" className={`beo ncx ${noClean ? "on" : ""}`} aria-pressed={noClean} disabled={ncxBusy} onClick={() => void toggleNoClean()} title="청소하지 않음 · 누르면 바로 저장">
                <b>{noClean ? "청소X · 해제" : "청소X"}</b>
              </button>
            ) : null}
            {base.kind === "stay" ? (
              <button type="button" className="beo" onClick={() => setRecOpen(true)} title="결제·요금·객실 기록을 고치고 되돌려요">
                <b>기록 정정</b>
              </button>
            ) : null}
            {isActive(base) && base.groupId ? (
              <button type="button" className="beo" onClick={() => setAddGroup(true)} title="같은 단체에 방·타입만 멤버를 이어 붙여요">
                <b>단체에 객실 추가</b>
              </button>
            ) : null}
            {isActive(base) && base.kind === "stay" && !base.groupId ? (
              <button
                type="button"
                className="beo"
                disabled={soloBusy}
                title="어떤 객실이든 이 예약에 더해요 · 한 단체로 묶여요"
                onClick={() => {
                  void (async () => {
                    setSoloBusy(true);
                    try {
                      const gid = await data.groupify(base);
                      setSoloGid(gid);
                      setAddGroup(true);
                    } catch (e) {
                      setErr(saveFailMessage(e));
                    } finally {
                      setSoloBusy(false);
                    }
                  })();
                }}
              >
                <b>{soloBusy ? "묶는 중…" : "객실 추가"}</b>
              </button>
            ) : null}
            {isActive(base) && canAs ? (
              <button type="button" className={`beo ${as ? "on" : ""}`} aria-expanded={!!as} onClick={() => (as ? setAs(null) : openAs())}>
                <b>{SURCHARGE_COPY}</b>
              </button>
            ) : null}
            {isActive(base) && canEx ? (
              <button
                type="button"
                className={`beo ${ex ? "on" : ""}`}
                aria-expanded={!!ex}
                onClick={() => {
                  if (ex) {
                    setEx(null);
                    setExOverlap(null);
                  } else openEx();
                }}
              >
                <CalendarPlus size={17} />
                <b>{isLongStay(live ?? base) ? "재고 창 +1박" : EXTEND_COPY}</b>
              </button>
            ) : null}
            {isActive(base) && live && isLongStay(live) && canExtend(live) ? (
              <button type="button" className="beo" disabled={winBusy} onClick={() => void confirmWinExtend()} title="재고 확정 창을 7박 늘리고 원장에 내역을 추가해요">
                <CalendarPlus size={17} />
                <b>{winBusy ? "연장 중…" : `재고 창 +${WINDOW_EXTEND_DEFAULT}`}</b>
              </button>
            ) : null}
            {isActive(base) && eoNow ? (
              <button type="button" className="beo undo" disabled={eoBusy} onClick={() => void undoEo()}>
                <Undo2 size={17} />
                <b>조기 퇴실 되돌리기</b>
              </button>
            ) : isActive(base) && eoToday ? (
              <button type="button" className={`beo ${eo ? "on" : ""}`} aria-expanded={!!eo} onClick={() => (eo ? setEo(null) : openEo())}>
                <DoorOpen size={17} />
                <b>조기 퇴실</b>
              </button>
            ) : null}
            {isActive(draft) ? (
              <>
                <button type="button" className="beo" onClick={() => void save(false, "cancelled")}>
                  <b>취소 처리</b>
                </button>
                <button type="button" className="beo" title="결제한 금액은 매출에 남고, 방·재고는 비워요" onClick={() => void save(false, "noshow")}>
                  <b>노쇼</b>
                </button>
              </>
            ) : null}
            {confirmDel ? (
              <button type="button" className="beo danger" onClick={() => void remove()}>
                <b>정말 삭제할까요?</b>
              </button>
            ) : (
              <button type="button" className="beo danger" onClick={() => setConfirmDel(true)}>
                <b>예약 삭제</b>
              </button>
            )}
          </div>
        ) : null}
        {!isNew && kind === "stay" && !long ? (
          <div className="edit-stay-sum" role="status">
            <div className="edit-stay-sum-main">
              <b>
                {roomId ? `${L.roomLabel(roomId) ?? "?"}호` : "미배정"}
                {guestName.trim() ? ` · ${guestName.trim()}` : base?.guestName ? ` · ${base.guestName}` : ""}
              </b>
              <span>
                {md(checkIn)} → {md(checkOutDate)} · {nights}박
              </span>
            </div>
            <p className="muted sm edit-stay-sum-hint">
              날짜·박수는 아래에서 고친 뒤 저장해요
              {canEx ? ` · 하룻밤만 더 = 「${EXTEND_COPY}」` : ""}
            </p>
          </div>
        ) : null}
        {eoNow && live ? (
          <div className="eoline">
            <DoorOpen size={15} />
            <b>{dayLabel(live.earlyOut!)} 조기 퇴실</b>
            <span>
              {usedLabel(live)} · {dayLabel(live.earlyOut!)}부터 방이 비었어요
              {live.refund
                ? ` · 환불 ${won(live.refund)}원`
                : (() => {
                    const kept = data.stayCredits.find(
                      (c) => c.sourceBookingId === live.id && c.status !== "void",
                    );
                    return kept
                      ? ` · ${STAY_CREDIT_COPY.keep} ${won(kept.amountOriginal)}원${kept.amountRemaining < kept.amountOriginal ? ` (잔액 ${won(kept.amountRemaining)})` : ""}`
                      : " · 환불 없음";
                  })()}
            </span>
          </div>
        ) : null}
        {as && live ? (
          <div className="eoc" role="group" aria-label={SURCHARGE_COPY} ref={eocRef}>
            <div className="eoc-h">
              <b>
                {SURCHARGE_COPY}
                {as.reason !== "other" && as.hours >= 1 ? ` · ${as.hours}시간 → 퇴실 ${outTimeOf(s, { lateOut: as.hours })}` : ""}
              </b>
              <span>
                같은 날 할증·시간료예요 · 박수·다음 밤은 그대로예요
                {L.roomLabel(live.roomId) ? ` · ${L.roomLabel(live.roomId)}호` : ""}
                {canEx ? ` · 밤을 늘리려면 「${EXTEND_COPY}」` : ""}
              </span>
            </div>
            <div className="eoc-d">
              <label>사유</label>
              <div className="chips">
                {SURCHARGE_REASONS.map((r) => (
                  <button
                    type="button"
                    key={r}
                    className={`chip ${as.reason === r ? "on" : ""}`}
                    onClick={() => {
                      const hours =
                        r === "other"
                          ? 0
                          : r === "late_fee"
                            ? Math.max(1, suggestElapsedLateHours(s.stayTimes.checkOut, hotelWallClock().time) || as.hours || 1)
                            : Math.max(1, as.hours || 1);
                      const amount =
                        r === "other" ? as.amount : String(defaultSurchargeAmount(s.extraHourFee, hours));
                      setAs({ ...as, reason: r, hours, amount });
                    }}
                  >
                    {SURCHARGE_REASON_LABEL[r]}
                  </button>
                ))}
              </div>
            </div>
            {as.reason !== "other" ? (
              <div className="eoc-d">
                <label>시간</label>
                <div className="chips" style={{ alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    className="chip"
                    aria-label="1시간 줄이기"
                    disabled={as.hours <= (as.reason === "late_out" ? 1 : 0)}
                    onClick={() => {
                      const hours = Math.max(as.reason === "late_out" ? 1 : 0, as.hours - 1);
                      setAs({ ...as, hours, amount: String(defaultSurchargeAmount(s.extraHourFee, hours)) });
                    }}
                  >
                    <Minus size={14} />
                  </button>
                  <b>{as.hours ? `${as.hours}시간` : "없음"}</b>
                  <button
                    type="button"
                    className="chip"
                    aria-label="1시간 늘리기"
                    disabled={as.hours >= EXTRA_HOURS_MAX}
                    onClick={() => {
                      const hours = Math.min(EXTRA_HOURS_MAX, as.hours + 1);
                      setAs({ ...as, hours, amount: String(defaultSurchargeAmount(s.extraHourFee, hours)) });
                    }}
                  >
                    <Plus size={14} />
                  </button>
                  <span className="muted sm">퇴실 {outTimeOf(s, { lateOut: as.hours })} · 1시간 {won(s.extraHourFee)}원</span>
                </div>
              </div>
            ) : null}
            <div className="eoc-r">
              <label htmlFor="as-amount">금액</label>
              <label className="inp price">
                <input
                  id="as-amount"
                  className="num"
                  inputMode="numeric"
                  value={as.amount ? Number(as.amount).toLocaleString("ko-KR") : ""}
                  onChange={(e) => setAs({ ...as, amount: e.target.value.replace(/\D/g, "").slice(0, 9) })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void confirmAs();
                    }
                  }}
                />
                원
              </label>
              <small>
                저장 후 판매 {won(live.price + Number(as.amount || 0))}원
                {Number(as.amount || 0) === 0 ? " · 0원이면 기록만 (수납 없음)" : ""}
              </small>
            </div>
            <div className="eoc-r">
              <label htmlFor="as-memo">메모{as.reason === "other" ? " *" : ""}</label>
              <input
                id="as-memo"
                className="inp"
                maxLength={80}
                placeholder={as.reason === "other" ? "미니바 · 파손 등 (필수)" : "합의 15시까지 · 14시 무단 (선택)"}
                value={as.memo}
                onChange={(e) => setAs({ ...as, memo: e.target.value })}
              />
            </div>
            {Number(as.amount || 0) > 0 ? (
              <>
                <div className="eoc-d">
                  <label>수납</label>
                  <div className="chips">
                    <button type="button" className={`chip ${as.collect ? "on" : ""}`} onClick={() => setAs({ ...as, collect: true })}>
                      즉시 수납
                    </button>
                    <button type="button" className={`chip ${!as.collect ? "on" : ""}`} onClick={() => setAs({ ...as, collect: false })}>
                      후불
                    </button>
                  </div>
                </div>
                {as.collect ? (
                  <div className="eoc-d">
                    <label>방법</label>
                    <div className="chips">
                      {BOOK_PAY_METHODS.map((m) => (
                        <button type="button" key={m} className={`chip ${as.method === m ? "on" : ""}`} onClick={() => setAs({ ...as, method: m })}>
                          {BOOK_PAY_LABEL[m]}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="muted sm" style={{ marginTop: -4 }}>
                    판매가만 올리고 후불이 생겨요 · 가격만 조용히 올리는 경로는 없어요
                  </div>
                )}
              </>
            ) : (
              <div className="muted sm">0원 · 사유·늦은 퇴실만 기록해요</div>
            )}
            {asErr ? <div className="ferr">{asErr}</div> : null}
            <div className="eoc-a">
              <button type="button" className="btn" onClick={() => setAs(null)}>
                취소
              </button>
              <button type="button" className="btn dark" disabled={asBusy} onClick={() => void confirmAs()}>
                {asBusy ? "저장 중…" : Number(as.amount || 0) > 0 && as.collect ? "즉시 수납" : "확정"}
              </button>
            </div>
          </div>
        ) : null}
        {ex && live ? (
          <div className="eoc" role="group" aria-label={isLongStay(live) ? "재고 창 +1박" : EXTEND_COPY} ref={eocRef}>
            <div className="eoc-h">
              <b>
                {isLongStay(live) ? "재고 창 +1박" : EXTEND_COPY} · {(live.nights ?? 0) + 1}박
                {isLongStay(live)
                  ? ` · 판매 보류 끝 ${dayLabel(addDays(live.checkIn, (live.nights ?? 0) + 1))}`
                  : ` · ${dayLabel(addDays(live.checkIn, (live.nights ?? 0) + 1))} 퇴실`}
              </b>
              <span>
                {isLongStay(live)
                  ? "원장에 그날 단가를 쌓고 재고 창을 하루 늘려요 · 미수는 「미수금 수납」으로"
                  : "판매 가격에 오늘 요금을 더하고, 즉시 수납하거나 후불로 처리해요"}
                {L.roomLabel(live.roomId) ? ` · ${L.roomLabel(live.roomId)}호` : ""}
              </span>
            </div>
            {!isLongStay(live) ? (
              <>
                <div className="eoc-r">
                  <label htmlFor="ex-rate">오늘 요금</label>
                  <label className="inp price">
                    <input
                      id="ex-rate"
                      className="num"
                      inputMode="numeric"
                      value={ex.rate ? Number(ex.rate).toLocaleString("ko-KR") : ""}
                      onChange={(e) => setEx({ ...ex, rate: e.target.value.replace(/\D/g, "").slice(0, 9) })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void confirmEx();
                        }
                      }}
                    />
                    원
                  </label>
                  <small>
                    기본 {won(nightRate(live, groupRates?.[live.typeId]))}원
                    {groupRates?.[live.typeId] ? " · 단체 타입 요금" : (live.nights ?? 0) > 1 ? " · 1박 평균" : " · 현재 판매가"} · 저장 후 판매{" "}
                    {won(live.price + Number(ex.rate || 0))}원
                  </small>
                </div>
                <div className="eoc-d">
                  <label>수납</label>
                  <div className="chips">
                    <button type="button" className={`chip ${ex.collect ? "on" : ""}`} onClick={() => setEx({ ...ex, collect: true })}>
                      즉시 수납
                    </button>
                    <button type="button" className={`chip ${!ex.collect ? "on" : ""}`} onClick={() => setEx({ ...ex, collect: false })}>
                      후불
                    </button>
                  </div>
                </div>
                {ex.collect ? (
                  <div className="eoc-d">
                    <label>방법</label>
                    <div className="chips">
                      {BOOK_PAY_METHODS.map((m) => (
                        <button type="button" key={m} className={`chip ${ex.method === m ? "on" : ""}`} onClick={() => setEx({ ...ex, method: m })}>
                          {BOOK_PAY_LABEL[m]}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="muted sm" style={{ marginTop: -4 }}>
                    가격만 인상하고 후불(미수금)이 생겨요 · 나중에 「수납」으로 등록해요
                  </div>
                )}
              </>
            ) : (
              <div className="muted sm">
                단가 {won(Number(ex.rate || 0))}원/박 · 저장 후 청구 합계 {won((live.charges ?? []).reduce((n, c) => n + c.amount, 0) + Number(ex.rate || 0))}원
              </div>
            )}
            {exErr ? <div className="ferr">{exErr}</div> : null}
            <div className="eoc-a">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setEx(null);
                  setExOverlap(null);
                }}
              >
                닫기
              </button>
              <button type="button" className="btn dark" disabled={exBusy} onClick={() => void confirmEx()}>
                {exBusy ? "저장 중…" : isLongStay(live) ? "재고 창 +1박" : EXTEND_COPY}
              </button>
            </div>
          </div>
        ) : null}
        {eo && live ? (
          <div className="eoc" role="group" aria-label="조기 퇴실" ref={eocRef}>
            <div className="eoc-h">
              <b>
                {eo.date === today ? "오늘 퇴실" : `${dayLabel(eo.date)} 퇴실`} · {live.nights}박 중 {daysBetween(live.checkIn, eo.date)}박 이용
              </b>
              <span>
                {dayLabel(eo.date)}부터 {live.nights! - daysBetween(live.checkIn, eo.date)}박은 바로 빈 방이 돼요
                {L.roomLabel(roomOnNight(live, eo.date) ?? null) ? ` (${L.roomLabel(roomOnNight(live, eo.date) ?? null)}호)` : ""}
              </span>
            </div>
            {earlyOutDates(live).length > 1 || eo.date !== today ? (
              <div className="eoc-d">
                <label>퇴실한 날</label>
                {earlyOutDates(live).length <= 6 ? (
                  <div className="chips">
                    {earlyOutDates(live).map((d) => (
                      <button
                        type="button"
                        key={d}
                        className={`chip ${eo.date === d ? "on" : ""}`}
                        onClick={() => {
                          const sug = unusedNightRefund(live, d, groupRates?.[live.typeId]);
                          const keep = defaultKeepAmount(live, d, groupRates?.[live.typeId]);
                          setEo({
                            ...eo,
                            date: d,
                            refund: sug > 0 ? String(sug) : "",
                            keepAmount: keep > 0 ? String(keep) : "",
                          });
                        }}
                      >
                        {d === today ? `오늘 ${dayLabel(d)}` : dayLabel(d)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <select
                    className="inp"
                    value={eo.date}
                    onChange={(e) => {
                      const d = e.target.value;
                      const sug = unusedNightRefund(live, d, groupRates?.[live.typeId]);
                      const keep = defaultKeepAmount(live, d, groupRates?.[live.typeId]);
                      setEo({
                        ...eo,
                        date: d,
                        refund: sug > 0 ? String(sug) : "",
                        keepAmount: keep > 0 ? String(keep) : "",
                      });
                    }}
                  >
                    {earlyOutDates(live).map((d) => (
                      <option key={d} value={d}>
                        {d === today ? `오늘 ${dayLabel(d)}` : dayLabel(d)} · {daysBetween(live.checkIn, d)}박 이용
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : null}
            <div className="eoc-d">
              <label>잔액</label>
              <div className="chips">
                <button
                  type="button"
                  className={`chip ${eo.disposition === "keep" ? "on" : ""}`}
                  disabled={!isOnsite(L.plats.get(live.platformId))}
                  title={
                    isOnsite(L.plats.get(live.platformId))
                      ? undefined
                      : "현장·전화 수납만 잔액 보관 (OTA는 채널 환불)"
                  }
                  onClick={() => setEo({ ...eo, disposition: "keep" })}
                >
                  {STAY_CREDIT_COPY.keep}
                </button>
                <button
                  type="button"
                  className={`chip ${eo.disposition === "refund" ? "on" : ""}`}
                  onClick={() => setEo({ ...eo, disposition: "refund" })}
                >
                  현금 환불
                </button>
                <button
                  type="button"
                  className={`chip ${eo.disposition === "none" ? "on" : ""}`}
                  onClick={() => setEo({ ...eo, disposition: "none" })}
                >
                  없음
                </button>
              </div>
            </div>
            {eo.disposition === "refund" ? (
              <div className="eoc-r">
                <label htmlFor="eo-refund">환불 금액</label>
                <label className="inp price">
                  <input
                    id="eo-refund"
                    className="num"
                    inputMode="numeric"
                    placeholder="없으면 비워 두세요"
                    value={eo.refund ? Number(eo.refund).toLocaleString("ko-KR") : ""}
                    onChange={(e) => setEo({ ...eo, refund: e.target.value.replace(/\D/g, "").slice(0, 9) })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void confirmEo();
                      }
                    }}
                  />
                  원
                </label>
                <small>
                  미사용 {live.nights! - daysBetween(live.checkIn, eo.date)}박 × 단가 제안 · 결제 {won(live.price)}원 → 매출{" "}
                  {won(Math.max(0, live.price - (Number(eo.refund) || 0)))}원
                </small>
              </div>
            ) : null}
            {eo.disposition === "keep" ? (
              <>
                <div className="eoc-r">
                  <label htmlFor="eo-keep">{STAY_CREDIT_COPY.keep} 금액</label>
                  <label className="inp price">
                    <input
                      id="eo-keep"
                      className="num"
                      inputMode="numeric"
                      value={eo.keepAmount ? Number(eo.keepAmount).toLocaleString("ko-KR") : ""}
                      onChange={(e) => setEo({ ...eo, keepAmount: e.target.value.replace(/\D/g, "").slice(0, 9) })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void confirmEo();
                        }
                      }}
                    />
                    원
                  </label>
                  <small>
                    기본 = 수납액 {won(paidOf(live))} − 이용분 · 수정 가능 · 현금 환불과 별개
                  </small>
                </div>
                <div className="eoc-r">
                  <label htmlFor="eo-pref">{STAY_CREDIT_COPY.preferredDate}</label>
                  <input
                    id="eo-pref"
                    className="inp"
                    type="date"
                    value={eo.preferredDate}
                    min={today}
                    onChange={(e) => setEo({ ...eo, preferredDate: e.target.value })}
                  />
                  <small>재고 홀드 아님 · 다음에 오실 날짜 메모</small>
                </div>
                <div className="eoc-r">
                  <label htmlFor="eo-keep-note">메모</label>
                  <input
                    id="eo-keep-note"
                    className="inp"
                    maxLength={200}
                    placeholder="선택"
                    value={eo.note}
                    onChange={(e) => setEo({ ...eo, note: e.target.value })}
                  />
                </div>
              </>
            ) : null}
            {eo.disposition === "none" ? (
              <div className="muted sm">환불·보관 없이 조기 퇴실만 해요 · 방은 비워요</div>
            ) : null}
            {eoErr ? <div className="ferr">{eoErr}</div> : null}
            <div className="eoc-a">
              <button type="button" className="btn" onClick={() => setEo(null)}>
                닫기
              </button>
              <button type="button" className="btn dark" disabled={eoBusy} onClick={() => void confirmEo()}>
                {eoBusy
                  ? "저장 중…"
                  : eo.disposition === "keep"
                    ? `${STAY_CREDIT_COPY.keep} · 조기 퇴실`
                    : "조기 퇴실"}
              </button>
            </div>
          </div>
        ) : null}
        {inErr ? <div className="ferr mtop-err">{inErr}</div> : null}

        <div className="book-panes">
          <div className={`book-pane-left${leftPaneOpen ? "" : " is-collapsed"}`}>
            <button
              type="button"
              className="book-pane-toggle"
              aria-expanded={leftPaneOpen}
              onClick={() => setLeftPaneOpen((o) => !o)}
            >
              <span className="book-pane-toggle-sum">{leftPaneSummary}</span>
              <span className="book-pane-toggle-act">{leftPaneOpen ? "접기" : "날짜·객실"}</span>
            </button>
            <div className="book-pane-left-body">

        {/* 신규 숙박·대실: 타입 줄은 호실 MiniFloorPlan 위(Option D) · 숙박 수정만 여기 유지 */}
        {!(isNew && kind === "stay") && kind !== "dayuse" ? (
          <div className="fld">
            <label>
              객실 타입<em>*</em>
            </label>
            <div className="payb">
              {kind === "stay" ? <div className="muted sm">호텔 전체 잔여 재고 (미배정도 차감)</div> : null}
              <div className="chips scroll">
                {pickTypes.map((t, k) => {
                  const r = minRemain(t.id);
                  const lv = stockLevel(r, totals.get(t.id) ?? 0, s.lowThreshold);
                  return (
                    <button type="button" key={t.id} className={`tchip ${t.id === typeId ? "on" : ""}`} onClick={() => setTypeId(t.id)} title={kind === "stay" ? `${t.name} · 선택 기간 최소 잔여 ${r}` : t.name}>
                      <span className="t1">
                        <TypeBadge t={t} />
                      </span>
                      {kind === "stay" ? (
                        <span className={`t2 ${lv === "full" || lv === "over" ? "full" : ""}`}>
                          잔여 <b className={r <= 0 ? "tred" : ""}>{r < 0 ? `−${-r}` : r}</b>
                          {k < 9 ? <span className="kk"> · {TYPE_LABEL[k]}</span> : null}
                        </span>
                      ) : k < 9 ? (
                        <span className="t2 kk">{TYPE_LABEL[k]}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {kind === "stay" && minRemain(typeId) <= 0 ? (
                <div className={`muted sm ${minRemain(typeId) < 0 ? "tred" : ""}`}>
                  {minRemain(typeId) < 0
                    ? "이 타입은 이미 오버부킹이에요. 저장은 가능하지만 「재고」에 빨강으로 남아요."
                    : "이 타입은 만실이에요. 저장하면 오버부킹 경고가 나와요."}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {kind === "dayuse" ? (
          <div className="fld">
            <label>
              입실 날짜<em>*</em>
            </label>
            <div className="chips scroll">
              {dateChips.map((c) => (
                <button type="button" key={c.d} className={`chip ${checkIn === c.d ? "on" : ""}`} onClick={() => setCheckIn(c.d)}>
                  {c.l}
                </button>
              ))}
              <label className={`chip datechip ${custom ? "on" : ""}`}>
                <CalendarDays size={15} />
                <span className="dl">{custom ? dayLabel(checkIn) : "날짜 고르기"}</span>
                <input
                  ref={dateRef}
                  type="date"
                  min="2020-01-01"
                  max="2099-12-31"
                  value={checkIn}
                  onChange={(e) => e.target.value && setCheckIn(e.target.value)}
                  onClick={(e) => openPicker(e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openPicker(e.currentTarget);
                    }
                  }}
                  aria-label="입실"
                  title="눌러서 달력에서 고르거나, 숫자로 바로 입력해도 돼요"
                />
              </label>
            </div>
          </div>
        ) : null}

        {kind === "stay" ? (
          <>
            <div className="fld">
              <label>
                숙박 유형<em>*</em>
              </label>
              <ChipGroup>
                <Chip
                  active={!long}
                  aria-pressed={!long}
                  onClick={() => {
                    setStayMode("standard");
                    if (nights === LONG_STAY_WINDOW_DEFAULT && isNew) setStayNights(1);
                  }}
                >
                  일반
                </Chip>
                <Chip
                  active={long}
                  aria-pressed={long}
                  onClick={() => {
                    setStayMode("long_stay");
                    setStayTab("period");
                    if (isNew && nights < LONG_STAY_WINDOW_DEFAULT) setStayNights(LONG_STAY_WINDOW_DEFAULT);
                    if (!flatAmt) setFlatAmt("80000");
                  }}
                >
                  장기(퇴실 미정)
                </Chip>
              </ChipGroup>
            </div>
            {stayDateUx === "period-tabs" ? (
              <div className="fld">
                <label>기간 수정</label>
                <div>
                  <div className="seg wide staytabs" role="tablist" aria-label="숙박 기간 입력 방식">
                    <button type="button" role="tab" aria-selected={stayTab === "period"} className={stayTab === "period" ? "on" : ""} onClick={() => setStayTab("period")}>
                      기간 입력
                    </button>
                    <button type="button" role="tab" aria-selected={stayTab === "paint"} className={stayTab === "paint" ? "on" : ""} onClick={() => setStayTab("paint")}>
                      날짜 선택
                    </button>
                  </div>
                  <div className="muted sm" style={{ marginTop: 6 }}>
                    입실·퇴실·박수를 바꾸면 저장 시 반영돼요
                    {canEx ? ` · 「${EXTEND_COPY}」과 다름` : ""}
                  </div>
                </div>
              </div>
            ) : null}
            {!long ? (
              <div className="fld">
                <label>이용 기간</label>
                <OpenStayToggle
                  on={openOn}
                  hold={openHold}
                  onChange={(on, h) => {
                    setOpenOn(on);
                    setOpenHold(h);
                    if (on && isNew) applyStayNights(openStayNights(checkIn, today, h));
                  }}
                />
              </div>
            ) : null}
            {showNightPick ? (
              <div className="fld">
                {stayDateUx === "night-pick" ? <label>이용 날짜</label> : null}
                <NightPickCalendar
                  checkIn={checkIn}
                  nights={nights}
                  bookings={data.bookings}
                  roomId={roomId}
                  excludeId={base?.id ?? "__draft__"}
                  today={today}
                  onPick={(cin, n) => applyStayNights(isNew && openOn ? openStayNights(cin, today, openHold) : n, { checkIn: cin })}
                  onBlocked={() => notify("이미 예약된 밤이에요 · 연속된 빈 밤만 고를 수 있어요")}
                  nightAmounts={nightRates?.nights ?? null}
                  onEditNight={editNightAmount}
                />
              </div>
            ) : (
              <>
                <div className="fld">
                  <label>
                    입실<em>*</em>
                  </label>
                  <div className="chips scroll">
                    {dateChips.map((c) => (
                      <button type="button" key={c.d} className={`chip ${checkIn === c.d ? "on" : ""}`} onClick={() => setStayCheckIn(c.d)}>
                        {c.l}
                      </button>
                    ))}
                    <label className={`chip datechip ${custom ? "on" : ""}`}>
                      <CalendarDays size={15} />
                      <span className="dl">{custom ? dayLabel(checkIn) : "날짜 고르기"}</span>
                      <input
                        ref={dateRef}
                        type="date"
                        min="2020-01-01"
                        max="2099-12-31"
                        value={checkIn}
                        onChange={(e) => e.target.value && setStayCheckIn(e.target.value)}
                        onClick={(e) => openPicker(e.currentTarget)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openPicker(e.currentTarget);
                          }
                        }}
                        aria-label="입실"
                        title="눌러서 달력에서 고르거나, 숫자로 바로 입력해도 돼요"
                      />
                    </label>
                  </div>
                </div>
                {long ? (
                  <div className="fld">
                    <label>퇴실</label>
                    <div className="step stayio">
                      <span className="chip datechip on muted" aria-label="퇴실 미정">
                        퇴실 미정
                      </span>
                      <span className="rng">손님 약속 퇴실 없음 · 아래 재고 창까지만 방을 막아 둬요</span>
                    </div>
                  </div>
                ) : (
                  <div className="fld">
                    <label>
                      퇴실<em>*</em>
                    </label>
                    <div className="step stayio">
                      <label className="chip datechip on">
                        <CalendarDays size={15} />
                        <span className="dl">{dayLabel(checkOutDate)}</span>
                        <input
                          type="date"
                          min={addDays(checkIn, 1)}
                          max={addDays(checkIn, STAY_NIGHTS_MAX)}
                          value={checkOutDate}
                          onChange={(e) => e.target.value && setStayCheckOut(e.target.value)}
                          onClick={(e) => openPicker(e.currentTarget)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openPicker(e.currentTarget);
                            }
                          }}
                          aria-label="퇴실"
                          title="퇴실일을 고르면 박수가 맞춰져요"
                        />
                      </label>
                      <span className="rng">
                        <b>
                          {dayLabel(checkOutDate)} {outTimeOf(s, { earlyIn, lateOut })}
                        </b>{" "}
                        퇴실 · 퇴실날은 다시 팔 수 있어요
                      </span>
                    </div>
                  </div>
                )}
                <div className="fld">
                  <label>
                    {long ? "재고 창" : "박수"}
                    <em>*</em>
                  </label>
                  <div className="step">
                    <button type="button" className="sb" aria-label="1박 줄이기" onClick={() => setStayNights(nights - 1)}>
                      <Minus size={16} />
                    </button>
                    <span className="sv">
                      {nights}
                      <small>박</small>
                    </span>
                    <button type="button" className="sb" aria-label="1박 늘리기" onClick={() => setStayNights(nights + 1)}>
                      <Plus size={16} />
                    </button>
                    <span
                      className="rng stayglance"
                      aria-label={long ? `재고 창 ${nights}박 · 판매 보류 끝 ${dayLabel(checkOutDate)}` : `입실 ${dayLabel(checkIn)} 퇴실 ${dayLabel(checkOutDate)} ${nights}박`}
                    >
                      {long ? (
                        <>
                          판매 보류 끝 <b>{dayLabel(checkOutDate)}</b> · 손님 약속이 아니라 이 밤까지 방을 막아요
                        </>
                      ) : (
                        <>
                          <b>{dayLabel(checkIn)}</b> 입실 → <b>{dayLabel(checkOutDate)}</b> 퇴실 · <b>{nights}박</b>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              </>
            )}
            {long ? (
              <>
                <div className="fld">
                  <label>
                    요금표<em>*</em>
                  </label>
                  <div className="step">
                    <span className="chip on">매일 동일</span>
                    <label className="inp price sm">
                      <input
                        className="num"
                        inputMode="numeric"
                        aria-label="매일 단가"
                        placeholder="80000"
                        value={flatAmt ? won(Number(flatAmt)) : ""}
                        onChange={(e) => setFlatAmt(e.target.value.replace(/\D/g, "").slice(0, 9))}
                      />
                      원/박
                    </label>
                  </div>
                  <div className="muted sm" style={{ marginTop: 6 }}>
                    요일별 단가는 다음에 · 지금은 매일 같은 금액
                  </div>
                </div>
                <div className="fld">
                  <label>정산</label>
                  <div className="chips">
                    <button type="button" className={`chip ${settleCycle === "weekly" ? "on" : ""}`} onClick={() => setSettleCycle("weekly")}>
                      주간
                    </button>
                    <button type="button" className={`chip ${settleCycle === "adhoc" ? "on" : ""}`} onClick={() => setSettleCycle("adhoc")}>
                      수시만
                    </button>
                  </div>
                  <div className="muted sm" style={{ marginTop: 6 }}>
                    {settleHint(settleCycle, payLeft)}
                  </div>
                </div>
              </>
            ) : null}
            {base && !long && nightsChangedWithoutPrice(base, draftBase) ? (
              <div className="nwarn" role="status">
                <AlertTriangle size={16} />
                <span>
                  박수가 늘었는데 판매 가격은 그대로예요. 아래 총액을 수정해 주세요
                  {canEx ? ` · 하룻밤만 더하려면 「${EXTEND_COPY}」` : ""}.
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <div className="fld">
            <label>
              이용 시간<em>*</em>
            </label>
            <div className="times">
              <span className="tbox">
                <input
                  ref={startRef}
                  className="inp num tm-in"
                  inputMode="numeric"
                  placeholder="13:30"
                  maxLength={10}
                  value={startRaw}
                  onChange={(e) => setStartRaw(e.target.value)}
                  onBlur={() => startTime && setStartRaw(startTime)}
                  aria-label="시작 시간"
                  title="1330처럼 숫자만 입력해도 돼요"
                />
                <TimePick value={startTime} label="시작 시간 고르기" onPick={(v) => setStartRaw(v)} />
              </span>
              <span className="tilde">~</span>
              <span className="tbox">
                <input
                  className={`inp num tm-in ${dur != null ? "auto" : ""}`}
                  inputMode="numeric"
                  placeholder="15:30"
                  maxLength={10}
                  value={dur != null ? endTime : endRaw}
                  onChange={(e) => {
                    setDur(null);
                    setEndRaw(e.target.value);
                  }}
                  onBlur={() => dur == null && parseTime(endRaw) && setEndRaw(parseTime(endRaw))}
                  aria-label="끝 시간"
                />
                <TimePick
                  value={endTime}
                  label="끝 시간 고르기"
                  onPick={(v) => {
                    setDur(null);
                    setEndRaw(v);
                  }}
                />
              </span>
            </div>
            <div className="chips durs">
              {DURATIONS.map((h) => (
                <button
                  type="button"
                  key={h}
                  className={`chip sm ${dur === h ? "on" : ""}`}
                  aria-pressed={dur === h}
                  onClick={() => {
                    if (dur === h) {
                      setDur(null);
                      setEndRaw(endTime);
                      return;
                    }
                    if (!startTime)
                      setStartRaw(s.dayuseDefaults.startTime || (checkIn === today ? nowRounded() : ""));
                    setDur(h);
                    if (!startTime && checkIn !== today) startRef.current?.focus();
                  }}
                >
                  {h}시간
                </button>
              ))}
            </div>
            <div className={`trange ${useMin ? "" : "empty"}`}>
              {useMin ? (
                <>
                  <b>
                    {startTime} ~ {endTime}
                  </b>
                  {useMin + Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)) > 1440 ? <span className="nd">다음날</span> : null}
                  <span> · {durLabel(useMin)} 이용</span>
                </>
              ) : startRaw && !startTime ? (
                <span className="bad">시작 시간을 알아볼 수 없어요. 예: 13:30 또는 1330</span>
              ) : endRaw && dur == null && !parseTime(endRaw) ? (
                <span className="bad">끝 시간을 알아볼 수 없어요. 예: 15:30</span>
              ) : (
                <span>시작 시간을 입력하고 이용 시간을 누르면 끝 시간이 저절로 들어가요</span>
              )}
            </div>
          </div>
        )}

        {/* selection-first: 선택 호실 수정 = 고정 표시 · MiniFloorPlan 금지 */}
        {!isNew && kind === "stay" && roomId ? (
          <div className="fld">
            <label>{moved ? "첫 방" : "호실"}</label>
            <div className="edit-room-fixed">
              <b>{L.roomLabel(roomId) ?? "?"}호</b>
              <span className="muted sm">
                {typeLabel(L.types.get(typeId)) || "타입"}
                {" · "}객실 이동은 제목 옆 또는 운영패널
              </span>
            </div>
          </div>
        ) : (
          <div className="fld">
            <label>{moved ? "첫 방" : "호실"}</label>
            <div className="mfp-wrap">
              {/* 신규·대실·미배정 수정: MiniFloorPlan OK */}
              {(isNew && kind === "stay") || kind === "dayuse" ? (
                <div className="mfp-types">
                  <div className="muted sm">{kind === "stay" ? "타입 · 잔여 수" : "타입"}</div>
                  <div className="chips scroll">
                    {pickTypes.map((t, k) => {
                      const r = minRemain(t.id);
                      const lv = stockLevel(r, totals.get(t.id) ?? 0, s.lowThreshold);
                      return (
                        <button
                          type="button"
                          key={t.id}
                          className={`tchip ${t.id === typeId ? "on" : ""}`}
                          onClick={() => setTypeId(t.id)}
                          title={kind === "stay" ? `${t.name} · 선택 기간 최소 잔여 ${r}` : t.name}
                        >
                          <span className="t1">
                            <TypeBadge t={t} />
                          </span>
                          {kind === "stay" ? (
                            <span className={`t2 ${lv === "full" || lv === "over" ? "full" : ""}`}>
                              잔여 <b className={r <= 0 ? "tred" : ""}>{r < 0 ? `−${-r}` : r}</b>
                              {k < 9 ? <span className="kk"> · {TYPE_LABEL[k]}</span> : null}
                            </span>
                          ) : k < 9 ? (
                            <span className="t2 kk">{TYPE_LABEL[k]}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  {kind === "stay" && minRemain(typeId) <= 0 ? (
                    <div className={`muted sm ${minRemain(typeId) < 0 ? "tred" : ""}`}>
                      {minRemain(typeId) < 0
                        ? "이 타입은 이미 오버부킹이에요. 저장은 가능하지만 「재고」에 빨강으로 남아요."
                        : "이 타입은 만실이에요. 저장하면 오버부킹 경고가 나와요."}
                    </div>
                  ) : null}
                </div>
              ) : kind === "stay" ? (
                <button
                  type="button"
                  className={`rchip lt ${roomId === null ? "on" : ""}`}
                  onClick={() => pickRoom(null)}
                  title="간단 예약 · 호실 미정 · 타입×밤 재고만 차감 (임시 배치 아님)"
                >
                  간단 예약
                </button>
              ) : null}
              <MiniFloorPlan
                s={s}
                L={L}
                free={free}
                selectedIds={roomId ? [roomId, ...extraRooms] : []}
                allowBusy={multiPick}
                candidateTypeIds={typeId ? [typeId] : []}
                buildingFilter={buildingFilter}
                onBuildingFilter={setBuildingFilter}
                onToggle={toggleFloorRoom}
              />
              {multiPick && roomId ? (
                <RoomClashNote
                  data={data}
                  today={today}
                  picked={[roomId, ...extraRooms]}
                  checkIn={checkIn}
                  nights={nights}
                  onSwap={(from, to) => {
                    if (from === roomId) setRoomId(to);
                    else setExtraRooms((x) => x.map((y) => (y === from ? to : y)));
                  }}
                />
              ) : null}
              <div className="muted sm mfp-sum">
                {roomId
                  ? `${[roomId, ...extraRooms].map((r) => `${L.roomLabel(r) ?? "?"}호`).join(" · ")}${extraRooms.length ? ` · ${extraRooms.length + 1}실 한 예약(단체)으로 묶어요` : ""}`
                  : kind === "dayuse"
                    ? "배치도에서 호실을 골라 주세요"
                    : !isNew && kind === "stay"
                      ? "미배정 · 「현황」에서 호실 정하기"
                      : typeId
                        ? "호실 없이 미배정 저장 가능 · 또는 하늘색 칸에서 지정"
                        : "타입을 고르거나 배치도에서 호실을 지정"}
              </div>
            </div>
          </div>
        )}


            </div>
          </div>
          <div className="book-pane-right">

        <div className="fld">
          <label>
            플랫폼<em>*</em>
          </label>
          <ChipGroup scroll>
            {s.platforms.map((pl, k) => (
              <Chip
                key={pl.id}
                active={pl.id === platformId}
                onClick={() => {
                  setPlatformId(pl.id);
                  // Mobile: collapse 날짜·객실 after pick so guest/cost pane is primary
                  if (typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches) {
                    setLeftPaneOpen(false);
                  }
                }}
              >
                <PlatBadge p={pl} />
                {pl.name}
                {k < 9 ? <i>{k + 1}</i> : null}
              </Chip>
            ))}
          </ChipGroup>
        </div>

        <div className="fld">
          <label>
            이름<em>*</em> · 연락처{phoneRequired ? <em>*</em> : null}
          </label>
          {/* value col only — GuestNamePhone as .fld sibling put .two under the 86px label */}
          <div className="payb">
            <GuestNamePhone
              nameRef={nameRef}
              name={guestName}
              phone={guestPhone}
              onName={setName}
              onPhone={setPhone}
              phoneRequired={phoneRequired}
            />
            {isNew && kind === "stay" ? (
              <div className="muted sm">바로입실 시 이름·연락처 비워도 돼요 · 호실 필수</div>
            ) : !isNew && !phoneRequired && isOnsite(curPlat) ? (
              <div className="muted sm">바로입실 예약 · 연락처는 비워도 돼요</div>
            ) : null}
          </div>
        </div>

        <div className="fld">
          <label htmlFor="entry-company">회사명</label>
          <div className="payb">
            <input
              id="entry-company"
              className="inp"
              value={company}
              maxLength={60}
              placeholder="선택 · 예: 오서건설 (객실 카드에 보여요)"
              onChange={(e) => setCompany(e.target.value)}
              aria-label="회사명"
            />
            {base?.groupId && !company.trim() ? <div className="muted sm">비워 두면 단체 회사명이 카드에 보여요</div> : null}
          </div>
        </div>

        <div className="fld gfld">
          <label>인원</label>
          <div className="payb">
            <Stepper
              value={guests}
              min={1}
              max={GUESTS_MAX}
              onChange={(n) => {
                gTouched.current = true;
                setGuests(n);
              }}
            >
              <span className="rng">
                {sur.over ? (
                  <span className="gline warn">최대 {sur.max}명을 넘었어요 · 저장은 돼요</span>
                ) : sur.line ? (
                  <span className="gline">{sur.line}</span>
                ) : (
                  <span className="muted">기본 {typeGuests(s.types.find((t) => t.id === typeId)).base}명 · 넘으면 1명마다 추가 요금</span>
                )}
              </span>
            </Stepper>
            {sur.over && sur.line ? <span className="gline">{sur.line}</span> : null}
            {extraFee > 0 || sur.total > 0 || xManual ? (
              <div className="xfee">
                <span>
                  판매 가격에 <b>추가 인원 {won(extraFee)}원</b> 포함{xManual ? " · 직접 고침" : ""}
                </span>
                {xEdit ? (
                  <PriceInp sm>
                    <input
                      className="num"
                      inputMode="numeric"
                      aria-label="추가 인원 금액"
                      autoFocus
                      value={extraFee ? won(extraFee) : ""}
                      onChange={(e) => setXFee(Number(e.target.value.replace(/\D/g, "").slice(0, 8) || 0), true)}
                      onBlur={() => setXEdit(false)}
                    />
                  </PriceInp>
                ) : (
                  <button type="button" className="auto" onClick={() => setXEdit(true)}>
                    금액 바꾸기
                  </button>
                )}
                {xManual && extraFee !== sur.total ? (
                  <button type="button" className="auto" onClick={() => setXFee(sur.total, false)}>
                    자동 계산 {won(sur.total)}원으로
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {kind === "stay" ? (
          <AdvWrap on={isNew} label="시간 · 얼리체크인 · 레이트">
          <div className="fld tfld">
            <label>시간</label>
            <div className="payb">
              <div className="xtchips">
                {(
                  [
                    ["in", "빠른 입실", earlyIn, inTimeOf(s, { earlyIn })],
                    ["out", "늦은 퇴실", lateOut, outTimeOf(s, { lateOut })],
                  ] as const
                ).map(([w, label, h, t]) => (
                  <div key={w} className={`xtchip ${h ? "on" : ""}`}>
                    <span className="tl">{label}</span>
                    <button type="button" className="sb" aria-label={`${label} 1시간 줄이기`} disabled={!h} onClick={() => stepTime(w, -1)}>
                      <Minus size={14} />
                    </button>
                    <span className="tv">{h ? `${h}시간` : "없음"}</span>
                    <button type="button" className="sb" aria-label={`${label} 1시간 늘리기`} disabled={h >= EXTRA_HOURS_MAX} onClick={() => stepTime(w, 1)}>
                      <Plus size={14} />
                    </button>
                    <span className="tt num">{t}</span>
                  </div>
                ))}
              </div>
              {earlyIn || lateOut ? (
                <div className="xfee">
                  <span>
                    {tMode === "service" ? (
                      <>
                        <b>서비스</b> · {timeLine({ earlyIn, lateOut })} · 0원
                      </>
                    ) : (
                      <>
                        판매 가격에 <b>시간 추가 {won(timeFee)}원</b> 포함{tMode === "manual" ? " · 직접 고침" : ` · ${timeLine({ earlyIn, lateOut })}`}
                      </>
                    )}
                  </span>
                  {tMode !== "service" ? (
                    tEdit ? (
                      <label className="inp price sm">
                        <input
                          className="num"
                          inputMode="numeric"
                          aria-label="시간 추가 금액"
                          autoFocus
                          value={timeFee ? won(timeFee) : ""}
                          onChange={(e) => setTFee(Number(e.target.value.replace(/\D/g, "").slice(0, 8) || 0), "manual")}
                          onBlur={() => setTEdit(false)}
                        />
                        원
                      </label>
                    ) : (
                      <button type="button" className="auto" onClick={() => setTEdit(true)}>
                        금액 바꾸기
                      </button>
                    )
                  ) : null}
                  {tMode === "manual" && timeFee !== tAuto ? (
                    <button type="button" className="auto" onClick={() => setTFee(tAuto, "auto")}>
                      자동 계산 {won(tAuto)}원으로
                    </button>
                  ) : null}
                  <button type="button" className={`chip sm svc ${tMode === "service" ? "on" : ""}`} aria-pressed={tMode === "service"} onClick={() => (tMode === "service" ? setTFee(tAuto, "auto") : setTFee(0, "service"))}>
                    서비스
                  </button>
                </div>
              ) : (
                <span className="muted sm">
                  기본 입실 {s.stayTimes.checkIn} · 퇴실 {s.stayTimes.checkOut} · 1시간 {won(s.extraHourFee)}원
                </span>
              )}
              {turnWarns.map((w) => (
                <div className="twarn" key={w.other + w.date}>
                  <AlertTriangle size={13} /> {w.text} <span className="muted">· {dayLabel(w.date)} · 저장은 돼요</span>
                </div>
              ))}
            </div>
          </div>
          </AdvWrap>
        ) : null}

        {pk ? (
          <AdvWrap on={isNew} label="주차">
          <div className="fld pfld">
            <label>주차</label>
            <div className="payb">
              <div className="prow">
                <div className="seg sm" role="group" aria-label="도보 · 차량">
                  {(["walk", "car"] as const).map((m) => (
                    <button type="button" key={m} className={arrival === m ? "on" : ""} aria-pressed={arrival === m} onClick={() => setArrival(arrival === m ? null : m)}>
                      {ARRIVAL_LABEL[m]}
                    </button>
                  ))}
                </div>
                {arrival === "car" ? (
                  <div className="step cstep">
                    <button type="button" className="sb" aria-label="차량 1대 줄이기" disabled={cars <= 1} onClick={() => setCars((n) => Math.max(1, n - 1))}>
                      <Minus size={14} />
                    </button>
                    <span className="sv">
                      {cars}
                      <small>대</small>
                    </span>
                    <button type="button" className="sb" aria-label="차량 1대 늘리기" disabled={cars >= CARS_MAX} onClick={() => setCars((n) => Math.min(CARS_MAX, n + 1))}>
                      <Plus size={14} />
                    </button>
                  </div>
                ) : null}
                {!arrival ? <span className="muted sm">안 정해도 돼요 · 다시 누르면 삭제돼요</span> : null}
              </div>
              {arrival === "car" ? (
                <div className="plates">
                  {Array.from({ length: cars }, (_, i) => (
                    <input
                      key={i}
                      className="inp sm plate"
                      placeholder={`차량번호${cars > 1 ? ` ${i + 1}` : ""} (예: 12가 3456)`}
                      aria-label={`차량번호 ${i + 1}`}
                      maxLength={PLATE_MAX}
                      value={plates[i] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPlates((p) => {
                          const n = [...p];
                          while (n.length < i) n.push("");
                          n[i] = v;
                          return n;
                        });
                      }}
                    />
                  ))}
                </div>
              ) : null}
              {arrival === "car" && (carFee > 0 || cAuto > 0 || cMan) ? (
                <FeeLine
                  text={
                    <>
                      판매 가격에 <b>추가 차량 {won(carFee)}원</b> 포함{cMan ? " · 직접 고침" : ` · ${carFeeLine(cars, kind === "stay" ? nights : 1, s.parking.extraCarFee)}`}
                    </>
                  }
                  label="추가 차량 금액"
                  value={carFee}
                  auto={cAuto}
                  manual={cMan}
                  onSet={setCFee}
                />
              ) : null}
              {arrival === "walk" && (walkOff > 0 || wAuto > 0 || wMan) ? (
                <FeeLine
                  text={
                    <>
                      판매 가격에서 <b>도보 할인 −{won(walkOff)}원</b> 뺐어요{wMan ? " · 직접 고침" : ""}
                    </>
                  }
                  label="도보 할인 금액"
                  value={walkOff}
                  auto={wAuto}
                  manual={wMan}
                  onSet={setWOff}
                />
              ) : null}
            </div>
          </div>
          </AdvWrap>
        ) : null}

        {/* 신규 현장: 완납/후불/선금 → 결제수단(원형) → 판매금 (간단과 동일) */}
        {createOnsitePay ? (
          <OnsitePayModeFields
            part="chips"
            payMode={createPayMode}
            onPayMode={setCreatePayMode}
            depAmt={createDepAmt}
            onDepAmt={setCreateDepAmt}
            depMethod={createDepMethod}
            onDepMethod={setCreateDepMethod}
          />
        ) : null}
        {createOnsitePay ? (
          <OnsitePayModeFields
            part="method"
            payMode={createPayMode}
            onPayMode={setCreatePayMode}
            depAmt={createDepAmt}
            onDepAmt={setCreateDepAmt}
            depMethod={createDepMethod}
            onDepMethod={setCreateDepMethod}
          />
        ) : null}

        {long ? (
          <div className="fld">
            <label>누적 요금</label>
            <div className="payb longacc">
              <div className="payrow">
                <b>청구 합계</b>
                <span className="num">{won(payDue)}원</span>
                <span className="muted">{(draftBase.charges ?? []).length}박 · 스케줄 적용</span>
              </div>
              <div className="payrow">
                <b>수납액</b>
                <span className="num">{won(payPaid)}원</span>
              </div>
              <div className={`payleft ${payLeft > 0 ? "due" : "ok"}`}>
                미수금 <b className="num">{won(payLeft)}원</b>
                <span className="muted"> · {settleHint(settleCycle, payLeft)}</span>
                <button type="button" className="btn sm line" onClick={() => setShowLedger((v) => !v)}>
                  {showLedger ? "내역 닫기" : "내역"}
                </button>
              </div>
              {showLedger ? (
                <div className="longledger">
                  {(draftBase.charges ?? []).map((c) => (
                    <div className="payrow" key={c.id + c.nightDate}>
                      <span>{dayLabel(c.nightDate)}</span>
                      <span className="num">{won(c.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : multi ? (
          <div className="fld">
            <label>
              객실별 요금<em>*</em>
            </label>
            <div className="payb">
              <GroupRoomRates s={s} slots={multiSlots} edits={rateEdits} onEdits={setRateEdits} checkIn={checkIn} nights={nights} />
              {multiAddons ? <div className="muted sm">객실마다 가산 {won(multiAddons)}원(차량·시간 등)이 더해져요.</div> : null}
            </div>
          </div>
        ) : (
          <div className="fld">
            <label>
              {kind === "stay" ? (
                <>
                  판매금<em>*</em>
                </>
              ) : (
                <>
                  판매 가격<em>*</em>
                </>
              )}
            </label>
            <div className="payb">
              {kind === "stay" ? (
                <div className="seg sm" role="tablist" aria-label="판매금 입력 모드">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={salesMode === "perNight"}
                    className={salesMode === "perNight" ? "on" : ""}
                    onClick={() => setSalesMode("perNight")}
                  >
                    박당
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={salesMode === "total"}
                    className={salesMode === "total" ? "on" : ""}
                    onClick={() => setSalesMode("total")}
                  >
                    총액
                  </button>
                </div>
              ) : null}
              {kind === "stay" ? (
                salesMode === "total" ? (
                  <>
                    <PriceRow>
                      <PriceInp total>
                        <input
                          className="num"
                          inputMode="numeric"
                          placeholder="총액"
                          value={price ? won(Number(price)) : ""}
                          onChange={(e) => setTotalAndRate(e.target.value)}
                          aria-label="판매금 총액"
                        />
                      </PriceInp>
                    </PriceRow>
                    <div className="muted sm">
                      {isOnsite(curPlat) ? "총액 · 박은 자동 분배" : "플랫폼 총액 그대로"}
                      {Number(price || 0) > 0 ? (
                        <>
                          {" · "}
                          <b>{won(Number(price))}원</b>
                          {nights > 1 ? ` · ${nights}박` : null}
                        </>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <>
                    <PriceRow>
                      <PriceInp sm suffix="원/박">
                        <input
                          className="num"
                          inputMode="numeric"
                          placeholder="1박"
                          value={rateStr ? won(Number(rateStr)) : ""}
                          onChange={(e) => setRateAndTotal(e.target.value)}
                          aria-label="1박 요금"
                        />
                      </PriceInp>
                      <span className="muted sm">× {nights}박 =</span>
                      <PriceInp total>
                        <input
                          className="num"
                          inputMode="numeric"
                          placeholder="총액"
                          value={price ? won(Number(price)) : ""}
                          onChange={(e) => setTotalAndRate(e.target.value)}
                          aria-label="판매금"
                        />
                      </PriceInp>
                    </PriceRow>
                    <PriceRow wdwe>
                      <PriceInp sm suffix="평일">
                        <input
                          className="num"
                          inputMode="numeric"
                          placeholder="평일"
                          value={wdStr ? won(Number(wdStr)) : ""}
                          onChange={(e) => applyWdWe(e.target.value.replace(/\D/g, "").slice(0, 9), weStr)}
                          aria-label="평일 1박 기본"
                        />
                      </PriceInp>
                      <PriceInp sm suffix="주말">
                        <input
                          className="num"
                          inputMode="numeric"
                          placeholder="주말"
                          value={weStr ? won(Number(weStr)) : ""}
                          onChange={(e) => applyWdWe(wdStr, e.target.value.replace(/\D/g, "").slice(0, 9))}
                          aria-label="주말 1박 기본 (금·토)"
                        />
                      </PriceInp>
                      <span className="muted sm">금·토 · 날짜 셀에서 밤마다 고칠 수 있어요</span>
                    </PriceRow>
                  </>
                )
              ) : (
                <PriceInp>
                  <input
                    className="num"
                    inputMode="numeric"
                    placeholder="금액"
                    value={price ? won(Number(price)) : ""}
                    onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 9))}
                    aria-label="판매 가격"
                  />
                </PriceInp>
              )}
              {kind === "stay" && !long && nights >= 1 && nights <= STAY_NIGHTS_MAX ? (
                <NightRatesTable
                  checkIn={checkIn}
                  nights={nights}
                  rates={nightRates}
                  fallback={Number(rateStr || 0) || 0}
                  hideTotal
                  addons={stayAddons({ kind: "stay", extraFee, earlyIn, lateOut, timeFee, arrival, carFee, walkOff })}
                  onChange={(r) => {
                    setNightRates(r);
                    if (r.flat) setRateStr(String(r.flat));
                    setPrice(
                      String(
                        priceFromNightMatrix(
                          r,
                          stayAddons({ kind: "stay", extraFee, earlyIn, lateOut, timeFee, arrival, carFee, walkOff }),
                        ),
                      ),
                    );
                  }}
                />
              ) : null}
              {kind === "stay" && Number(price || 0) > 0 && salesMode !== "total" ? (
                <div className="muted sm">
                  {hasFullNightMatrix(checkIn, nights, nightRates)
                    ? "총액 = 선택 밤 금액 합"
                    : "총액 = 1박 요금 × 박수"}
                  {(() => {
                    const a = stayAddons({ kind: "stay", extraFee, earlyIn, lateOut, timeFee, arrival, carFee, walkOff });
                    return a ? ` + 가산 ${won(a)}원` : "";
                  })()}
                  {" · "}박수 줄이면 뒤 밤을 빼고 맞춰요
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* 신규 현장: 완납/선금 수납만 · 후불은 숨김 · 수정·장기·대실·플랫폼은 Option A */}
        {createOnsitePay ? (
          <OnsitePayModeFields
            part="take"
            payMode={createPayMode}
            onPayMode={setCreatePayMode}
            depAmt={createDepAmt}
            onDepAmt={setCreateDepAmt}
            depMethod={createDepMethod}
            onDepMethod={setCreateDepMethod}
          />
        ) : (
          <div className="fld pay">
            <label className="paylab">
              <span>{long ? "수납" : "결제"}</span>
              {canAs && !as ? (
                <button type="button" className="chip sm" onClick={openAs} title="늦은 퇴실·레이트·기타 할증을 한 번에">
                  {SURCHARGE_COPY}
                </button>
              ) : null}
            </label>
            <div className="payb">
              {!payTracked ? (
                <div className="muted sm payota">
                  플랫폼에서 결제 · 잔금 없음 <span>(설정 › 플랫폼에서 '현장 결제'를 켜면 잔금을 따져요)</span>
                </div>
              ) : (
                <>
                  {evidence ? <PayEvidence title={evidence.title} lines={evidence.lines} ledger={null} onOpen={() => setRecOpen(true)} /> : null}
                  {livePays.length > 0 ? <div className="muted sm paysplit">수납액 {splitLine(paySplit(livePays))}</div> : null}
                  <div className={`payleft ${payLeft > 0 ? "due" : "ok"}`}>
                    {payLeft > 0 ? (
                      <>
                        {long ? "미수" : "잔금"} <b className="num">{won(payLeft)}원</b>
                        <span className="muted">
                          {" "}
                          = {long ? "청구 합계" : "판매"} {won(payDue)} − 수납 {won(payPaid)}
                        </span>
                      </>
                    ) : payPaid > 0 ? (
                      <>
                        <Check size={14} strokeWidth={2.6} /> {long ? "정산됨" : "완납"} <span className="muted">· 수납액 {won(payPaid)}원</span>
                      </>
                    ) : (
                      <span className="muted">{long ? "요금표를 입력하면 미수가 보여요" : "판매 가격을 입력하면 잔금이 보여요"}</span>
                    )}
                  </div>
                  <div className="paytake">
                    <BookPayMethodCircles
                      value={recv.method}
                      onChange={(m) => setRecv({ ...recv, method: m })}
                      disabled={payBusy}
                    />
                    <label className="inp price sm">
                      <span className="pl">금액</span>
                      <input
                        className="num"
                        inputMode="numeric"
                        placeholder={payLeft > 0 ? won(payLeft) : "0"}
                        aria-label="수납 금액"
                        value={recv.amount ? won(Number(recv.amount)) : ""}
                        onChange={(e) => setRecv({ ...recv, amount: e.target.value.replace(/\D/g, "").slice(0, 9) })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void recordPay(payLeft > 0 ? "balance" : "deposit");
                          }
                        }}
                      />
                      원
                    </label>
                    <input
                      className="inp sm"
                      type="date"
                      aria-label="수납일"
                      value={recv.date}
                      onChange={(e) => e.target.value && setRecv({ ...recv, date: e.target.value })}
                    />
                    <div className="paybtns">
                      <button
                        type="button"
                        className="btn sm dark"
                        disabled={payBusy || payLeft <= 0}
                        title={payLeft <= 0 ? (long ? "수납할 미수금이 없어요" : "수납할 잔금이 없어요") : undefined}
                        onClick={() => void recordPay("balance")}
                      >
                        {payBusy ? "저장 중…" : long ? "미수금 수납" : "수납"}
                      </button>
                      <button type="button" className="btn sm line" disabled={payBusy} onClick={() => void recordPay("deposit")}>
                        {long ? "선수" : "선금"}
                      </button>
                    </div>
                  </div>
                  {!base ? <div className="muted sm">아직 저장 전이에요 · 수납·선금을 누르면 예약과 함께 저장돼요</div> : null}
                  {base && entryOpenCredits.length > 0 ? (
                    <div className="paytake" style={{ marginTop: 8 }}>
                      <span className="muted sm">
                        {STAY_CREDIT_COPY.balance} {entryOpenCredits.length}건 · 잔액{" "}
                        {won(entryOpenCredits.reduce((n, c) => n + c.amountRemaining, 0))}원
                      </span>
                      <button
                        type="button"
                        className="btn sm dark"
                        disabled={payBusy || busy}
                        onClick={() => {
                          void (async () => {
                            if (!base || payBusy || busy) return;
                            const c = entryOpenCredits[0]!;
                            const amount = Math.min(
                              c.amountRemaining,
                              Number(recv.amount || 0) || (payLeft > 0 ? payLeft : c.amountRemaining),
                            );
                            const planned = planApplyStayCredit({
                              credit: c,
                              bookingId: base.id,
                              amount,
                              bizDate: recv.date || today,
                              kind: "balance",
                            });
                            if ("err" in planned) return setPayErr(planned.err);
                            setPayBusy(true);
                            setPayErr(null);
                            try {
                              const result = await data.applyStayCredit(
                                c,
                                base.id,
                                planned.amount,
                                planned.bizDate,
                                planned.kind,
                              );
                              setRecv((r) => ({ ...r, amount: "" }));
                              notify(applyCreditNotifyLine(c.guestName, result.plan.amount, result.plan.remainingAfter));
                            } catch (e) {
                              setPayErr(saveFailMessage(e));
                            } finally {
                              setPayBusy(false);
                            }
                          })();
                        }}
                      >
                        {STAY_CREDIT_COPY.use}
                      </button>
                    </div>
                  ) : null}
                  {payErr ? <div className="ferr">{payErr}</div> : null}
                </>
              )}
            </div>
          </div>
        )}

        {feeOn ? (
          <AdvWrap on={isNew} label="쿠폰 · 플랫폼 입금">
          <div className="fld cfld">
            <label>쿠폰 · 입금</label>
            <div className="payb">
              {coupons.map((c, i) => (
                <div className="cprow" key={i}>
                  <span className="pl">쿠폰{coupons.length > 1 ? ` ${i + 1}` : ""}</span>
                  <label className="inp price sm">
                    <input
                      className="num"
                      inputMode="numeric"
                      aria-label={`쿠폰 ${i + 1} 금액`}
                      placeholder="금액"
                      value={c.amount ? won(Number(c.amount)) : ""}
                      onChange={(e) => {
                        const v = String(Math.min(COUPON_AMOUNT_MAX, Number(e.target.value.replace(/\D/g, "").slice(0, 8) || 0)) || "");
                        setCoupons((l) => l.map((x, j) => (j === i ? { ...x, amount: v } : x)));
                      }}
                    />
                    원
                  </label>
                  <label className="ck">
                    <input type="checkbox" checked={c.hotel} aria-label={`쿠폰 ${i + 1} 숙소 부담`} onChange={(e) => setCoupons((l) => l.map((x, j) => (j === i ? { ...x, hotel: e.target.checked } : x)))} />
                    숙소 부담
                  </label>
                  <button type="button" className="ic" aria-label={`쿠폰 ${i + 1} 삭제`} onClick={() => setCoupons((l) => l.filter((_, j) => j !== i))}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <div className="cpadd">
                {coupons.length < COUPON_MAX ? (
                  <button type="button" className="chip sm" onClick={() => setCoupons((l) => [...l, { amount: "", hotel: curPlat?.couponHotel === true }])}>
                    <Plus size={13} /> 쿠폰
                  </button>
                ) : null}
                {!coupons.length ? <span className="muted sm">쿠폰을 사용했으면 금액을 입력해 주세요 · 판매 가격은 그대로예요</span> : null}
              </div>
              {poLine ? (
                <div className="poline">
                  <span>
                    입금 예정가 <b className="num">{won(po.expected)}원</b>
                  </span>
                  <span className="muted pof">{poLine}</span>
                </div>
              ) : null}
              {po.tracked ? (
                <div className="postat">
                  {po.dueOn ? <span className="muted">입금 예정일 {dayLabel(po.dueOn)}</span> : null}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={payOk}
                    aria-label="입금 확인"
                    className={`tgl ${payOk ? "on" : ""}`}
                    onClick={() => {
                      if (!payOk && payAmt === "") setPayAmt(String(po.expected));
                      setPayOk(!payOk);
                    }}
                  >
                    <i />
                    입금 확인
                  </button>
                  {payOk ? (
                    <>
                      <label className="inp price sm">
                        <input className="num" inputMode="numeric" aria-label="실제 입금액" value={payAmt !== "" ? won(Number(payAmt)) : ""} placeholder={won(po.expected)} onChange={(e) => setPayAmt(e.target.value.replace(/\D/g, "").slice(0, 9))} />
                        원
                      </label>
                      {po.diff ? (
                        <span className={`podiff ${po.diff < 0 ? "neg" : ""}`}>
                          예정보다 {po.diff > 0 ? "+" : "−"}
                          {won(Math.abs(po.diff))}원
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          </AdvWrap>
        ) : null}

        {!isNew && kind === "stay" && nights >= 2 && roomId ? (
          <div className="fld">
            <label>객실 이동</label>
            <div className="mvbox">
              {moved ? (
                <div className="mvlegs">
                  {legs.map((l, i) => (
                    <span className="mvleg" key={i}>
                      {i > 0 ? (
                        <button type="button" className="mvundo" title={`${md(l.checkIn)} 이동을 취소하고 ${L.roomLabel(legs[i - 1].roomId)}호에 계속 묵어요`} onClick={() => setSegs(undoMove(draft, i))}>
                          <ArrowRight size={13} />
                          <span>이동 취소</span>
                        </button>
                      ) : null}
                      <span className={`mvroom ${busyLegs.some((x) => x.idx === l.idx) ? "busy" : ""}`}>
                        <b>{L.roomLabel(l.roomId)}</b>
                        <small>
                          {md(l.checkIn)}~ {l.nights}박
                        </small>
                      </span>
                    </span>
                  ))}
                </div>
              ) : null}
              {mv ? (
                <div className="mvpanel">
                  <div className="mvq">몇 박째부터</div>
                  <div className="chips">
                    {Array.from({ length: nights - 1 }, (_, i) => i + 2).map((k) => (
                      <button type="button" key={k} className={`chip sm ${mv.from === k ? "on" : ""}`} onClick={() => setMv({ ...mv, from: k, room: null })}>
                        {k}박째 {dayLabel(addDays(checkIn, k - 1))}
                      </button>
                    ))}
                  </div>
                  <div className="mvq">옮길 방 <span className="muted">· {dayLabel(addDays(checkIn, mv.from - 1))} ~ {dayLabel(addDays(checkIn, nights))} 퇴실</span></div>
                  {(() => {
                    const cur = legs.find((l) => l.checkIn <= addDays(checkIn, mv.from - 1) && addDays(checkIn, mv.from - 1) < addDays(l.checkIn, l.nights))?.roomId;
                    const list = allRooms.filter((r) => r.id !== cur);
                    const same = list.filter((r) => r.typeId === typeId);
                    const other = list.filter((r) => r.typeId !== typeId);
                    const chip = (r: (typeof allRooms)[number], showType: boolean) => (
                      <button
                        type="button"
                        key={r.id}
                        className={`rchip ${showType ? "other" : ""} ${mv.room === r.id ? "on" : ""} ${mvFree.has(r.id) ? "" : "busy"}`}
                        title={`${L.roomLabel(r.id) ?? r.no}${mvFree.has(r.id) ? "" : " · 그 기간에 다른 예약이 있어요"}`}
                        onClick={() => setMv({ ...mv, room: r.id })}
                      >
                        {bpre(r.buildingId)}
                        {r.no}
                        {showType ? <i>{typeLabel(L.types.get(r.typeId ?? ""))}</i> : null}
                      </button>
                    );
                    return (
                      <div className="chips">
                        {same.map((r) => chip(r, false))}
                        {mv.other || (mv.room && L.rooms.get(mv.room)?.typeId !== typeId)
                          ? other.map((r) => chip(r, true))
                          : other.length ? (
                              <button type="button" className="rchip lt" onClick={() => setMv({ ...mv, other: true })}>
                                다른 타입 방 +{other.length}
                              </button>
                            ) : null}
                      </div>
                    );
                  })()}
                  {mv.room && !mvFree.has(mv.room) ? (
                    <div className="mvwarn">{L.roomLabel(mv.room)}호는 그 기간에 다른 예약이 있어요. 옮기면 겹쳐서 저장할 수 없어요.</div>
                  ) : null}
                  <div className="mvact">
                    <button type="button" className="btn sm line" onClick={() => setMv(null)}>
                      그만두기
                    </button>
                    <button
                      type="button"
                      className="btn sm dark"
                      disabled={!mv.room}
                      onClick={() => {
                        if (!mv.room) return;
                        setSegs(moveStay(draft, mv.from, mv.room));
                        setMv(null);
                      }}
                    >
                      {mv.room ? `${mv.from}박째부터 ${L.roomLabel(mv.room)}호로 옮기기` : "방을 골라 주세요"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn sm line mvbtn"
                  onClick={() => {
                    const k = Math.min(nights, Math.max(2, daysBetween(checkIn, today) + 1));
                    setMv({ from: k, room: null, other: false });
                  }}
                >
                  <ArrowRight size={14} /> 객실 이동{moved ? " 더하기" : ""}
                </button>
              )}
              {!mv ? <span className="muted sm mvnote">{moved ? "예약은 하나 그대로예요 · 저장해야 반영돼요" : "중간에 방을 옮기면 몇 박째부터 어느 방인지 남겨요"}</span> : null}
            </div>
          </div>
        ) : null}

        <div className="fld">
          <label>{isNew ? "입실 · 메모" : "메모"}</label>
          <div className={isNew ? "two memo" : ""}>
            {isNew && kind === "stay" ? (
              <button type="button" className={`chip ncx ${noClean ? "on" : ""}`} aria-pressed={noClean} onClick={() => setNoClean((t) => !t)} title="청소하지 않음">
                {noClean ? <Check size={14} strokeWidth={2.6} /> : null}청소X
              </button>
            ) : null}
            <Inp placeholder="메모 (선택)" maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
        </div>

        <div className="pv">
          {kind === "dayuse" ? (
            <div className="pt">대실은 잔여 객실에 포함되지 않아요. 이용 시간만 따로 보여 줘요.</div>
          ) : !isActive(draft) ? (
            <div className="pt">
              {status === "noshow"
                ? "노쇼는 결제한 금액을 매출에 그대로 남기고, 방과 잔여 객실은 다시 비워요."
                : "취소는 전액 환불로 보고 장부에 취소선으로 남겨요. 매출에서 빠지고 잔여 객실은 다시 늘어나요."}
            </div>
          ) : preview.length ? (
            <>
              <div className="pt">저장하면 이렇게 바뀌어요</div>
              {preview.slice(0, 4).map((r) => {
                const t = L.types.get(r.typeId);
                const lv = stockLevel(r.after, totals.get(r.typeId) ?? 0, s.lowThreshold);
                return (
                  <div className="pvr" key={`${r.typeId}${r.date}`}>
                    <span className="d">{dayLabel(r.date)}</span>
                    <TypeBadge t={t} />
                    <span className="pn">{t?.name} 잔여 객실</span>
                    <span className="v">
                      <s>{r.before}</s>
                      <ArrowRight size={16} />
                      <span className={r.after <= 0 ? "tred" : ""}>{r.after < 0 ? `−${-r.after}` : r.after}</span>
                    </span>
                    {r.after < 0 ? (
                      <span className="w tred">초과돼요 (오버부킹)</span>
                    ) : r.after === 0 ? (
                      <span className="w tred">만실이 돼요</span>
                    ) : lv === "low" ? (
                      <span className="w">얼마 안 남았어요</span>
                    ) : null}
                  </div>
                );
              })}
              {preview.length > 4 ? <div className="pt more">외 {preview.length - 4}박도 함께 바뀌어요</div> : null}
            </>
          ) : (
            <div className="pt">잔여 객실 숫자는 그대로예요.</div>
          )}
        </div>

        {err ? <div className="ferr">{err}</div> : null}

        <div className="mf">
          {isNew ? (
            <div className="keys">
              <span>
                <kbd>1~{Math.min(9, s.platforms.length)}</kbd>플랫폼
              </span>
              <span>
                <kbd>Q~</kbd>타입
              </span>
              <span>
                <kbd>←→</kbd>박수
              </span>
              <span className="kk-note">입력 칸 안에서는 Alt와 함께</span>
              <span>
                <kbd>Ctrl</kbd>+<kbd>Enter</kbd>하나 더
              </span>
            </div>
          ) : !isActive(draft) || eoPast ? (
            <div className="keys acts">
              {isActive(draft) ? (
                <button type="button" className="btn line sm" title="지난 숙박을 바로잡아요: 떠난 날을 고르면 그 뒤 밤은 비워요" onClick={() => (eo ? setEo(null) : openEo())}>
                  조기 퇴실 처리
                </button>
              ) : (
                <button
                  type="button"
                  className="btn line sm"
                  disabled={busy}
                  title="취소·노쇼를 정상 예약으로 되돌리고 바로 저장해요"
                  onClick={() => void save(false, "active")}
                >
                  {busy ? "저장 중…" : "예약 되살리기"}
                </button>
              )}
            </div>
          ) : null}
          <button type="button" className="btn line" onClick={onClose}>
            {isNew ? "취소" : "닫기"}
          </button>
          <button type="submit" className={isNew && kind === "stay" ? "btn stop" : "btn red"} disabled={busy}>
            {busy ? "저장 중…" : isNew && kind === "stay" ? (nRooms > 1 ? `${nRooms}실 저장하기` : "저장하기") : "저장"}{" "}
            <span className="num kbdh">Enter</span>
          </button>
          {isNew && kind === "stay" ? (
            <button
              type="button"
              className="btn green"
              disabled={busy}
              onClick={() => void save(false, undefined, { walkInImmediate: true })}
              title="저장 후 바로 숙박(입실) · 호실 필수 · 이름·연락처 비워도 됨"
            >
              {busy ? "저장 중…" : "바로입실"}
            </button>
          ) : null}
        </div>
          </div>{/* .book-pane-right */}
        </div>{/* .book-panes */}

      </form>
    </div>
    {swapChoice ? (
      <AssignSwapConfirm
        L={L}
        plan={swapChoice}
        busy={swapBusy}
        onCancel={() => setSwapChoice(null)}
        onConfirm={() => void doEntrySwap(swapChoice)}
      />
    ) : null}
    {exOverlap ? (
      <ExtendOverlapConfirm
        extraNight={exOverlap.extraNight}
        others={exOverlap.others}
        roomLabel={L.roomLabel(live?.roomId ?? null)}
        busy={exBusy}
        onCancel={() => setExOverlap(null)}
        onApprove={() => void confirmEx({ allowOverlap: true })}
      />
    ) : null}
    {dayuseWarn ? (
      <DayuseStayOverlapConfirm
        message={dayuseWarn.message}
        busy={busy}
        onCancel={() => setDayuseWarn(null)}
        onContinue={() => void save(dayuseWarn.again, dayuseWarn.override, { allowDayuseOverlap: true })}
      />
    ) : null}
    {recOpen && evidence && evidence.members.length ? (
      <RecordSheet
        data={data}
        today={today}
        members={evidence.members}
        groupId={evidence.groupId}
        name={evidence.title}
        readOnly={false}
        onClose={() => setRecOpen(false)}
        onSaved={(m) => notify(m)}
      />
    ) : null}
    {coConfirm ? (
      <CheckoutConfirmModal
        s={s}
        today={today}
        booking={coConfirm.booking}
        members={coConfirm.members.map((m) => data.bookings.find((x) => x.id === m.id) ?? m)}
        groupInfo={
          coConfirm.booking.groupId ? (data.groups.get(coConfirm.booking.groupId) ?? null) : null
        }
        roomLabel={
          coConfirm.booking.roomId ? (L.roomLabel(coConfirm.booking.roomId) ?? "") : ""
        }
        busy={coBusy}
        onCancel={() => !coBusy && setCoConfirm(null)}
        onCheckoutOnly={() => void confirmEntryCheckoutOnly()}
        onPayThenCheckout={(plan) => void confirmEntryCheckoutPayThen(plan)}
      />
    ) : null}
    {stayConfirm && base && base.kind === "stay" ? (
      <StayConfirmLetter
        booking={live ?? base}
        hotelName={data.hotel!.name}
        s={s}
        today={today}
        onClose={() => setStayConfirm(false)}
      />
    ) : null}
    {damageOpen && base && base.kind === "stay" ? (
      <DamageLetter
        hotelName={data.hotel!.name}
        s={s}
        today={today}
        booking={live ?? base}
        busy={damageBusy}
        notify={notify}
        onIssue={async (draft) => {
          setDamageBusy(true);
          try {
            return await damages.issue(draft);
          } finally {
            setDamageBusy(false);
          }
        }}
        onClose={() => setDamageOpen(false)}
      />
    ) : null}
    </>
  );
}

/** 판매 가격에 들어 있는 금액 한 줄: 금액 바꾸기 · 자동 계산으로 */
function FeeLine({ text, label, value, auto, manual, onSet }: { text: React.ReactNode; label: string; value: number; auto: number; manual: boolean; onSet: (v: number, manual: boolean) => void }) {
  const [edit, setEdit] = useState(false);
  return (
    <div className="xfee">
      <span>{text}</span>
      {edit ? (
        <label className="inp price sm">
          <input className="num" inputMode="numeric" aria-label={label} autoFocus value={value ? won(value) : ""} onChange={(e) => onSet(Number(e.target.value.replace(/\D/g, "").slice(0, 8) || 0), true)} onBlur={() => setEdit(false)} />
          원
        </label>
      ) : (
        <button type="button" className="auto" onClick={() => setEdit(true)}>
          금액 바꾸기
        </button>
      )}
      {manual && value !== auto ? (
        <button type="button" className="auto" onClick={() => onSet(auto, false)}>
          자동 계산 {won(auto)}원으로
        </button>
      ) : null}
    </div>
  );
}
