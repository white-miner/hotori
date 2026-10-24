import { parkingMark } from "../shared/parking";
import ParkingView from "./ParkingView";
import { type TurnWarn, clampHours, inTimeOf, outTimeOf, turnoverWarnings } from "../shared/extratime";
import {
  canCheckOut,
  canEndDayuse,
  hotelWallClock,
  isCheckedOut,
  isDepartingStatus,
  groupStayPeers,
  nowAmountGlance,
  nowAmountTone,
  nowByRoom,
  nowCheckoutMark,
  nowFlags,
  nowLists,
  nowMetaLine,
  nowNightRange,
  nowLatestPayMethodLabel,
  nowPayMethodPrefix,
  nowStaySummary,
  shouldAutoArrive,
} from "../shared/nowboard";
import { isLongStay, nightsAtCheckout } from "../shared/longstay";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Car, ChevronLeft, ChevronRight, Footprints, MessageCircle, PanelLeftOpen, PanelRightClose, Search, TriangleAlert, UserRound, X } from "lucide-react";
import { boardGuestSearch, type GuestSearchChip } from "../shared/guestSearch";
import NowNightPopover from "./NowNightPopover";
import AssignCheckoutChoice from "./AssignCheckoutChoice";
import AssignRoomPick from "./AssignRoomPick";
import AssignSwapConfirm from "./AssignSwapConfirm";
import AssignTypeConfirm from "./AssignTypeConfirm";
import DayuseStayOverlapConfirm from "./DayuseStayOverlapConfirm";
import DayuseSaleModal from "./DayuseSaleModal";
import EarlyInPayModal from "./EarlyInPayModal";
import AddTimeModal from "./AddTimeModal";
import ExtendNightModal from "./ExtendNightModal";
import ExtendOverlapConfirm from "./ExtendOverlapConfirm";
import StaySaleModal from "./StaySaleModal";
import PaymentDeskModal from "./PaymentDeskModal";
import { applyCreditNotifyLine, type StayCredit } from "../shared/stayCredit";
import CheckoutConfirmModal from "./CheckoutConfirmModal";
import NowSidePanel, { type SideMode } from "./NowSidePanel";
import RoomMemoModal from "./RoomMemoModal";
import { askConfirm } from "./ConfirmDialog";
import {
  checkoutLeaveBalanceNotifyLine,
  checkoutPayNotifyLine,
} from "../shared/checkoutConfirm";
import {
  CHECKOUT_UNDO_CTA,
  CHECKOUT_UNDO_TITLE,
  checkoutUndoBlock,
  checkoutUndoConfirmBody,
  recentCheckedOutForRoom,
  restoreCheckoutPatch,
} from "../shared/checkoutUndo";
import {
  type EarlyInPayMethod,
  type EarlyInPayPlan,
  earlyInPayNotifyLine,
} from "../shared/earlyInPay";
import { dayuseByRoom as dayuseByRoomMap, dayuseStayOverlapWarn } from "../shared/dayuseOverlap";
import {
  buildDayuseSaleBooking,
  dayuseSaleNotifyLine,
  planDayuseSale,
  type DayuseSaleInput,
} from "../shared/dayuseSale";
import {
  buildStaySaleDrafts,
  staySaleCreatePayPlan,
  staySaleNotifyLine,
  type StaySaleCreateInput,
  type StaySaleOccupiedInput,
} from "../shared/staySale";
import {
  paymentDeskNotifyLine,
  planPaymentDeskSurcharge,
  sameGroupId,
  type PaymentDeskPayPlan,
} from "../shared/paymentDesk";
import type { SurchargeReason } from "../shared/addSurcharge";
import { surchargeNotifyLine } from "../shared/addSurcharge";
import {
  addTimeNotifyLine,
  planAddTime,
  type AddTimeInput,
} from "../shared/addTime";
import {
  applyExtend,
  canExtend,
  extendNotifyLine,
  extendOverlaps,
  nightRate,
  planOpsExtend,
  type OpsExtendInput,
} from "../shared/extend";
import { saveFailMessage } from "../shared/errors";
import { onsiteCreatePayTail } from "../shared/payment";
import {
  type BoardTab,
  type Booking,
  addDays,
  allOverbookings,
  allRooms,
  boardTabFromHash,
  type StockPeriod,
  clampRange,
  dateList,
  isStockPeriod,
  shiftStockAnchor,
  stockRange,
  stockRangeLabel,
  isMultiBuilding,
  unassignedStays,
  dayLabel,
  firstOverbooking,
  checkedOutRoomOverlaps,
  freeRooms,
  fitSegments,
  isActive,
  legConflicts,
  isEarlyOut,
  usedNights,
  md,
  nightBoard,
  orderedFloors,
  stayEnd,
  stockTable,
  mergeViewBookings,
  typeLabel,
  typeTotals,
  weekday,
  won,
  legsOf,
  occupiesRoom,
} from "../shared/ledger";
import {
  GLANCE_OPEN_KEY,
  glanceMapKindNow,
  glanceMapKindPlacement,
  type GlanceOccFilter,
  type GlanceSurface,
} from "../shared/boardGlance";
import NowGlancePanel from "./NowGlancePanel";
import type { MinimapBuilding } from "./BoardStatusMinimap";
import { type HotelData, WINDOW_BACK, queryStays, useRoomMemos } from "./data";
import type { BoardMove, ToastOpt } from "./App";
import { pastelColor } from "../shared/floorColor";
import {
  boardMove,
  boardMoveTargets,
  boardMoveWindow,
  boardSwapTargets,
  placementOf,
  roomOnNight,
  type RoomSwapPlan,
} from "../shared/ledger";
import { openMemoGlances } from "../shared/roomMemo";
import RoomCalendar from "./RoomCalendar";
import SalesCalendar from "./SalesCalendar";
import { type BookPayMethod, isOnsite, isWalkInPlaceholderName, payState } from "../shared/payment";
import { emptyGroupInfo, groupSettleGlance, settle, type GroupBadgeColor, type GroupInfo } from "../shared/settle";
import { DateChip, FitText, GroupBadge, PlatBadge, TypeBadge, TypeRow, floorPaint, lookups } from "./ui";

interface Props {
  data: HotelData;
  today: string;
  selDate: string;
  setSelDate: (d: string) => void;
  onOpen: (b: Booking, night?: string, opts?: { openExtend?: boolean; openSurcharge?: boolean }) => void;
  onNew: (preset: Partial<Booking>) => void;
  /** 간단 예약 축약 폼 (기본 Path A · 미배정 · roomIds=현황 복수선택 Path B) */
  onSimple?: (preset?: Partial<Booking>, opts?: { roomIds?: string[] }) => void;
  notify: (m: string, opt?: ToastOpt) => void;
  /** 객실 배치·현황에서 빈/점유 방을 눌러 옮기는 중 */
  move?: BoardMove | null;
  onMoveStart?: (m: BoardMove) => void;
  onMoveEnd?: () => void;
  /** 현황 공유 링크: 보기만 해요 (고치기·입실 완료·방 배정·가격 없음) */
  readOnly?: boolean;
  /** 공유 보기에서 고를 수 있는 날짜 범위 */
  minDate?: string;
  maxDate?: string;
}
const DAYS = 14;
const nowLabel = () =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
const STATUS: Record<string, string> = { cancelled: "취소", noshow: "노쇼" };

/** 현황판 탭: 주소(#/board/now · stock · rooms · calendar)가 먼저, 없으면 이 기기에서 마지막으로 본 탭, 처음이면 「현황」 */
const TAB_KEY = "hotori.boardTab";
const B_KEY = "hotori.boardBuilding";
const P_KEY = "hotori.stockPeriod";
const R_KEY = "hotori.stockRange";
/** 「배치」우측 패널 접기 — 기기별 기억 */
const SIDE_COLLAPSE_KEY = "hotori.boardSideCollapsed";
/** 「미니맵」펼침 — 표면별 */
const glanceOpenDefault = (): boolean => {
  if (typeof window === "undefined") return true;
  try {
    return !window.matchMedia("(max-width: 760px)").matches;
  } catch {
    return true;
  }
};
const PERIODS: { id: StockPeriod; label: string }[] = [
  { id: "d14", label: "14일" },
  { id: "week", label: "주" },
  { id: "month", label: "월" },
  { id: "range", label: "기간" },
];
const TAB_OK = new Set<BoardTab>(["now", "stock", "rooms", "calendar", "parking"]);
const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 개인 정보 보호 모드 */
  }
};
function useBoardTab(): [BoardTab, (t: BoardTab) => void] {
  const read = (): BoardTab => {
    const h = boardTabFromHash(location.hash);
    if (h) return h;
    try {
      const v = localStorage.getItem(TAB_KEY);
      return v && TAB_OK.has(v as BoardTab) ? (v as BoardTab) : "now";
    } catch {
      return "now";
    }
  };
  const [tab, setTabState] = useState<BoardTab>(read);
  const remember = (x: BoardTab) => {
    try {
      localStorage.setItem(TAB_KEY, x);
    } catch {
      /* 개인 정보 보호 모드 */
    }
  };
  useEffect(() => {
    // 주소에 탭이 없으면(#/ · #/board) 지금 탭을 주소에 붙여 둬요 → 뒤로 가기가 탭 사이를 오가요
    const fill = (x: BoardTab) => {
      if (/^(#\/?|#\/board\/?)?$/.test(location.hash)) history.replaceState(history.state, "", `${location.pathname}${location.search}#/board/${x}`);
    };
    fill(read());
    const h0 = boardTabFromHash(location.hash);
    if (h0) remember(h0); // 주소로 바로 들어와도 이 탭을 기억해요
    const on = () => {
      const h = boardTabFromHash(location.hash);
      if (h) {
        setTabState(h);
        remember(h);
      } else fill(read());
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const setTab = (x: BoardTab) => {
    setTabState(x);
    remember(x);
    const want = `#/board/${x}`;
    if (location.hash !== want) location.hash = want; // 뒤로 가기로 탭을 돌아가요
    window.scrollTo({ top: 0 });
  };
  return [tab, setTab];
}

export default function Dashboard({ data, today, selDate, setSelDate: setSelRaw, onOpen: openRaw, onNew: newRaw, onSimple: simpleRaw, notify, readOnly = false, minDate, maxDate, move = null, onMoveStart = () => {}, onMoveEnd = () => {} }: Props) {
  const setSelDate = (d: string) => setSelRaw(minDate && d < minDate ? minDate : maxDate && d > maxDate ? maxDate : d);
  const onOpen = readOnly ? () => {} : openRaw;
  const onNew = readOnly ? () => {} : newRaw;
  const onSimple = readOnly
    ? () => {}
    : (simpleRaw ??
        ((preset?: Partial<Booking>, opts?: { roomIds?: string[] }) =>
          onNew({ kind: "stay", roomId: opts?.roomIds?.[0] ?? null, ...preset })));
  const act = readOnly ? {} : { role: "button" as const, tabIndex: 0 };
  const [tab, setTab] = useBoardTab();
  const s = data.hotel!.settings;
  const { bookings } = data;
  const L = useMemo(() => lookups(s), [s]);
  const dates = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(today, i)), [today]);
  // 건물 탭(전체·건물별): 두 탭이 같이 쓰고, 이 기기에서 마지막으로 고른 건물을 기억해요
  const [bTab, setBTabState] = useState<string>(() => {
    try {
      return localStorage.getItem(B_KEY) ?? "all";
    } catch {
      return "all";
    }
  });
  const setBTab = (id: string) => {
    setBTabState(id);
    try {
      localStorage.setItem(B_KEY, id);
    } catch {
      /* 개인 정보 보호 모드 */
    }
  };
  const multi = isMultiBuilding(s);
  const bScope = multi && s.buildings.some((x) => x.id === bTab) ? bTab : "all";
  const scopeId = bScope === "all" ? null : bScope;
  const tableAll = useMemo(() => stockTable(s, bookings, dates), [s, bookings, dates]);
  const table = useMemo(() => (scopeId ? stockTable(s, bookings, dates, scopeId) : tableAll), [s, bookings, dates, scopeId, tableAll]);
  const totals = useMemo(() => typeTotals(s, scopeId), [s, scopeId]);
  /** 타입 여유 칩 = 호텔 전체 (건물 필터 독립 · 미배정 반영) */
  const totalsAll = useMemo(() => typeTotals(s), [s]);
  const over = firstOverbooking(s, table, dates);
  const overs = useMemo(() => allOverbookings(s, table, dates), [s, table, dates]);
  // 건물 하나를 보는 중이어도 호텔 전체에 오버부킹이 있으면 알려 줘요 (방 미배정 숙박 때문일 수 있어요)
  const overAll = scopeId ? firstOverbooking(s, tableAll, dates) : over;
  const oversAll = useMemo(() => (scopeId ? allOverbookings(s, tableAll, dates) : overs), [s, tableAll, dates, scopeId, overs]);
  const unassigned = useMemo(() => (scopeId ? unassignedStays(s, bookings, dates) : 0), [s, bookings, dates, scopeId]);

  // 판매 캘린더·객실 캘린더 기간: 주(기본 7일) · 14일 · 월 · 기간. 기기마다 기억. 공유 보기는 14일만.
  const [periodRaw, setPeriodRaw] = useState<StockPeriod>(() => {
    const v = lsGet(P_KEY);
    return isStockPeriod(v) ? v : "week"; // 판매 캘린더 기본 7일(주)
  });
  const period: StockPeriod = readOnly ? "d14" : periodRaw;
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustomRaw] = useState<{ from: string; to: string }>(() => {
    try {
      const v = JSON.parse(lsGet(R_KEY) ?? "null");
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.from) && /^\d{4}-\d{2}-\d{2}$/.test(v.to)) return clampRange(v.from, v.to);
    } catch {
      /* 무시 */
    }
    return { from: today, to: addDays(today, 29) };
  });
  const setCustom = (from: string, to: string) => {
    const c = clampRange(from, to);
    if (c.capped) notify(`기간은 최대 92일까지 볼 수 있어요. 끝 날짜를 ${dayLabel(c.to)}로 맞췄어요`);
    else if (c.swapped) notify("끝 날짜가 시작보다 앞이라 둘을 바꿔서 보여 드려요");
    setCustomRaw({ from: c.from, to: c.to });
    lsSet(R_KEY, JSON.stringify({ from: c.from, to: c.to }));
  };
  const setPeriod = (p: StockPeriod) => {
    setPeriodRaw(p);
    lsSet(P_KEY, p);
    setAnchor(today);
  };
  const view = readOnly ? { from: today, to: addDays(today, DAYS - 1) } : stockRange(period, anchor, custom);
  const viewDates = useMemo(() => dateList(view.from, view.to), [view.from, view.to]);
  const atToday = period === "range" ? custom.from === today : stockRange(period, today, custom).from === view.from;
  const shift = (dir: 1 | -1) => {
    if (period === "range") {
      const len = viewDates.length;
      const from = shiftStockAnchor("range", view.from, dir, custom);
      setCustom(from, addDays(from, len - 1));
    } else setAnchor(shiftStockAnchor(period, anchor, dir));
  };
  const goToday = () => {
    if (period === "range") setCustom(today, addDays(today, viewDates.length - 1));
    else setAnchor(today);
  };
  // 오래전 기간: 늘 들고 있는 예약(입실 오늘 − 120일부터)으로는 모자라서, 그 기간 숙박만 따로 불러와요
  const needOld = view.from < addDays(today, -(WINDOW_BACK - 90));
  const [old, setOld] = useState<{ key: string; list: Booking[] } | null>(null);
  const oldKey = `${view.from}~${view.to}`;
  useEffect(() => {
    if (!needOld || readOnly) return;
    let alive = true;
    queryStays(data.hotel!.id, view.from, view.to)
      .then((list) => alive && setOld({ key: oldKey, list }))
      .catch(() => alive && notify("지난 예약을 불러오지 못했어요. 잠시 뒤 다시 볼게요"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needOld, oldKey, data.syncedAt]);
  const viewLoading = needOld && old?.key !== oldKey;
  // needOld: 구간 조회 + 로컬 예약 합침 (저장 직후 old.list만 쓰면 판매 캘린더가 굳어요)
  const viewBookings = useMemo(() => {
    if (!needOld) return bookings;
    if (old?.key !== oldKey) return bookings;
    return mergeViewBookings(old.list, bookings);
  }, [needOld, old, oldKey, bookings]);
  const viewTable = useMemo(() => stockTable(s, viewBookings, viewDates, scopeId), [s, viewBookings, viewDates, scopeId]);
  const viewOvers = useMemo(() => allOverbookings(s, viewTable, viewDates), [s, viewTable, viewDates]);
  // 넓은 표(월·긴 기간): 오늘이 들어 있으면 오늘 열이 보이게 옆으로 밀어 둬요
  const wideRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = wideRef.current;
    if (!w || !w.classList.contains("wide")) return;
    const th = w.querySelector<HTMLElement>(".shead .th.td");
    const lab = w.querySelector<HTMLElement>(".shead .th.lab");
    if (!th) {
      w.scrollLeft = 0;
      return;
    }
    const x = th.getBoundingClientRect().left - w.getBoundingClientRect().left + w.scrollLeft - (lab?.offsetWidth ?? 0) - 8;
    w.scrollLeft = Math.max(0, x - 3 * th.offsetWidth); // 오늘 앞 사흘도 보이게
  }, [view.from, view.to, tab]);
  const board = useMemo(() => nightBoard(s, bookings, selDate), [s, bookings, selDate]);
  // 분 단위로 벽시계를 갱신 → 체크인 시각 자동 숙박 · 퇴실예정 윈도우가 보드에 반영
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const nowOpts = useMemo(() => ({ stayTimes: s.stayTimes, clock: hotelWallClock() }), [s.stayTimes, data.syncedAt, nowTick]);
  const nowBoardMap = useMemo(() => nowByRoom(bookings, today), [bookings, today]);
  const nowSide = useMemo(() => nowLists(bookings, today, nowOpts), [bookings, today, nowOpts]);
  const [coBusy, setCoBusy] = useState<string | null>(null);
  const [ncxBusy, setNcxBusy] = useState<string | null>(null);
  const [nowFilter, setNowFilter] = useState<"all" | "tentative">("all");
  const [tentBusy, setTentBusy] = useState(false);
  const [nightPopId, setNightPopId] = useState<string | null>(null);
  const [earlyBusy, setEarlyBusy] = useState<string | null>(null);
  /** 빠른 입실: 추가금 팝업 대상 (확정 전엔 arrived 안 바꿈) */
  const [earlyPay, setEarlyPay] = useState<{ booking: Booking; roomLabel: string } | null>(null);
  /** 퇴실처리 확인(+잔금 결제) 모달 */
  const [coConfirm, setCoConfirm] = useState<{ booking: Booking; members: Booking[] } | null>(null);
  const [memoRoomId, setMemoRoomId] = useState<string | null>(null);
  /** 대실 판매 전용 모달 (Entry 우회) */
  const [dayuseSale, setDayuseSale] = useState<{ roomId: string; typeId: string; roomLabel: string } | null>(null);
  const [dayuseSaleBusy, setDayuseSaleBusy] = useState(false);
  const [dayuseSaleWarn, setDayuseSaleWarn] = useState<{ input: DayuseSaleInput; message: string } | null>(null);
  /** 결제/납입 데스크 */
  const [payDesk, setPayDesk] = useState<{ members: Booking[]; focusId?: string } | null>(null);
  const [payDeskBusy, setPayDeskBusy] = useState(false);
  const [addTime, setAddTime] = useState<{ booking: Booking; roomLabel: string } | null>(null);
  const [addTimeBusy, setAddTimeBusy] = useState(false);
  /** 운영패널 1박 연장 (라이트 모달 · StaySale 비경유) */
  const [extendNight, setExtendNight] = useState<{ booking: Booking; roomLabel: string } | null>(null);
  const [extendNightBusy, setExtendNightBusy] = useState(false);
  /** 숙박 판매 전용 (StaySaleModal · SimpleBooking 금지) */
  const [staySale, setStaySale] = useState<{
    roomIds: string[];
    roomLabels: string[];
    occupied: Booking | null;
  } | null>(null);
  const [staySaleBusy, setStaySaleBusy] = useState(false);
  const [extendOverlap, setExtendOverlap] = useState<{
    booking: Booking;
    rate: number;
    hits: Booking[];
    /** ops 연장 시 결제 입력 (없으면 StaySale occupied 경로) */
    opsInput?: OpsExtendInput;
  } | null>(null);
  /** 「현황」선택: 공실=복수 토글 · 점유=단실 · 동일 groupId 점유만 복수 */
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  const [sideMode, setSideMode] = useState<SideMode>("simple");
  /** 글랜스/미니맵 → 칸 스크롤·하이라이트 */
  const [flashRoomId, setFlashRoomId] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  /** 「미니맵」펼침 (localStorage · 표면별) */
  const [glanceOpenNow, setGlanceOpenNow] = useState(() => {
    const v = lsGet(GLANCE_OPEN_KEY.now);
    if (v === "0") return false;
    if (v === "1") return true;
    return glanceOpenDefault();
  });
  const [glanceOpenRooms, setGlanceOpenRooms] = useState(() => {
    const v = lsGet(GLANCE_OPEN_KEY.rooms);
    if (v === "0") return false;
    if (v === "1") return true;
    return glanceOpenDefault();
  });
  const rememberGlanceOpen = (surface: GlanceSurface, open: boolean) => {
    if (surface === "now") setGlanceOpenNow(open);
    else setGlanceOpenRooms(open);
    lsSet(GLANCE_OPEN_KEY[surface], open ? "1" : "0");
  };
  /** 글랜스 칩 → 판매 캘린더 오늘·타입 포커스 */
  const [stockFocus, setStockFocus] = useState<{ typeId: string; date: string } | null>(null);
  /** 고객 이름·연락처 검색 (현황·배치 공통 · 칸 비율 무변경) */
  const [guestQuery, setGuestQuery] = useState("");
  const [guestQueryLive, setGuestQueryLive] = useState("");
  const [guestComposing, setGuestComposing] = useState(false);
  const [gsFocusRoomId, setGsFocusRoomId] = useState<string | null>(null);
  /** 미니맵 총/사용/남음 필터 (Option C · 사이드 목록 ❌) */
  const [occFilter, setOccFilter] = useState<GlanceOccFilter>(null);
  const gsScrollKey = useRef("");
  const guestSearchRef = useRef<HTMLInputElement | null>(null);
  const memos = useRoomMemos(data.hotel!.id);
  const glanceByRoom = useMemo(() => openMemoGlances(memos.list ?? []), [memos.list]);
  const roomIsVacant = (roomId: string) => {
    const bk = nowBoardMap.get(roomId);
    return !bk || !isActive(bk);
  };
  const flashRoom = (roomId: string, elId: string) => {
    document.getElementById(elId)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    setFlashRoomId(roomId);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashRoomId(null), 1600);
  };
  /** 남은 호수 칩 = 스크롤+flash만 (선택 Next · vacancy glance Q3) */
  const jumpToVacantRoom = (roomId: string) => {
    flashRoom(roomId, `now-room-${roomId}`);
  };
  /** 「배치」미니맵 = 스크롤+flash (칸 체크 배정은 유지 · 선택≠체크) */
  const jumpRoomsRoom = (roomId: string) => {
    flashRoom(roomId, `rooms-room-${roomId}`);
  };
  const jumpToTypeStock = (typeId: string, night: string = today) => {
    if (night === today) goToday();
    setSelDate(night);
    setStockFocus({ typeId, date: night });
    setTab("stock");
  };
  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    },
    [],
  );
  // 검색 디바운스 ~150ms · IME 조합 중에는 이전 확정값 유지
  useEffect(() => {
    if (guestComposing) return;
    const t = window.setTimeout(() => setGuestQuery(guestQueryLive), 150);
    return () => window.clearTimeout(t);
  }, [guestQueryLive, guestComposing]);
  const clearGuestSearch = () => {
    setGuestQueryLive("");
    setGuestQuery("");
    setGsFocusRoomId(null);
    gsScrollKey.current = "";
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!guestQueryLive && !guestQuery) return;
      e.preventDefault();
      clearGuestSearch();
      guestSearchRef.current?.blur();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guestQueryLive, guestQuery]);
  const gsRoomLabel = (roomId: string) => L.roomLabel(roomId) ?? allRooms(s).find((r) => r.id === roomId)?.no ?? roomId;
  const nowGuestSearch = useMemo(() => {
    const slots = allRooms(s).map((r) => ({ roomId: r.id, booking: nowBoardMap.get(r.id) ?? null }));
    return boardGuestSearch({
      slots,
      unassigned: nowSide.unassigned,
      groups: data.groups,
      queryRaw: guestQuery,
      roomLabel: gsRoomLabel,
    });
  }, [s, nowBoardMap, nowSide.unassigned, data.groups, guestQuery, L]);
  const roomsGuestSearch = useMemo(() => {
    const slots = [...board.byRoom.entries()].map(([roomId, booking]) => ({ roomId, booking }));
    return boardGuestSearch({
      slots,
      unassigned: board.unassigned,
      groups: data.groups,
      queryRaw: guestQuery,
      roomLabel: gsRoomLabel,
    });
  }, [board, data.groups, guestQuery, L]);
  const activeGuestSearch = tab === "now" ? nowGuestSearch : tab === "rooms" ? roomsGuestSearch : null;
  const gsActive = !!(activeGuestSearch?.active);
  const gsHitRooms = activeGuestSearch?.roomIds;
  const gsChips = activeGuestSearch?.chips ?? [];
  // 쿼리 변경 시 첫 매칭 칸으로 스크롤 (칩 탭은 별도)
  useEffect(() => {
    if (!gsActive || (tab !== "now" && tab !== "rooms")) return;
    const first = gsChips.find((c) => c.roomId)?.roomId ?? null;
    const key = `${tab}:${guestQuery}:${first ?? ""}`;
    if (!first || gsScrollKey.current === key) return;
    gsScrollKey.current = key;
    const id = tab === "now" ? `now-room-${first}` : `rooms-room-${first}`;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" }));
  }, [gsActive, gsChips, guestQuery, tab]);
  const gsCellClass = (roomId: string) => {
    if (gsActive && gsHitRooms) {
      if (gsHitRooms.has(roomId)) return gsFocusRoomId === roomId ? "gs-hit gs-focus" : "gs-hit";
      return "gs-dim";
    }
    if (!occFilter) return "";
    const vacant =
      tab === "now"
        ? roomIsVacant(roomId)
        : (() => {
            const bk = board.byRoom.get(roomId);
            return !bk || !occupiesRoom(bk);
          })();
    if (occFilter === "left") return vacant ? "" : "gs-dim";
    return vacant ? "gs-dim" : "";
  };
  /** 퇴실예정(미퇴실)이어도 오늘 입실 밤이 안 겹치면 당일 예약·배정 타깃 */
  const roomIsTurnoverBookable = (roomId: string) => {
    const bk = nowBoardMap.get(roomId);
    if (!bk || !isActive(bk)) return false;
    const f = nowFlags(bk, today, nowOpts);
    if (!isDepartingStatus(f.kind)) return false;
    return freeRooms(s, bookings, {
      id: "__turnover__",
      kind: "stay",
      checkIn: today,
      nights: 1,
      startTime: null,
      endTime: null,
    }).has(roomId);
  };
  const roomIsBookTarget = (roomId: string) => roomIsVacant(roomId) || roomIsTurnoverBookable(roomId);
  const selectRoom = (roomId: string) => {
    setNightPopId(null);
    setSideMode("room");
    // 퇴실예정 턴오버 가능 칸 = 공실과 같이 복수 선택(당일 예약).
    // 점유 = 단실 · 예외: 동일 groupId 점유실만 토글 복수 (일괄 수납).
    if (!roomIsBookTarget(roomId)) {
      const bk = nowBoardMap.get(roomId);
      const gid = bk?.groupId ?? null;
      if (gid && isActive(bk!)) {
        setSelectedRoomIds((prev) => {
          const prevBooks = prev.map((id) => nowBoardMap.get(id) ?? null);
          const prevGid = sameGroupId(prevBooks);
          if (prevGid === gid) {
            if (prev.includes(roomId)) {
              const next = prev.filter((id) => id !== roomId);
              return next.length ? next : [roomId];
            }
            return [...prev, roomId];
          }
          return [roomId];
        });
        return;
      }
      setSelectedRoomIds([roomId]);
      return;
    }
    setSelectedRoomIds((prev) => {
      const prevAllBook = prev.length > 0 && prev.every((id) => roomIsBookTarget(id));
      if (!prevAllBook) return [roomId];
      if (prev.includes(roomId)) return prev.filter((id) => id !== roomId);
      return [...prev, roomId];
    });
  };
  /** 미니맵 블럭 = 스크롤+flash+단실 선택 → 운영패널 */
  const jumpSelectNowRoom = (roomId: string) => {
    flashRoom(roomId, `now-room-${roomId}`);
    if (!readOnly) selectRoom(roomId);
  };
  const focusGuestChip = (chip: GuestSearchChip) => {
    if (!chip.roomId) return;
    setGsFocusRoomId(chip.roomId);
    const id = tab === "now" ? `now-room-${chip.roomId}` : `rooms-room-${chip.roomId}`;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    if (tab === "now" && !readOnly) selectRoom(chip.roomId);
  };
  const selectedVacantIds = selectedRoomIds.filter(roomIsBookTarget);
  const selectedRoomId =
    selectedRoomIds.length === 1
      ? selectedRoomIds[0]
      : selectedVacantIds.length
        ? selectedVacantIds[selectedVacantIds.length - 1]
        : selectedRoomIds[0] ?? null;
  const vacantBookLabels = selectedVacantIds.map((id) => L.roomLabel(id) ?? allRooms(s).find((r) => r.id === id)?.no ?? id);
  /** 라벨 = 「숙박 판매」만 (호수 접두 금지 · selection-first) */
  const staySaleCta =
    selectedVacantIds.length > 0 ||
    (selectedRoomIds.length === 1 &&
      (() => {
        const bk = nowBoardMap.get(selectedRoomIds[0]);
        return !!bk && isActive(bk) && bk.kind === "stay";
      })())
      ? "숙박 판매"
      : null;
  /** StaySaleModal · 공실/턴오버=신규 · 점유=연장·입·퇴 (SimpleBooking 금지) */
  const openStaySale = () => {
    if (readOnly) return;
    if (selectedVacantIds.length) {
      setStaySale({
        roomIds: selectedVacantIds,
        roomLabels: vacantBookLabels,
        occupied: null,
      });
      return;
    }
    if (selectedRoomIds.length !== 1) return;
    const bk = nowBoardMap.get(selectedRoomIds[0]);
    if (!bk || !isActive(bk) || bk.kind !== "stay") return;
    const lab = L.roomLabel(selectedRoomIds[0]) ?? allRooms(s).find((r) => r.id === selectedRoomIds[0])?.no ?? selectedRoomIds[0];
    setStaySale({ roomIds: selectedRoomIds, roomLabels: [lab], occupied: bk });
  };
  /** 현황 단실만 대실 판매 모달 (복수 공실 대실 = Next · Entry 금지) */
  const openNewDayuse = () => {
    if (readOnly || selectedRoomIds.length !== 1) return;
    const rid = selectedRoomIds[0];
    const room = L.rooms.get(rid) ?? allRooms(s).find((r) => r.id === rid);
    if (!room?.typeId) {
      notify("이 호실에 타입이 없어요. 설정에서 타입을 먼저 연결해 주세요.");
      return;
    }
    setDayuseSale({
      roomId: rid,
      typeId: room.typeId,
      roomLabel: L.roomLabel(rid) ?? room.no,
    });
  };
  const selectedGroupBookings = useMemo(() => {
    if (selectedRoomIds.length < 2) return [] as Booking[];
    const books = selectedRoomIds
      .map((id) => nowBoardMap.get(id) ?? null)
      .filter((b): b is Booking => !!b && isActive(b) && b.kind === "stay");
    if (books.length < 2) return [];
    return sameGroupId(books) ? books : [];
  }, [selectedRoomIds, nowBoardMap]);
  /** 선택 객실(단실·복수)의 단체 settle 멤버 — 칸/ops 정산 글랜스 SoT */
  const selectedSettle = useMemo(() => {
    if (selectedGroupBookings.length > 1) {
      const gid = selectedGroupBookings[0]!.groupId!;
      return { members: selectedGroupBookings, info: data.groups.get(gid) ?? null };
    }
    if (selectedRoomIds.length === 1) {
      const bk = nowBoardMap.get(selectedRoomIds[0]!);
      if (bk?.groupId && isActive(bk) && bk.kind === "stay") {
        const peers = groupStayPeers(bookings, bk.groupId);
        return { members: peers.length ? peers : [bk], info: data.groups.get(bk.groupId) ?? null };
      }
    }
    return { members: [] as Booking[], info: null as GroupInfo | null };
  }, [selectedGroupBookings, selectedRoomIds, nowBoardMap, bookings, data.groups]);
  /** 단체 잔금은 addGroupPayment → 형제 전부 members로 열어 settle/칸 SoT 맞춤 */
  const payDeskMembersFor = (bk: Booking): Booking[] => {
    if (!bk.groupId) return [bk];
    const peers = groupStayPeers(bookings, bk.groupId);
    return peers.length ? peers : [bk];
  };
  const openPaymentDesk = (b?: Booking) => {
    if (readOnly) return;
    if (b) {
      setPayDesk({ members: payDeskMembersFor(b), focusId: b.id });
      return;
    }
    if (selectedGroupBookings.length > 1) {
      setPayDesk({ members: selectedGroupBookings });
      return;
    }
    if (selectedRoomIds.length === 1) {
      const bk = nowBoardMap.get(selectedRoomIds[0]);
      if (bk && isActive(bk) && bk.kind === "stay") {
        setPayDesk({ members: payDeskMembersFor(bk), focusId: bk.id });
      }
    }
  };
  const nowDayuseByRoom = useMemo(() => dayuseByRoomMap(bookings, today), [bookings, today]);
  const selectedDayuse = selectedRoomIds.length === 1 ? (nowDayuseByRoom.get(selectedRoomIds[0]) ?? []) : [];
  const autoArriveBusy = useRef(new Set<string>());
  // 설정 체크인 시각 도달 → arrived 저장 (표시는 effectiveArrived로 즉시 숙박)
  useEffect(() => {
    if (readOnly) return;
    for (const b of bookings) {
      if (!shouldAutoArrive(b, today, nowOpts)) continue;
      if (autoArriveBusy.current.has(b.id)) continue;
      autoArriveBusy.current.add(b.id);
      void data
        .patchBooking(b.id, { arrived: true })
        .catch(() => {
          /* 다음 tick에 재시도 */
        })
        .finally(() => {
          autoArriveBusy.current.delete(b.id);
        });
    }
  }, [bookings, today, nowOpts, readOnly, data]);
  // 같은 방 같은 날 늦은 퇴실 → 입실 · 빠른 입실이 앞 손님과 겹치면 경고 (막지는 않아요)
  const turn = useMemo(() => {
    const m = new Map<string, TurnWarn[]>();
    for (const w of turnoverWarnings(s, bookings)) m.set(w.id, [...(m.get(w.id) ?? []), w]);
    return m;
  }, [s, bookings]);
  const roomCount = s.floors.reduce((n, f) => n + f.rooms.length, 0);
  const [floorTab, setFloorTab] = useState<string>("all");
  const [sideCollapsed, setSideCollapsed] = useState(() => lsGet(SIDE_COLLAPSE_KEY) === "1");
  const rememberSideCollapsed = (v: boolean) => {
    setSideCollapsed(v);
    lsSet(SIDE_COLLAPSE_KEY, v ? "1" : "0");
  };
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [typeConfirm, setTypeConfirm] = useState<{ booking: Booking; roomId: string } | null>(null);
  const [checkoutChoice, setCheckoutChoice] = useState<{
    booking: Booking;
    roomId: string;
    overlaps: Booking[];
  } | null>(null);
  /**
   * 「방배정」모드: 「배치」칸 체크 · 입실일로 보드 맞춤.
   * 건물 필터·층 칩은 유지 (배정 성공/단체 다음 건에서 별관→전체 리셋 금지).
   * continueNext: 같은 세션 이어가기 — 탭/층/스크롤 세션 유지, 입실일만 필요 시 맞춤.
   */
  const setAssigningMode = (id: string | null, opts?: { continueNext?: boolean }) => {
    setAssigning(id);
    setTypeConfirm(null);
    setCheckoutChoice(null);
    if (!id) return;
    const bk = bookings.find((x) => x.id === id && isActive(x) && !x.roomId);
    setSideMode("simple");
    if (opts?.continueNext) {
      if (bk && bk.checkIn !== selDate) setSelDate(bk.checkIn);
      return;
    }
    // 최초 진입만: 배치 탭 · 층=전체. 건물 탭(bTab)은 건드리지 않음.
    setFloorTab("all");
    if (bk) setSelDate(bk.checkIn);
    setTab("rooms");
  };
  // ---------- 객실 배치에서 옮기기 (+ 활성 투숙 맞교환) ----------
  const mvB = !readOnly && move ? (bookings.find((x) => x.id === move.id && isActive(x)) ?? null) : null;
  const mvNight = mvB ? (mvB.kind === "dayuse" ? mvB.checkIn : move!.night) : null;
  const [pick, setPick] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [swapChoice, setSwapChoice] = useState<RoomSwapPlan | null>(null);
  const [swapTypeGate, setSwapTypeGate] = useState<RoomSwapPlan | null>(null);
  const [dayuseMoveWarn, setDayuseMoveWarn] = useState<{ message: string; to: string } | null>(null);
  const targets = useMemo(() => (mvB && mvNight ? boardMoveTargets(s, bookings, mvB, mvNight) : new Set<string>()), [s, bookings, mvB, mvNight]);
  const swapTargets = useMemo(
    () => (mvB && mvNight && mvB.kind === "stay" ? boardSwapTargets(s, bookings, mvB, mvNight) : new Map<string, RoomSwapPlan>()),
    [s, bookings, mvB, mvNight],
  );
  const mvFrom = mvB && mvNight ? (mvB.kind === "stay" ? roomOnNight(mvB, mvNight) : mvB.roomId) : null;
  useEffect(() => {
    if (!move) {
      setPick(null);
      setSwapChoice(null);
      setSwapTypeGate(null);
      setDayuseMoveWarn(null);
      return;
    }
    // 옮길 예약이 없어졌거나 취소됐으면 끝
    if (!bookings.some((x) => x.id === move.id && isActive(x))) return onMoveEnd();
    const b = bookings.find((x) => x.id === move.id)!;
    setSelDate(b.kind === "dayuse" ? b.checkIn : move.night);
    setTab(move.tab === "now" ? "now" : "rooms");
    setFloorTab((f) => (f === "dayuse" ? "all" : f));
    setPick(null);
    setSwapChoice(null);
    setSwapTypeGate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move?.id, move?.night, move?.tab]);
  useEffect(() => {
    if (!mvB) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (swapChoice || swapTypeGate) {
        setSwapChoice(null);
        setSwapTypeGate(null);
        return;
      }
      if (pick) setPick(null);
      else onMoveEnd();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mvB, pick, swapChoice, swapTypeGate, onMoveEnd]);
  const roomName = (id: string | null | undefined) => {
    if (!id) return "방 미배정";
    const r = L.rooms.get(id);
    const sameB = !multi || !mvFrom || L.rooms.get(mvFrom)?.building?.id === r?.building?.id;
    return `${sameB ? (r?.no ?? "?") : (L.roomLabel(id) ?? "?")}호`;
  };
  const swapNeedsTypeConfirm = (plan: RoomSwapPlan) => {
    const aType = L.rooms.get(plan.toRoomId)?.typeId ?? null;
    const bType = L.rooms.get(plan.fromRoomId)?.typeId ?? null;
    return (plan.a.typeId ?? null) !== aType || (plan.b.typeId ?? null) !== bType;
  };
  /** A→Y · B→X · 중간 null로 unique 점유 충돌 회피 */
  const doSwap = async (plan: RoomSwapPlan) => {
    if (moving) return;
    const aBefore = placementOf(plan.a);
    const bBefore = placementOf(plan.b);
    setMoving(true);
    setSwapChoice(null);
    setSwapTypeGate(null);
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
      setPick(null);
      onMoveEnd();
      notify(
        `${plan.a.guestName || "손님"} ↔ ${plan.b.guestName || "손님"} 맞교환 · ${roomName(plan.toRoomId)}↔${roomName(plan.fromRoomId)}`,
      );
    } catch {
      notify("맞교환하지 못했어요. 다시 해 주세요");
    } finally {
      setMoving(false);
    }
  };
  const requestSwap = (plan: RoomSwapPlan) => {
    setPick(null);
    setSwapTypeGate(null);
    setSwapChoice(plan);
  };
  const confirmSwap = (plan: RoomSwapPlan) => {
    if (swapNeedsTypeConfirm(plan)) {
      setSwapChoice(null);
      setSwapTypeGate(plan);
      return;
    }
    void doSwap(plan);
  };
  const doMove = async (opts?: { allowDayuseOverlap?: boolean; to?: string }) => {
    const to = opts?.to ?? pick;
    if (!mvB || !mvNight || !to || moving) return;
    // 점유 방이면 맞교환 (빈 방만 여기로)
    const swap = swapTargets.get(to);
    if (swap) {
      requestSwap(swap);
      return;
    }
    const b = mvB;
    if (b.kind === "dayuse" && !opts?.allowDayuseOverlap) {
      const w = dayuseStayOverlapWarn(s, bookings, { ...b, roomId: to });
      if (!w.ok) {
        setDayuseMoveWarn({ message: w.message.replace("저장할까요?", "옮길까요?"), to });
        return;
      }
    }
    setDayuseMoveWarn(null);
    const before = placementOf(b);
    const after = boardMove(b, mvNight, to);
    const toName = roomName(to);
    const fromName = roomName(mvFrom);
    setMoving(true);
    try {
      await data.setPlacement(b.id, after);
      setPick(null);
      onMoveEnd();
      notify(`${toName}로 옮겼어요`, {
        ms: 6000,
        action: {
          label: "되돌리기",
          run: () =>
            void data
              .setPlacement(b.id, before)
              .then(() => notify(`${b.guestName} 님을 ${fromName}로 되돌렸어요`))
              .catch(() => notify("되돌리지 못했어요")),
        },
      });
    } catch {
      notify("옮기지 못했어요. 다시 해 주세요");
    } finally {
      setMoving(false);
    }
  };
  /** 현황 운영패널 · 단실 점유만 — 공실/복수 공실은 숨김.
   * night = checkIn: 퍼즐 맞교환·전체 이동 (today면 중간 밤 whole=false로 점유 타깃이 전부 죽음).
   * 퇴실예정/숙박/숙박예약 셀 상태 게이트 없음. */
  const startOpsRoomMove = () => {
    if (readOnly || selectedRoomIds.length !== 1) return;
    const rid = selectedRoomIds[0];
    const b = nowBoardMap.get(rid);
    if (!b || !isActive(b) || b.kind !== "stay") return;
    setAssigningMode(null);
    setSideMode("room");
    onMoveStart({ id: b.id, night: b.checkIn, tab: "now" });
  };
  const mvCellBits = (r: { id: string; typeId?: string | null; no: string }) => {
    const mvSwap = !!mvB && swapTargets.has(r.id);
    const mvOk = !!mvB && (targets.has(r.id) || mvSwap);
    const mvSame = mvOk && r.typeId === mvB!.typeId;
    const mvCls = mvB
      ? mvOk
        ? `mvt ${mvSwap ? "swap" : ""} ${mvSame ? "same" : ""} ${pick === r.id ? "pick" : ""}`
        : r.id === mvFrom
          ? "mvsrc"
          : "mvoff"
      : "";
    const mvClick = mvB
      ? () => {
          if (!mvOk) return;
          const plan = swapTargets.get(r.id);
          if (plan) requestSwap(plan);
          else setPick(r.id);
        }
      : null;
    const mvAttr = mvB ? (mvOk ? { role: "button" as const, tabIndex: 0, "aria-label": `${r.no}호로 옮기기` } : { "aria-disabled": true }) : act;
    return { mvSwap, mvOk, mvSame, mvCls, mvClick, mvAttr };
  };
  const mvBar =
    mvB && mvNight ? (
      <div className={`mvbar ${pick ? "ask" : ""}`} role="status">
        {pick ? (
          <>
            <span className="mvbq">
              <span>
                <b>{roomName(pick)}</b>로 이동할까요?
              </span>
            </span>
            <button className="btn green" disabled={moving} onClick={() => void doMove()} autoFocus>
              {moving ? "옮기는 중…" : "이동"}
            </button>
            <button className="btn line" disabled={moving} onClick={() => setPick(null)}>
              다른 방
            </button>
          </>
        ) : (
          <>
            <span className="mvbq">
              <span>
                <b>{mvB.guestName || "손님"}</b>님을 옮길 방·맞교환 방을 누르세요
              </span>
              <small>
                {mvB.kind === "dayuse"
                  ? `대실 ${mvB.startTime}~${mvB.endTime} · ${roomName(mvFrom)}`
                  : (() => {
                      const w = boardMoveWindow(mvB, mvNight);
                      return `${roomName(mvFrom)} · ${w.whole ? `${mvB.nights}박 전체` : `${w.from}박째 ${dayLabel(w.checkIn)}부터 ${w.nights}박`}`;
                    })()}
                {" · "}
                {targets.size || swapTargets.size
                  ? `빈 방 ${targets.size}곳${swapTargets.size ? ` · 맞교환 ${swapTargets.size}곳` : ""}`
                  : "옮길 수 있는 방이 없어요"}
              </small>
            </span>
            <button className="btn line" onClick={onMoveEnd}>
              취소 <kbd className="kbdh">Esc</kbd>
            </button>
          </>
        )}
      </div>
    ) : null;

  const dayuseByRoom = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const d of board.dayuse) if (d.roomId && isActive(d)) m.set(d.roomId, [...(m.get(d.roomId) ?? []), d]);
    return m;
  }, [board.dayuse]);
  const dayTotal = bookings
    .filter((b) => isActive(b) && b.checkIn === selDate)
    .reduce((n, b) => n + b.price, 0);

  if (!s.types.length || !roomCount)
    return (
      <main className="page">
        <div className="empty-setup">
          <h1>먼저 우리 호텔 객실을 등록해 주세요</h1>
          <p>설정에서 층, 방 번호, 객실 타입, 플랫폼을 한 번만 적으면 바로 장부를 쓸 수 있어요.</p>
          {readOnly ? null : (
            <a className="btn red" href="#/settings">
              설정으로 가기
            </a>
          )}
        </div>
      </main>
    );

  const goRooms = (d: string) => {
    setSelDate(d);
    setTab("rooms");
  };

  const assignBk = useMemo(() => {
    if (!assigning) return null;
    return bookings.find((x) => x.id === assigning && isActive(x) && !x.roomId) ?? null;
  }, [assigning, bookings]);

  const assignFree = useMemo(
    () => (assignBk ? freeRooms(s, bookings, assignBk) : null),
    [assignBk, s, bookings],
  );

  /** 기간 빈 방 전부(동·이타입). 점유 칸은 제외. */
  const assignEligible = useMemo(() => {
    if (!assignFree) return new Set<string>();
    return new Set(allRooms(s).filter((r) => assignFree.has(r.id)).map((r) => r.id));
  }, [assignFree, s]);

  useEffect(() => {
    if (assigning && !assignBk) setAssigning(null);
  }, [assigning, assignBk]);

  useEffect(() => {
    if (!assigning) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (checkoutChoice) setCheckoutChoice(null);
        else if (typeConfirm) setTypeConfirm(null);
        else setAssigningMode(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assigning, typeConfirm, checkoutChoice, multi]);

  const commitAssign = async (b: Booking, roomId: string) => {
    if (assignBusy) return;
    setAssignBusy(true);
    setTypeConfirm(null);
    setCheckoutChoice(null);
    try {
      await data.patchBooking(b.id, { roomId });
      notify(`${b.guestName} 님 → ${L.roomLabel(roomId)}호`);
      const siblings = b.groupId
        ? bookings.filter((u) => u.id !== b.id && u.groupId === b.groupId && isActive(u) && !u.roomId)
        : [];
      // 건물 필터·스크롤·배정 세션 유지 (#113/#114 survive-refresh)
      if (siblings.length) setAssigningMode(siblings[0].id, { continueNext: true });
      else setAssigning(null);
    } catch (e) {
      notify(saveFailMessage(e, "방을 배정하지 못했어요"));
    } finally {
      setAssignBusy(false);
    }
  };

  /** 동타입=즉시 · 이타입=승인 모달 */
  const gateTypeThenAssign = (b: Booking, roomId: string) => {
    const room = L.rooms.get(roomId) ?? allRooms(s).find((r) => r.id === roomId);
    if (!room) {
      notify("방을 찾지 못했어요");
      return;
    }
    if ((room.typeId ?? null) === (b.typeId ?? null)) {
      void commitAssign(b, roomId);
      return;
    }
    setTypeConfirm({ booking: b, roomId });
  };

  /** 덮어쓰기: 퇴실 건 roomId 유지 · 새 손님만 배정 (충돌 SoT가 checkedOut 제외) */
  const overwriteThenAssign = (b: Booking, roomId: string) => {
    setCheckoutChoice(null);
    gateTypeThenAssign(b, roomId);
  };

  /** 퇴실 숙박을 다른 방/미배정으로 옮긴 뒤 새 배정 */
  const relocateThenAssign = async (b: Booking, roomId: string, overlaps: Booking[], relocateTo: string | null) => {
    if (assignBusy) return;
    if (relocateTo) {
      for (const old of overlaps) {
        const draft = { ...old, roomId: relocateTo };
        if (legConflicts(bookings, draft).length) {
          notify(`${L.roomLabel(relocateTo) ?? relocateTo}호에 다른 투숙이 있어요. 다른 방이나 미배정을 골라 주세요.`);
          return;
        }
      }
    }
    setAssignBusy(true);
    setCheckoutChoice(null);
    try {
      for (const old of overlaps) {
        await data.patchBooking(old.id, { roomId: relocateTo });
      }
      const moved =
        relocateTo == null
          ? `${overlaps.map((o) => o.guestName).join(", ")} 님 → 미배정`
          : `${overlaps.map((o) => o.guestName).join(", ")} 님 → ${L.roomLabel(relocateTo)}호`;
      notify(moved);
      setAssignBusy(false);
      gateTypeThenAssign(b, roomId);
    } catch (e) {
      notify(saveFailMessage(e, "퇴실 숙박을 옮기지 못했어요"));
      setAssignBusy(false);
    }
  };

  /** 칩·체크 공통: 활성 겹침 하드 · 퇴실완료만 겹치면 선택 모달 · 타입 게이트 */
  const requestAssign = (b: Booking, roomId: string) => {
    if (readOnly || assignBusy) return;
    const room = L.rooms.get(roomId) ?? allRooms(s).find((r) => r.id === roomId);
    if (!room) {
      notify("방을 찾지 못했어요");
      return;
    }
    const draft = { ...b, roomId };
    if (legConflicts(bookings, draft).length) {
      notify("이 방에 투숙 중인 예약이 있어요. 퇴실처리하거나 그 예약을 옮긴 뒤 배정하세요.");
      return;
    }
    const overlaps = checkedOutRoomOverlaps(bookings, draft);
    if (overlaps.length) {
      setTypeConfirm(null);
      setCheckoutChoice({ booking: b, roomId, overlaps });
      return;
    }
    gateTypeThenAssign(b, roomId);
  };

  const renderAssignModals = () => (
    <>
      {dayuseMoveWarn ? (
        <DayuseStayOverlapConfirm
          message={dayuseMoveWarn.message}
          busy={moving}
          onCancel={() => setDayuseMoveWarn(null)}
          onContinue={() => {
            const to = dayuseMoveWarn.to;
            setDayuseMoveWarn(null);
            void doMove({ allowDayuseOverlap: true, to });
          }}
        />
      ) : null}
      {checkoutChoice ? (
        <AssignCheckoutChoice
          s={s}
          L={L}
          multi={multi}
          booking={checkoutChoice.booking}
          roomId={checkoutChoice.roomId}
          overlaps={checkoutChoice.overlaps}
          bookings={bookings}
          busy={assignBusy}
          onCancel={() => setCheckoutChoice(null)}
          onOverwrite={() => overwriteThenAssign(checkoutChoice.booking, checkoutChoice.roomId)}
          onRelocate={(to) => void relocateThenAssign(checkoutChoice.booking, checkoutChoice.roomId, checkoutChoice.overlaps, to)}
        />
      ) : null}
      {swapChoice ? (
        <AssignSwapConfirm
          L={L}
          plan={swapChoice}
          busy={moving}
          onCancel={() => setSwapChoice(null)}
          onConfirm={() => confirmSwap(swapChoice)}
        />
      ) : null}
      {swapTypeGate ? (
        <AssignTypeConfirm
          L={L}
          bookedTypeId={swapTypeGate.a.typeId}
          roomTypeId={(L.rooms.get(swapTypeGate.toRoomId) ?? allRooms(s).find((r) => r.id === swapTypeGate.toRoomId))?.typeId}
          roomLabel={L.roomLabel(swapTypeGate.toRoomId) ?? swapTypeGate.toRoomId}
          guestName={swapTypeGate.a.guestName}
          onCancel={() => setSwapTypeGate(null)}
          onApprove={() => void doSwap(swapTypeGate)}
        />
      ) : null}
      {typeConfirm ? (
        <AssignTypeConfirm
          L={L}
          bookedTypeId={typeConfirm.booking.typeId}
          roomTypeId={(L.rooms.get(typeConfirm.roomId) ?? allRooms(s).find((r) => r.id === typeConfirm.roomId))?.typeId}
          roomLabel={L.roomLabel(typeConfirm.roomId) ?? typeConfirm.roomId}
          guestName={typeConfirm.booking.guestName}
          onCancel={() => setTypeConfirm(null)}
          onApprove={() => void commitAssign(typeConfirm.booking, typeConfirm.roomId)}
        />
      ) : null}
    </>
  );

  const pickGroupColor = (groupId: string) => async (c: GroupBadgeColor) => {
    const g = data.groups.get(groupId) ?? emptyGroupInfo(groupId);
    try {
      await data.saveGroupInfo(groupId, {
        payMode: g.payMode,
        dueOn: g.dueOn,
        payerCompany: g.payerCompany,
        payerName: g.payerName,
        payerPhone: g.payerPhone,
        rates: g.rates,
        extras: g.extras,
        badgeColor: c,
      });
    } catch {
      notify("단체 뱃지 색을 저장하지 못했어요");
    }
  };

  const roomCell = (r: (typeof s.floors)[number]["rooms"][number], fColor: string | null | undefined) => {
    const b = board.byRoom.get(r.id);
    const t = r.typeId ? L.types.get(r.typeId) : null;
    const du = dayuseByRoom.get(r.id) ?? [];
    const strip = pastelColor(r.color ?? fColor ?? null);
    const k = /^\d+$/.test(r.no) ? "" : "k";
    const head = (
      <div className={`r1 ${strip ? "strip" : ""}`} style={strip ? { background: strip } : undefined}>
        <FitText className={`no ${k}`} text={r.no} />
      </div>
    );
    const typeRow = (guests?: number | null) => <TypeRow t={t} guests={guests} />;
    const duTags = du.map((d) => (
      <span key={d.id} className="du">
        대실 {d.startTime}~{d.endTime}
      </span>
    ));
    // 옮기는 중: 빈 방(초록) · 맞교환 가능 점유(파란빛) · 같은 타입 더 진하게 · 나머지 흐리게
    const { mvSame, mvCls, mvClick, mvAttr } = mvCellBits(r);
    // 「방배정」: 빈 칸 체크 (옮기기 중이면 옮기기 우선)
    const canAssign = !mvB && !!assignBk && assignEligible.has(r.id);
    const sameType = canAssign && r.typeId === assignBk!.typeId;
    const assignMode = !mvB && !!assignBk;
    const assignCls = assignMode
      ? canAssign
        ? sameType
          ? "assign-ok"
          : "assign-other"
        : "assign-off"
      : "";
    const gs = gsCellClass(r.id);
    const flash = flashRoomId === r.id;
    if (!b)
      return (
        <div
          key={r.id}
          id={`rooms-room-${r.id}`}
          data-room-id={r.id}
          {...mvAttr}
          className={`cell em ${du.length ? "duc" : ""} ${du.some((d) => d.arrived) ? "in" : ""} ${flash ? "nowflash" : ""} ${gs} ${readOnly ? "ro" : ""} ${mvCls} ${assignCls}`}
          onClick={
            mvClick ??
            (() => {
              if (assignMode) {
                if (canAssign) requestAssign(assignBk!, r.id);
                return;
              }
              onNew({ checkIn: selDate, roomId: r.id, typeId: r.typeId ?? undefined });
            })
          }
          onKeyDown={mvClick ? (e) => e.key === "Enter" && mvClick() : undefined}
        >
          {canAssign ? (
            <label className="board-assign-check" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={false}
                disabled={assignBusy}
                aria-label={`${r.no}호에 배정${sameType ? "" : " (타입 다름)"}`}
                onChange={() => requestAssign(assignBk!, r.id)}
              />
            </label>
          ) : null}
          {head}
          {typeRow()}
          <div className="emt">{mvSame ? "같은 타입" : sameType ? "같은 타입" : "빈 방"}</div>
          {duTags.length ? <div className="dus">{duTags}</div> : null}
        </div>
      );
    const nth = Math.round((Date.parse(selDate) - Date.parse(b.checkIn)) / 864e5) + 1;
    const cancelled = !isActive(b);
    const sold = b.typeId !== r.typeId ? L.types.get(b.typeId) : null;
    // 객실 이동: 이 방 구간 앞뒤 방을 짧게 (예: 301→ · →305)
    const legs = legsOf(b);
    const li = legs.findIndex((l) => l.roomId === r.id && l.checkIn <= selDate && selDate < addDays(l.checkIn, l.nights));
    const no = (id: string | null | undefined) => (id ? (L.rooms.get(id)?.no ?? "?") : "?");
    // 주차 표시: 칸 위 테두리에 작은 탭 (대실 표시처럼 칸 크기는 그대로) · 휴대폰은 아이콘
    const pm =
      s.parking.enabled && isActive(b) && parkingMark(b) ? (
        <span className={`pmark ptab ${b.arrival === "walk" ? "walk" : ""}`} title={b.arrival === "car" ? `차량 ${b.cars ?? 1}대` : "도보"} aria-label={b.arrival === "car" ? `차량 ${b.cars ?? 1}대` : "도보"}>
          <i className="pm-t">{parkingMark(b)}</i>
          <span className="pm-i">
            {b.arrival === "car" ? <Car size={10} strokeWidth={2.6} /> : <Footprints size={10} strokeWidth={2.6} />}
            {b.arrival === "car" && (b.cars ?? 1) > 1 ? b.cars : null}
          </span>
        </span>
      ) : null;
    const mvTag = legs.length > 1 && li >= 0 ? [li > 0 ? `${no(legs[li - 1].roomId)}→` : "", li < legs.length - 1 ? `→${no(legs[li + 1].roomId)}` : ""].filter(Boolean).join(" ") : null;
    // 배정 모드: 기간이 비면(퇴실예정 턴오버 등) 점유 칸도 체크 · 아니면 흐리게
    const canAssignOcc = !mvB && !!assignBk && assignEligible.has(r.id);
    const sameTypeOcc = canAssignOcc && r.typeId === assignBk!.typeId;
    const occAssignCls = assignMode
      ? canAssignOcc
        ? sameTypeOcc
          ? "assign-ok"
          : "assign-other"
        : "assign-off"
      : "";
    return (
      <div
        key={r.id}
        id={`rooms-room-${r.id}`}
        data-room-id={r.id}
        {...mvAttr}
        className={`cell bk ${b.groupId ? "grp" : ""} ${cancelled ? "cx" : du.length ? "st hasdu" : "st"} ${!cancelled && b.arrived ? "in" : ""} ${!cancelled && b.tentative ? "tent" : ""} ${!cancelled && b.noClean ? "ncx" : ""} ${flash ? "nowflash" : ""} ${gs} ${readOnly ? "ro" : ""} ${mvCls} ${occAssignCls}`}
        onClick={
          mvClick ??
          (() => {
            if (assignMode) {
              if (canAssignOcc) requestAssign(assignBk!, r.id);
              return;
            }
            onOpen(b, selDate);
          })
        }
        onKeyDown={mvClick ? (e) => e.key === "Enter" && mvClick() : undefined}
      >
        {canAssignOcc ? (
          <label className="board-assign-check" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={false}
              disabled={assignBusy}
              aria-label={`${r.no}호에 배정${sameTypeOcc ? "" : " (타입 다름)"}`}
              onChange={() => requestAssign(assignBk!, r.id)}
            />
          </label>
        ) : null}
        {!cancelled && du.length ? (
          <span className="dumark" title={du.map((d) => `대실 ${d.startTime}~${d.endTime}`).join(" · ")}>
            <i>대실 </i>
            {du[0].startTime}
            {du.length > 1 ? <em> +{du.length - 1}</em> : null}
          </span>
        ) : null}
        {pm}
        {head}
        {typeRow(cancelled ? null : b.guests)}
        <div className="nm">
          <PlatBadge p={L.plats.get(b.platformId)} />
          <span className="gn">{b.guestName}</span>
          {!cancelled && isWalkInPlaceholderName(b.guestName) ? (
            <span className="wiittag" title="바로 입실 · 이름·연락처 미입력">
              바로입실
            </span>
          ) : null}
          {!cancelled && b.noClean ? <span className="ncxtag" title="청소하지 않음">청소X</span> : null}
          {!cancelled && b.tentative ? <span className="tenttag" title="임시 배치 · 재고는 막혀 있어요">임시</span> : null}
          {b.groupId ? (
            <GroupBadge
              groupName={b.groupName}
              color={data.groups.get(b.groupId)?.badgeColor}
              readOnly={readOnly}
              onPick={pickGroupColor(b.groupId)}
            />
          ) : null}
        </div>
        <div className="r3 rp">
          {readOnly ? (
            <span />
          ) : (
            ((plat) => {
              const ps = cancelled || b.groupId ? null : payState(b, plat);
              const left = ps?.left ?? 0;
              const tone = cancelled || b.groupId ? "paid" : nowAmountTone(b, plat);
              if (left > 0) {
                return (
                  <span className={`pr tone-${tone}`} title={isLongStay(b) ? `미수 ${won(left)}원` : `판매 가격 ${won(b.price)}원`}>
                    {isLongStay(b) ? "미수" : "잔금"} {won(left)}
                  </span>
                );
              }
              if (isLongStay(b)) return <span className="pr muted">장기</span>;
              return <span className={`pr tone-${tone}`}>{won(b.price)}</span>;
            })(L.plats.get(b.platformId))
          )}
          {cancelled ? <span className="cxt">{STATUS[b.status]}</span> : mvTag ? <span className="up mvt" title={`객실 이동 ${L.stayRoomLabel(b)}`}>{mvTag}</span> : sold ? <span className="up">{typeLabel(sold)}로 판매</span> : null}
        </div>
        {((tags, ws) => (
          <div className="r3">
            {ws.length ? (
              <span className="ttag warn" title={ws.map((w) => `${w.text} (${dayLabel(w.date)})`).join(" · ")}>
                {ws[0].text}
              </span>
            ) : (
              <span className="nownights-acc">
                {(() => {
                  const n = usedNights(b) ?? b.nights ?? 1;
                  if (n <= 1) return "1박";
                  return `${nth}/${n}박`;
                })()}
              </span>
            )}
            {tags.length ? (
              <span className="ttags">
                {tags.map((x) => (
                  <span key={x} className="ttag">
                    {x}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        ))(
          cancelled
            ? []
            : [
                ...(nth === 1 && clampHours(b.earlyIn) ? [`빠른 ${inTimeOf(s, b)}`] : []),
                ...(nth === b.nights && !isEarlyOut(b) && clampHours(b.lateOut) ? [`늦은 ${outTimeOf(s, b)}`] : []),
              ],
          cancelled ? [] : (turn.get(b.id) ?? []).filter((w) => w.date === selDate || w.date === addDays(selDate, 1)),
        )}
        {cancelled && duTags.length ? <div className="dus">{duTags}</div> : null}
      </div>
    );
  };

  const scopeFloors = orderedFloors(s).filter((f) => f.rooms.length && (bScope === "all" || f.buildingId === bScope));
  const floors = scopeFloors.filter((f) => floorTab === "all" || floorTab === f.id);
  const groups = (multi ? s.buildings : s.buildings.slice(0, 1))
    .map((bd) => ({ bd, floors: multi ? floors.filter((f) => f.buildingId === bd.id) : floors }))
    .filter((g) => g.floors.length);
  const nightIn = (fl: typeof floors) => fl.reduce((n, f) => n + f.rooms.filter((r) => { const x = board.byRoom.get(r.id); return x && isActive(x); }).length, 0);
  const roomsIn = (fl: typeof floors) => fl.reduce((n, f) => n + f.rooms.length, 0);
  const activeDayuse = board.dayuse.filter(isActive).length;

  const tabCount = 4 + (s.parking.enabled ? 1 : 0); // 현황 · 판매 캘린더 · 배치 · 캘린더 (+주차)
  const tabs = (
    <div className={`boardtabs seg n${tabCount}`} role="tablist" aria-label="현황판">
      <button role="tab" aria-selected={tab === "now"} className={tab === "now" ? "on" : ""} onClick={() => setTab("now")}>
        현황
        {nowSide.tentative.length ? (
          <span className="obdot tentdot num" aria-label={`임시 ${nowSide.tentative.length}건`}>
            {nowSide.tentative.length}
          </span>
        ) : null}
      </button>
      <button role="tab" aria-selected={tab === "stock"} className={tab === "stock" ? "on" : ""} onClick={() => setTab("stock")}>
        판매 캘린더
        {(over ? overs : oversAll).length ? (
          <span className="obdot num" aria-label={`오버부킹 ${(over ? overs : oversAll).length}건`}>
            {(over ? overs : oversAll).length}
          </span>
        ) : null}
      </button>
      <button role="tab" aria-selected={tab === "rooms"} className={tab === "rooms" ? "on" : ""} onClick={() => setTab("rooms")}>
        배치
      </button>
      <button role="tab" aria-selected={tab === "calendar"} className={tab === "calendar" ? "on" : ""} onClick={() => setTab("calendar")}>
        캘린더
      </button>
      {s.parking.enabled ? (
        <button role="tab" aria-selected={tab === "parking"} className={tab === "parking" ? "on" : ""} onClick={() => setTab("parking")}>
          주차
        </button>
      ) : null}
    </div>
  );
  // 오버부킹이 하나라도 있으면 맨 위 빨간 알림 (누르면 판매 캘린더)
  const bName = (id: string) => (id === "all" ? "전체" : (L.buildings.get(id)?.name ?? ""));
  const shownOver = over ?? overAll;
  const shownOvers = over ? overs : oversAll;
  const banner = shownOver ? (
    <button
      className="ob-banner"
      role="alert"
      onClick={() => {
        if (!over) setBTab("all"); // 이 건물엔 없고 전체에 있으면 전체로
        setTab("stock");
      }}
    >
      <TriangleAlert size={18} strokeWidth={2.4} />
      <span>
        <b>
          {scopeId ? `${bName(over ? bScope : "all")} · ` : ""}
          {dayLabel(shownOver.date)} {typeLabel(shownOver.type)} {shownOver.over}실 초과
        </b>
        {shownOvers.length > 1 ? <span className="ob-more"> 외 {shownOvers.length - 1}건</span> : null}
        <span className="hl-tail"> — 메인 플랫폼에서 마감해 주세요</span>
      </span>
    </button>
  ) : null;
  const buildingTabs = multi ? (
    <div className="btabs" role="tablist" aria-label="건물">
      {["all", ...s.buildings.map((x) => x.id)].map((id) => (
        <button
          key={id}
          role="tab"
          aria-selected={bScope === id}
          className={bScope === id ? "on" : ""}
          title={bName(id)}
          onClick={() => {
            setBTab(id);
            if (floorTab !== "dayuse") setFloorTab("all");
          }}
        >
          <span className="bn">{bName(id)}</span>
          {id !== "all" ? <small>{roomsIn(orderedFloors(s).filter((f) => f.buildingId === id))}</small> : null}
        </button>
      ))}
    </div>
  ) : null;
  /** 현황·배치 공통 고객 검색 (건물 칩 근처 · sticky · Lucide Search) */
  const guestSearchBar =
    tab === "now" || tab === "rooms" ? (
      <div className="guest-search-bar" role="search">
        <label className="search ls guest-search">
          <Search size={16} strokeWidth={2.2} aria-hidden />
          <input
            ref={guestSearchRef}
            value={guestQueryLive}
            placeholder="손님 이름·연락처"
            aria-label="손님 이름·연락처 검색"
            enterKeyHint="search"
            onChange={(e) => setGuestQueryLive(e.target.value)}
            onCompositionStart={() => setGuestComposing(true)}
            onCompositionEnd={(e) => {
              setGuestComposing(false);
              setGuestQueryLive(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                clearGuestSearch();
              }
            }}
          />
          {guestQueryLive ? (
            <button type="button" className="guest-search-x" aria-label="검색 지우기" onClick={clearGuestSearch}>
              <X size={14} strokeWidth={2.4} aria-hidden />
            </button>
          ) : null}
        </label>
        {gsActive && gsChips.length === 0 ? <span className="guest-search-none">없음</span> : null}
        {gsChips.length ? (
          <div className="guest-search-chips" role="list" aria-label="검색 결과">
            {gsChips.map((c) => (
              <button
                key={c.key}
                type="button"
                role="listitem"
                className={`chip sm ${c.roomId && gsFocusRoomId === c.roomId ? "on" : ""}`}
                disabled={!c.roomId}
                title={c.roomId ? `${c.labelName} · ${c.labelRoom}` : `${c.labelName} · 미배정`}
                onClick={() => focusGuestChip(c)}
              >
                {c.labelName} · {c.labelRoom}
                {c.roomId ? "호" : ""}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    ) : null;

  // 판매 캘린더와 객실 캘린더는 보는 기간(주·14일·월·기간)을 함께 써요
  const periodSeg = readOnly ? null : (
    <div className="seg period" role="tablist" aria-label="보는 기간">
      {PERIODS.map((p) => (
        <button key={p.id} role="tab" aria-selected={period === p.id} className={period === p.id ? "on" : ""} onClick={() => setPeriod(p.id)}>
          {p.label}
        </button>
      ))}
    </div>
  );
  const rangeNav = readOnly ? null : (
    <div className="rnav">
      <button className="ar" aria-label="이전" onClick={() => shift(-1)}>
        <ChevronLeft size={16} />
      </button>
      {period === "range" ? (
        <span className="rnav-r">
          <DateChip value={custom.from} label="시작 날짜" onChange={(v) => setCustom(v, custom.to < v ? v : custom.to)} />
          <span className="muted">~</span>
          <DateChip value={custom.to} label="끝 날짜" onChange={(v) => setCustom(custom.from, v)} />
        </span>
      ) : (
        <b className="rnav-l">{stockRangeLabel(period, view.from, view.to, today)}</b>
      )}
      <button className="ar" aria-label="다음" onClick={() => shift(1)}>
        <ChevronRight size={16} />
      </button>
      <button className="btn sm" disabled={atToday} onClick={goToday}>
        오늘
      </button>
      <span className="rnav-n muted">
        {period === "range" ? `${viewDates.length}일` : null}
        {viewLoading ? " 불러오는 중…" : null}
      </span>
      {viewOvers.length && !(period === "d14" && view.from === today) ? (
        <span className="rnav-o">이 기간 오버부킹 {viewOvers.length}건</span>
      ) : null}
    </div>
  );

  const confirmAllTentative = async () => {
    if (readOnly || tentBusy || !nowSide.tentative.length) return;
    setTentBusy(true);
    try {
      await data.confirmTentative(nowSide.tentative.map((b) => b.id));
      notify(`임시 ${nowSide.tentative.length}건을 확정했어요`);
      setNowFilter("all");
    } catch {
      notify("임시 확정에 실패했어요. 다시 해 주세요");
    } finally {
      setTentBusy(false);
    }
  };

  /** 빠른 입실 팝업 확정: arrived + hours + (금액>0이면 판매가·수납) */
  const confirmEarlyIn = async (plan: EarlyInPayPlan, method: EarlyInPayMethod) => {
    if (!earlyPay || earlyBusy) return;
    const b = earlyPay.booking;
    setEarlyBusy(b.id);
    try {
      const nextEarly = plan.hours > 0 ? clampHours((b.earlyIn ?? 0) + plan.hours) || plan.hours : b.earlyIn;
      const nextPrice = plan.priceDelta > 0 ? Math.round(b.price) + plan.priceDelta : b.price;
      const nextFee =
        plan.priceDelta > 0 ? Math.max(0, Math.round(b.timeFee ?? 0) + plan.priceDelta) : b.timeFee;
      if (plan.hours > 0 || plan.priceDelta > 0) {
        await data.saveBooking(
          { ...b, arrived: true, earlyIn: nextEarly, price: nextPrice, timeFee: nextFee },
          false,
        );
      } else {
        await data.patchBooking(b.id, { arrived: true });
      }
      if (plan.collectAmount > 0 && plan.method) {
        try {
          await data.addPayment(b.id, {
            kind: "balance",
            method: plan.method,
            amount: plan.collectAmount,
            bizDate: today,
            note: plan.payNote,
          });
        } catch (e) {
          setEarlyPay(null);
          notify(
            `${earlyInPayNotifyLine(b.guestName, { ...plan, collectAmount: 0, method: null, payNote: null }, method)} · 수납은 못 했어요: ${e instanceof Error ? e.message : "다시 받아 주세요"}`,
          );
          return;
        }
      }
      setEarlyPay(null);
      notify(earlyInPayNotifyLine(b.guestName, plan, method));
    } catch {
      notify("빠른 입실을 저장하지 못했어요. 다시 해 주세요");
    } finally {
      setEarlyBusy(null);
    }
  };

  /** 퇴실처리 본문(확인·결제 이후). 공실은 절대 자동이 아님. */
  const commitCheckOut = async (b: Booking, notifyLine?: string) => {
    if (readOnly || coBusy || !canCheckOut(b, today)) return;
    setCoBusy(b.id);
    try {
      const patch: Parameters<typeof data.patchBooking>[1] = { checkedOutAt: new Date().toISOString(), arrived: true };
      if (isLongStay(b) && stayEnd(b) > today) {
        const n = nightsAtCheckout(b.checkIn, today);
        patch.nights = n;
        patch.segments = fitSegments(b.segments, b.roomId, n);
      }
      await data.patchBooking(b.id, patch);
      notify(notifyLine ?? `${b.guestName} 님 퇴실처리했어요`);
    } catch {
      notify("퇴실처리를 저장하지 못했어요. 다시 해 주세요");
    } finally {
      setCoBusy(null);
    }
  };

  /** 퇴실처리: 칸·패널은 확인 필수 · 잔금 있으면 결제 UI 동시 · Hotori 모달 */
  const doCheckOut = async (b: Booking, needConfirm = false) => {
    if (readOnly || coBusy || !canCheckOut(b, today)) return;
    if (needConfirm) {
      setCoConfirm({ booking: b, members: payDeskMembersFor(b) });
      return;
    }
    await commitCheckOut(b);
  };

  const closeCoConfirm = () => {
    if (coBusy) return;
    setCoConfirm(null);
  };

  const confirmCheckoutOnly = async () => {
    if (!coConfirm) return;
    const b = coConfirm.booking;
    const members = coConfirm.members.map((m) => data.bookings.find((x) => x.id === m.id) ?? m);
    const plat = L.plats.get(b.platformId);
    const gid = b.groupId;
    const info = gid ? data.groups.get(gid) ?? null : null;
    const glanceLeft = gid
      ? settle(members, info, plat).left
      : payState(b, plat).left;
    setCoConfirm(null);
    await commitCheckOut(
      b,
      glanceLeft > 0 ? checkoutLeaveBalanceNotifyLine(b.guestName, glanceLeft) : undefined,
    );
  };

  const confirmCheckoutPayThen = async (plan: PaymentDeskPayPlan) => {
    if (!coConfirm || coBusy) return;
    const b = coConfirm.booking;
    const members = coConfirm.members.map((m) => data.bookings.find((x) => x.id === m.id) ?? m);
    setCoBusy(b.id);
    try {
      if (plan.asGroup) {
        const gid = sameGroupId(members);
        if (!gid) {
          notify("같은 단체만 한 번에 받을 수 있어요.");
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
      const patch: Parameters<typeof data.patchBooking>[1] = { checkedOutAt: new Date().toISOString(), arrived: true };
      if (isLongStay(b) && stayEnd(b) > today) {
        const n = nightsAtCheckout(b.checkIn, today);
        patch.nights = n;
        patch.segments = fitSegments(b.segments, b.roomId, n);
      }
      await data.patchBooking(b.id, patch);
      setCoConfirm(null);
      notify(checkoutPayNotifyLine(b.guestName, plan.amount, plan.method, plan.asGroup));
    } catch (e) {
      notify(saveFailMessage(e, "결제·퇴실처리를 저장하지 못했어요"));
    } finally {
      setCoBusy(null);
    }
  };

  /** 칸 하단 「숙박예약」탭 → 숙박 (수동 입실 전환 · 자동 모드에서도 즉시 가능) */
  const markArrivedFromStatus = async (b: Booking) => {
    if (readOnly || b.arrived || b.kind !== "stay" || !isActive(b)) return;
    try {
      await data.patchBooking(b.id, { arrived: true });
      notify(`${b.guestName} 님 · 숙박`);
    } catch {
      notify("입실 전환을 저장하지 못했어요. 다시 눌러 주세요.");
    }
  };

  /** 퇴실처리 되돌리기: checkedOutAt null · 결제 불변 · 충돌 시 차단 */
  const doUndoCheckOut = async (b: Booking) => {
    if (readOnly || coBusy) return;
    const live = data.bookings.find((x) => x.id === b.id) ?? b;
    const block = checkoutUndoBlock(data.bookings, live, today, (id) => L.roomLabel(id));
    if (block) {
      notify(block, { ms: 7000 });
      return;
    }
    const roomLab = live.roomId ? L.roomLabel(live.roomId) ?? "" : "";
    const ok = await askConfirm({
      title: CHECKOUT_UNDO_TITLE,
      body: checkoutUndoConfirmBody(live, roomLab),
      confirmLabel: CHECKOUT_UNDO_CTA,
    });
    if (!ok) return;
    setCoBusy(live.id);
    try {
      await data.patchBooking(live.id, restoreCheckoutPatch());
      notify(`${live.guestName} 님 퇴실처리를 되돌렸어요`);
    } catch {
      notify("퇴실처리 되돌리기를 저장하지 못했어요. 다시 해 주세요");
    } finally {
      setCoBusy(null);
    }
  };

  /** 대실 이용 종료: Hotori 확인 → checkedOutAt · 숙박 칸/상태 불변 · 슬롯만 해제 */
  const doEndDayuse = async (b: Booking) => {
    if (readOnly || coBusy || !canEndDayuse(b)) return;
    const room = b.roomId ? L.roomLabel(b.roomId) ?? "" : "";
    const when = b.startTime && b.endTime ? `${b.startTime}~${b.endTime}` : "";
    const ok = await askConfirm({
      title: "이용 종료",
      body: `대실 이용을 종료할까요?\n${room ? `${room}호 · ` : ""}${b.guestName}${when ? ` · ${when}` : ""}`,
      confirmLabel: "이용 종료",
      danger: true,
    });
    if (!ok) return;
    setCoBusy(b.id);
    try {
      await data.patchBooking(b.id, { checkedOutAt: new Date().toISOString(), arrived: true });
      notify(`${b.guestName} 님 대실 이용을 종료했어요`);
    } catch {
      notify("이용 종료를 저장하지 못했어요. 다시 해 주세요");
    } finally {
      setCoBusy(null);
    }
  };

  /** 청소 요청 팝업 확정 → noClean patch (즉시 토글 금지) */
  const setNoClean = async (b: Booking, noClean: boolean) => {
    if (readOnly || ncxBusy || b.kind !== "stay") return;
    if (!!b.noClean === noClean) return;
    setNcxBusy(b.id);
    try {
      await data.patchBooking(b.id, { noClean });
      notify(noClean ? `${b.guestName} 님 · 청소 안 함` : `${b.guestName} 님 · 청소 함`);
    } catch {
      notify("청소 요청을 저장하지 못했어요. 다시 눌러 주세요.");
    } finally {
      setNcxBusy(null);
    }
  };

  const commitDayuseSale = async (input: DayuseSaleInput, allowOverlap: boolean) => {
    if (readOnly || dayuseSaleBusy) return;
    const planned = planDayuseSale(s, input);
    if ("err" in planned) {
      notify(planned.err);
      return;
    }
    if (!allowOverlap) {
      const w = dayuseStayOverlapWarn(s, bookings, planned.booking);
      if (!w.ok) {
        setDayuseSaleWarn({ input, message: w.message });
        return;
      }
    }
    setDayuseSaleBusy(true);
    setDayuseSaleWarn(null);
    try {
      const draft = buildDayuseSaleBooking(s, input);
      const saved = await data.saveBooking(draft, true);
      let collected = false;
      if (planned.collectAmount > 0 && planned.method) {
        try {
          await data.addPayment(saved.id, {
            kind: "balance",
            method: planned.method,
            amount: planned.collectAmount,
            bizDate: today,
          });
          collected = true;
        } catch (e) {
          notify(
            `${dayuseSaleNotifyLine(saved.guestName, dayuseSale?.roomLabel ?? "", saved.price, false, null)} · 수납은 못 했어요: ${e instanceof Error ? e.message : "다시 받아 주세요"}`,
          );
          setDayuseSale(null);
          return;
        }
      }
      notify(
        dayuseSaleNotifyLine(
          saved.guestName,
          L.roomLabel(saved.roomId) ?? dayuseSale?.roomLabel ?? "",
          saved.price,
          collected,
          planned.method,
        ),
      );
      setDayuseSale(null);
    } catch (e) {
      notify(saveFailMessage(e, "대실 판매를 저장하지 못했어요"));
    } finally {
      setDayuseSaleBusy(false);
    }
  };

  const commitPaymentDesk = async (plan: PaymentDeskPayPlan) => {
    if (readOnly || payDeskBusy || !payDesk) return;
    setPayDeskBusy(true);
    try {
      const members = payDesk.members;
      const guest = members[0]?.groupName || members[0]?.guestName || "손님";
      if (plan.asGroup) {
        const gid = sameGroupId(members);
        if (!gid) {
          notify("같은 단체만 한 번에 받을 수 있어요.");
          return;
        }
        await data.addGroupPayment(gid, { method: plan.method, amount: plan.amount, bizDate: today });
        const info = data.groups.get(gid);
        const plat = members[0] ? L.plats.get(members[0].platformId) : undefined;
        const left = settle(members, info, plat).left;
        notify(paymentDeskNotifyLine(guest, plan.amount, plan.method, plan.kind, Math.max(0, left - plan.amount), true));
      } else {
        const b = members[0];
        if (!b) return;
        await data.addPayment(b.id, {
          kind: plan.kind,
          method: plan.method,
          amount: plan.amount,
          bizDate: today,
        });
        const plat = L.plats.get(b.platformId);
        const left = Math.max(0, (payState(b, plat).left || 0) - (plan.kind === "balance" || plan.kind === "deposit" ? plan.amount : 0));
        notify(paymentDeskNotifyLine(guest, plan.amount, plan.method, plan.kind, left, false));
      }
      setPayDesk(null);
    } catch (e) {
      notify(saveFailMessage(e, "결제를 저장하지 못했어요"));
    } finally {
      setPayDeskBusy(false);
    }
  };

  const commitDeskApplyCredit = async (credit: StayCredit, bookingId: string, amount: number) => {
    if (readOnly || payDeskBusy) return;
    setPayDeskBusy(true);
    try {
      const result = await data.applyStayCredit(credit, bookingId, amount, today, "balance");
      notify(applyCreditNotifyLine(credit.guestName, result.plan.amount, result.plan.remainingAfter));
      setPayDesk(null);
    } catch (e) {
      notify(saveFailMessage(e, "잔액 사용을 저장하지 못했어요"));
    } finally {
      setPayDeskBusy(false);
    }
  };

  const commitStaySaleCreate = async (input: StaySaleCreateInput) => {
    if (readOnly || staySaleBusy || !staySale) return;
    const drafts = buildStaySaleDrafts(s, input);
    if ("err" in drafts) {
      notify(drafts.err);
      return;
    }
    setStaySaleBusy(true);
    try {
      const clash = drafts.flatMap((d) => legConflicts(bookings, d));
      if (clash.length) {
        notify(`${[...new Set(clash.map((x) => L.roomLabel(x.roomId) ?? "?"))].join(", ")}호는 그 기간에 다른 예약이 있어요.`);
        return;
      }
      let savedList: Booking[];
      if (drafts.length === 1) {
        savedList = [await data.saveBooking(drafts[0], true)];
      } else {
        const gid = drafts[0].groupId!;
        savedList = await data.saveGroup(drafts, {
          id: gid,
          payMode: input.payMode === "postpaid" ? "postpaid" : "prepaid",
          dueOn: null,
          payerCompany: null,
          payerName: null,
          payerPhone: input.guestPhone?.trim() || null,
          rates: null,
          extras: [],
          badgeColor: null,
        });
      }
      const plat = s.platforms.find((p) => p.id === input.platformId);
      let payTail = "";
      if (isOnsite(plat) && savedList[0]) {
        const total = savedList.reduce((n, b) => n + b.price, 0);
        const plan = staySaleCreatePayPlan(input, total);
        if (plan.kind !== "none") {
          try {
            if (plan.kind === "balance" && savedList.length > 1) {
              for (const b of savedList) {
                if (b.price > 0) {
                  await data.addPayment(b.id, { kind: "balance", method: plan.method, amount: b.price, bizDate: today });
                }
              }
            } else {
              await data.addPayment(savedList[0].id, {
                kind: plan.kind === "balance" ? "balance" : "deposit",
                method: plan.method,
                amount: plan.amount,
                bizDate: today,
              });
            }
            payTail = onsiteCreatePayTail(plan);
          } catch (e) {
            payTail = ` · 결제는 적지 못했어요: ${e instanceof Error ? e.message : "다시 시도"}`;
          }
        }
      }
      // 빠른입실/늦은퇴실 수납 (서비스·후불 제외)
      const earlyCollect =
        (input.earlyInHours ?? 0) > 0 &&
        input.earlyInMethod &&
        input.earlyInMethod !== "service" &&
        (input.earlyInAmount ?? 0) > 0;
      const lateCollect =
        (input.lateOutHours ?? 0) > 0 &&
        input.lateOutMethod &&
        input.lateOutMethod !== "service" &&
        input.lateOutMethod !== "deferred" &&
        (input.lateOutAmount ?? 0) > 0;
      if (savedList[0] && (earlyCollect || lateCollect)) {
        try {
          if (earlyCollect) {
            await data.addPayment(savedList[0].id, {
              kind: "balance",
              method: input.earlyInMethod as BookPayMethod,
              amount: Math.round(input.earlyInAmount!),
              bizDate: today,
              note: "추가금 · 빠른 입실",
            });
          }
          if (lateCollect) {
            await data.addPayment(savedList[0].id, {
              kind: "balance",
              method: input.lateOutMethod as BookPayMethod,
              amount: Math.round(input.lateOutAmount!),
              bizDate: today,
              note: "추가금 · 늦은 퇴실",
            });
          }
        } catch {
          payTail += " · 시간 추가금 수납 실패";
        }
      }
      notify(
        staySaleNotifyLine(
          savedList[0]?.guestName ?? input.guestName,
          staySale.roomLabels,
          savedList.reduce((n, b) => n + b.price, 0),
          payTail,
        ),
      );
      setStaySale(null);
      setSelectedRoomIds([]);
    } catch (e) {
      notify(saveFailMessage(e, "숙박 판매를 저장하지 못했어요"));
    } finally {
      setStaySaleBusy(false);
    }
  };

  const commitStaySaleOccupied = async (input: StaySaleOccupiedInput) => {
    if (readOnly || staySaleBusy || !staySale?.occupied) return;
    const b = data.bookings.find((x) => x.id === input.bookingId) ?? staySale.occupied;
    setStaySaleBusy(true);
    try {
      let live = b;
      if (input.extend && canExtend(live)) {
        const rate = nightRate(live, null);
        const hits = extendOverlaps(bookings, live, rate);
        if (hits.length) {
          setExtendOverlap({ booking: live, rate, hits });
          setStaySaleBusy(false);
          return;
        }
        const d = applyExtend(live, rate);
        live = await data.saveBooking(
          { ...live, nights: d.nights, price: d.price, segments: d.segments, nightRates: d.nightRates ?? live.nightRates },
          false,
        );
      }
      const earlyH = clampHours(input.earlyInHours ?? 0);
      const lateH = clampHours(input.lateOutHours ?? 0);
      const earlyAmt =
        earlyH > 0 && input.earlyInMethod !== "service" ? Math.max(0, Math.round(input.earlyInAmount ?? 0)) : 0;
      const lateAmt =
        lateH > 0 && input.lateOutMethod !== "service" ? Math.max(0, Math.round(input.lateOutAmount ?? 0)) : 0;
      if (earlyH > 0 || lateH > 0 || earlyAmt > 0 || lateAmt > 0) {
        const nextEarly = earlyH > 0 ? clampHours((live.earlyIn ?? 0) + earlyH) : live.earlyIn;
        const nextLate = lateH > 0 ? clampHours((live.lateOut ?? 0) + lateH) : live.lateOut;
        const delta = earlyAmt + lateAmt;
        live = await data.saveBooking(
          {
            ...live,
            earlyIn: nextEarly,
            lateOut: nextLate,
            price: Math.round(live.price) + delta,
            timeFee: Math.max(0, Math.round(live.timeFee ?? 0) + delta),
            arrived: earlyH > 0 ? true : live.arrived,
          },
          false,
        );
        if (earlyAmt > 0 && input.earlyInMethod && input.earlyInMethod !== "service") {
          await data.addPayment(live.id, {
            kind: "balance",
            method: input.earlyInMethod,
            amount: earlyAmt,
            bizDate: today,
            note: "추가금 · 빠른 입실",
          });
        }
        if (
          lateAmt > 0 &&
          input.lateOutMethod &&
          input.lateOutMethod !== "service" &&
          input.lateOutMethod !== "deferred"
        ) {
          await data.addPayment(live.id, {
            kind: "balance",
            method: input.lateOutMethod,
            amount: lateAmt,
            bizDate: today,
            note: "추가금 · 늦은 퇴실",
          });
        }
      }
      notify(`${live.guestName} 님 숙박 판매 반영했어요`);
      setStaySale(null);
    } catch (e) {
      notify(saveFailMessage(e, "숙박 판매를 저장하지 못했어요"));
    } finally {
      setStaySaleBusy(false);
    }
  };

  const commitAddTime = async (input: AddTimeInput) => {
    if (readOnly || addTimeBusy || !addTime) return;
    const b = addTime.booking;
    const planned = planAddTime(b, input);
    if ("err" in planned) {
      notify(planned.err);
      return;
    }
    setAddTimeBusy(true);
    try {
      let saved: Booking;
      if (planned.kind === "stay") {
        const next: Booking = {
          ...b,
          price: planned.surcharge.draft.price,
          lateOut: planned.surcharge.draft.lateOut,
          timeFee: planned.surcharge.draft.timeFee,
          memo: planned.surcharge.draft.memo,
        };
        saved = await data.saveBooking(next, false);
        let collected = false;
        if (planned.collect && planned.payMethod && planned.surcharge.collectAmount > 0) {
          try {
            await data.addPayment(saved.id, {
              kind: "balance",
              method: planned.payMethod,
              amount: planned.surcharge.collectAmount,
              bizDate: today,
              note: planned.surcharge.payNote,
            });
            collected = true;
          } catch (e) {
            notify(
              `${addTimeNotifyLine(saved.guestName, planned, false)} · 수납은 못 했어요: ${e instanceof Error ? e.message : "다시 받아 주세요"}`,
            );
            setAddTime(null);
            return;
          }
        }
        notify(addTimeNotifyLine(saved.guestName, planned, collected));
      } else {
        const next: Booking = {
          ...b,
          endTime: planned.endTime,
          price: planned.price,
        };
        saved = await data.saveBooking(next, false);
        let collected = false;
        if (planned.collectAmount > 0 && planned.payMethod) {
          try {
            await data.addPayment(saved.id, {
              kind: "balance",
              method: planned.payMethod,
              amount: planned.collectAmount,
              bizDate: today,
              note: planned.payNote,
            });
            collected = true;
          } catch (e) {
            notify(
              `${addTimeNotifyLine(saved.guestName, planned, false)} · 수납은 못 했어요: ${e instanceof Error ? e.message : "다시 받아 주세요"}`,
            );
            setAddTime(null);
            return;
          }
        }
        notify(addTimeNotifyLine(saved.guestName, planned, collected));
      }
      setAddTime(null);
    } catch (e) {
      notify(saveFailMessage(e, "시간 추가를 저장하지 못했어요"));
    } finally {
      setAddTimeBusy(false);
    }
  };

  /** 운영패널 1박 연장 · planOpsExtend SoT · 충돌 시 ExtendOverlapConfirm */
  const commitOpsExtend = async (input: OpsExtendInput, opts?: { allowOverlap?: boolean }) => {
    if (readOnly || extendNightBusy || !extendNight) return;
    const live = data.bookings.find((x) => x.id === extendNight.booking.id) ?? extendNight.booking;
    const planned = planOpsExtend(live, input);
    if ("err" in planned) {
      notify(planned.err);
      return;
    }
    if (!opts?.allowOverlap) {
      const hits = extendOverlaps(bookings, live, planned.effectiveRate);
      if (hits.length) {
        setExtendOverlap({ booking: live, rate: planned.effectiveRate, hits, opsInput: input });
        return;
      }
    }
    setExtendOverlap(null);
    setExtendNightBusy(true);
    try {
      const next: Booking = {
        ...live,
        nights: planned.draft.nights,
        price: planned.draft.price,
        segments: planned.draft.segments,
        nightRates: planned.draft.nightRates ?? live.nightRates ?? null,
      };
      const saved = await data.saveBooking(next, false);
      let collected = false;
      if (planned.collectAmount > 0 && planned.payMethod) {
        try {
          await data.addPayment(saved.id, {
            kind: "balance",
            method: planned.payMethod,
            amount: planned.collectAmount,
            bizDate: today,
            note: "1박 연장",
          });
          collected = true;
        } catch (e) {
          notify(
            `${extendNotifyLine(saved.guestName, planned.draft, false)} · 수납은 못 했어요: ${e instanceof Error ? e.message : "다시 받아 주세요"}`,
          );
          setExtendNight(null);
          return;
        }
      }
      notify(extendNotifyLine(saved.guestName, planned.draft, collected));
      setExtendNight(null);
    } catch (e) {
      notify(saveFailMessage(e, "1박 연장을 저장하지 못했어요"));
    } finally {
      setExtendNightBusy(false);
    }
  };

  const commitDeskDeletePay = async (bookingId: string, payId: string) => {
    if (readOnly || payDeskBusy) return;
    setPayDeskBusy(true);
    try {
      await data.deletePayment(bookingId, payId);
      notify("결제 줄을 지웠어요");
    } catch (e) {
      notify(saveFailMessage(e, "결제 줄을 지우지 못했어요"));
    } finally {
      setPayDeskBusy(false);
    }
  };

  const commitDeskDeleteGroupPay = async (groupId: string, payId: string) => {
    if (readOnly || payDeskBusy) return;
    setPayDeskBusy(true);
    try {
      await data.deleteGroupPayment(groupId, payId);
      notify("단체 결제 줄을 지웠어요");
    } catch (e) {
      notify(saveFailMessage(e, "단체 결제 줄을 지우지 못했어요"));
    } finally {
      setPayDeskBusy(false);
    }
  };

  /** 오잔금: 판매가=받은돈(+환불) 조정 · 결제 줄 유지 · 시간료 0(서비스) */
  const commitDeskClearResidual = async (b: Booking, newPrice: number) => {
    if (readOnly || payDeskBusy) return;
    setPayDeskBusy(true);
    try {
      const live = data.bookings.find((x) => x.id === b.id) ?? b;
      const hasTime = !!(live.earlyIn || live.lateOut);
      await data.saveBooking({ ...live, price: newPrice, timeFee: hasTime ? 0 : live.timeFee }, false);
      notify(`${live.guestName || "손님"} 님 잔금 맞춤 · 판매가 ${won(newPrice)}원`);
    } catch (e) {
      notify(saveFailMessage(e, "잔금을 맞추지 못했어요"));
    } finally {
      setPayDeskBusy(false);
    }
  };

  const commitDeskSurcharge = async (
    b: Booking,
    input: {
      reason: SurchargeReason;
      hours: number;
      amount: number;
      memo: string;
      collect: boolean;
      method: BookPayMethod;
      bizDate: string;
    },
  ) => {
    if (readOnly || payDeskBusy) return;
    const planned = planPaymentDeskSurcharge(b, input);
    if ("err" in planned) {
      notify(planned.err);
      return;
    }
    setPayDeskBusy(true);
    try {
      const next: Booking = {
        ...b,
        price: planned.draft.price,
        lateOut: planned.draft.lateOut,
        timeFee: planned.draft.timeFee,
        memo: planned.draft.memo,
      };
      const saved = await data.saveBooking(next, false);
      let collected = false;
      if (planned.collectAmount > 0) {
        try {
          await data.addPayment(saved.id, {
            kind: "balance",
            method: input.method,
            amount: planned.collectAmount,
            bizDate: today,
            note: planned.payNote,
          });
          collected = true;
        } catch (e) {
          notify(
            `${surchargeNotifyLine(saved.guestName, input.reason, input.amount, false, planned.draft.lateOut)} · 수납은 못 했어요: ${e instanceof Error ? e.message : "다시 받아 주세요"}`,
          );
          setPayDesk(null);
          return;
        }
      }
      notify(surchargeNotifyLine(saved.guestName, input.reason, input.amount, collected, planned.draft.lateOut));
      setPayDesk(null);
    } catch (e) {
      notify(saveFailMessage(e, "할증을 저장하지 못했어요"));
    } finally {
      setPayDeskBusy(false);
    }
  };

  const nowCell = (r: (typeof s.floors)[number]["rooms"][number], fColor: string | null | undefined) => {
    const b = nowBoardMap.get(r.id);
    const t = r.typeId ? L.types.get(r.typeId) : null;
    const du = nowDayuseByRoom.get(r.id) ?? [];
    const strip = pastelColor(r.color ?? fColor ?? null);
    const k = /^\d+$/.test(r.no) ? "" : "k";
    const glance = glanceByRoom.get(r.id);
    const duMark =
      du.length > 0 ? (
        <span
          className="dumark"
          title={du.map((d) => `대실 ${d.startTime}~${d.endTime} · ${d.guestName || ""}`).join(" · ")}
          onClick={(e) => {
            e.stopPropagation();
            if (readOnly || mvB) return;
            onOpen(du[0], today);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.stopPropagation();
            if (readOnly || mvB) return;
            onOpen(du[0], today);
          }}
          role={readOnly || mvB ? undefined : "button"}
          tabIndex={readOnly || mvB ? undefined : 0}
        >
          <i>대실 </i>
          {du[0].startTime}
          {du.length > 1 ? <em> +{du.length - 1}</em> : null}
        </span>
      ) : null;
    const openN = glance?.count ?? 0;
    const memoBubble =
      openN > 0 || !readOnly ? (
        <button
          type="button"
          className={`nowmemo ${openN ? "has" : "add"}`}
          aria-label={
            openN
              ? `${r.no} 미해결 특이사항 ${openN}건: ${glance!.preview}`
              : `${r.no} 특이사항 적기`
          }
          title={openN ? glance!.title : "특이사항"}
          onClick={(e) => {
            e.stopPropagation();
            setNightPopId(null);
            setMemoRoomId(r.id);
          }}
        >
          <MessageCircle size={openN ? 14 : 13} strokeWidth={openN ? 2.4 : 2} aria-hidden />
          {openN ? (
            <>
              <span className="nowmemo-txt">{glance!.preview}</span>
              {openN > 1 ? (
                <span className="nowmemo-n">+{openN - 1 > 9 ? "9+" : openN - 1}</span>
              ) : null}
            </>
          ) : null}
        </button>
      ) : null;
    const head = (
      <div className={`r1 ${strip ? "strip" : ""}`} style={strip ? { background: strip } : undefined}>
        {/* FitText+말풍선 flex/cqw로 호수가 사라지던 회귀 → 평문 고정 표시 */}
        <span className={`no ${k}`} title={r.no}>
          {r.no}
        </span>
        {memoBubble}
      </div>
    );
    const { mvSame, mvCls, mvClick, mvAttr } = mvCellBits(r);
    if (!b || !isActive(b)) {
      if (nowFilter === "tentative") return null;
      const emptySel = !mvB && selectedRoomIds.includes(r.id);
      const flash = flashRoomId === r.id;
      const gs = gsCellClass(r.id);
      return (
        <div
          key={r.id}
          id={`now-room-${r.id}`}
          data-room-id={r.id}
          {...(mvB ? mvAttr : act)}
          className={`cell em nowempty ${du.length ? "duc" : ""} ${emptySel ? "nowsel" : ""} ${flash ? "nowflash" : ""} ${gs} ${readOnly ? "ro" : ""} ${mvCls}`}
          onClick={mvClick ?? (() => selectRoom(r.id))}
          onKeyDown={mvClick ? (e) => e.key === "Enter" && mvClick() : undefined}
        >
          {duMark}
          <div className="cell-body nowstack sparse">
            {head}
            <TypeRow t={t} />
            <div className="nowstatus-slot">
              <span className="nowstatus nk-empty">{mvSame ? "같은 타입" : mvB && targets.has(r.id) ? "이동 가능" : "공실"}</span>
            </div>
          </div>
        </div>
      );
    }
    const f = nowFlags(b, today, nowOpts);
    if (nowFilter === "tentative" && !f.tentative) return null;
    const nights = nowNightRange(b);
    // 숙박예약(입실 전)은 진행 숨김 · 길이 `N박` · 연박 진행 `K/N박` (풀 라인 금지)
    const staySummary = nowStaySummary(b, today, f.kind !== "arriving");
    const plat = L.plats.get(b.platformId);
    const groupCtx =
      b.groupId
        ? {
            members: groupStayPeers(bookings, b.groupId),
            info: data.groups.get(b.groupId) ?? null,
          }
        : null;
    const amount = nowAmountGlance(b, plat, groupCtx);
    const amountTone = nowAmountTone(b, plat, groupCtx);
    // 하이브리드 완납: 최근 1줄 수단만 · 잔금 라벨이면 prefix null
    const payMethod = nowPayMethodPrefix(amount, nowLatestPayMethodLabel(b, groupCtx?.info?.payments));
    const grpGlance =
      groupCtx && groupCtx.members.length > 0 ? groupSettleGlance(groupCtx.members, groupCtx.info, plat) : null;
    const coMarkLabel = nowCheckoutMark(s, b);
    const meta = nowMetaLine(b);
    const coMark = coMarkLabel ? (
      <span className="comark" title={coMarkLabel}>
        {coMarkLabel}
      </span>
    ) : null;
    const popOpen = nightPopId === b.id;
    const openEarlyIn = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (readOnly || earlyBusy || earlyPay || b.arrived) return;
      setEarlyPay({ booking: b, roomLabel: L.roomLabel(r.id) ?? r.no });
    };
    const onStatusTap = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (readOnly || mvB) return;
      if (isDepartingStatus(f.kind) && canCheckOut(b, today)) {
        void doCheckOut(b, true);
        return;
      }
      // 숙박예약 → 숙박 (수동 모드 필수 경로 · 빠른입실과 별개)
      if (f.kind === "arriving" && !b.arrived) {
        void markArrivedFromStatus(b);
        return;
      }
      selectRoom(r.id);
    };
    const occupiedSel = !mvB && selectedRoomIds.includes(r.id);
    const flash = flashRoomId === r.id;
    const gs = gsCellClass(r.id);
    return (
      <div
        key={r.id}
        id={`now-room-${r.id}`}
        data-room-id={r.id}
        {...(mvB ? mvAttr : act)}
        className={`cell bk nowcell nk-${f.kind} ${du.length ? "hasdu" : ""} ${occupiedSel ? "nowsel" : ""} ${flash ? "nowflash" : ""} ${gs} ${f.tentative ? "tent" : ""} ${f.group ? "grp" : ""} ${f.noClean ? "ncx" : ""} ${f.arrived ? "in" : ""} ${readOnly ? "ro" : ""} ${mvCls}`}
        onClick={mvClick ?? (() => selectRoom(r.id))}
        onKeyDown={mvClick ? (e) => e.key === "Enter" && mvClick() : undefined}
      >
        {duMark}
        {coMark}
        <div className="cell-body nowstack dense">
          {head}
          <TypeRow t={t} guests={b.guests} />
          <div className="nowdate-row">
            <button
              type="button"
              className="nowdate-btn"
              aria-label={`점유 밤 ${nights.label}`}
              aria-expanded={popOpen}
              onClick={(e) => {
                e.stopPropagation();
                setNightPopId(popOpen ? null : b.id);
              }}
            >
              <span className="nowchip nowdate">{nights.label}</span>
              <span className="nowdate-caret" aria-hidden>
                ▾
              </span>
            </button>
            {staySummary ? (
              <span className="nowchip nownights" title="숙박">
                {staySummary}
              </span>
            ) : null}
            {popOpen ? (
              <NowNightPopover
                booking={b}
                bookings={bookings}
                today={today}
                roomLabel={L.roomLabel(r.id) ?? r.no}
                onClose={() => setNightPopId(null)}
                onOpen={() => {
                  setNightPopId(null);
                  onOpen(b, today);
                }}
              />
            ) : null}
          </div>
          <div className="nm">
            <PlatBadge p={L.plats.get(b.platformId)} />
            <span className="gn">{b.guestName}</span>
            {isWalkInPlaceholderName(b.guestName) ? (
              <span className="wiittag" title="바로 입실 · 이름·연락처 미입력">
                바로입실
              </span>
            ) : null}
            {f.noClean ? <span className="ncxtag" title="청소하지 않음">청소X</span> : null}
            {f.tentative ? <span className="tenttag">임시</span> : null}
            {f.longStay ? <span className="longtag" title="장기 · 퇴실 미정">장기</span> : null}
            {f.group && b.groupId ? (
              <GroupBadge
                groupName={b.groupName}
                color={data.groups.get(b.groupId)?.badgeColor}
                readOnly={readOnly}
                onPick={pickGroupColor(b.groupId)}
              />
            ) : null}
          </div>
          {amount || payMethod ? (
            <div className={`nowamt tone-${amountTone}`} title={f.longStay ? "미수" : "요금·잔금"}>
              {payMethod ? <span className="nowpay">{payMethod}</span> : null}
              {payMethod && amount ? " " : null}
              {amount}
            </div>
          ) : null}
          {grpGlance ? (
            <div className="nowgrp-settle" title={grpGlance.strip} aria-label={grpGlance.strip}>
              <span className="nowgrp-settle-k">{grpGlance.compact}</span>
              {grpGlance.badge ? <span className="nowgrp-settle-badge">{grpGlance.badge}</span> : null}
            </div>
          ) : null}
          {meta ? <div className="nowmeta">{meta}</div> : null}
          <div className="nowstatus-slot">
            {!readOnly && f.kind === "arriving" && !b.arrived ? (
              <button
                type="button"
                className="nowearly"
                disabled={!!earlyBusy || !!earlyPay}
                onClick={openEarlyIn}
              >
                {earlyBusy === b.id ? "처리 중…" : "빠른 입실"}
              </button>
            ) : null}
            <button
              type="button"
              className={`nowstatus nk-${f.kind}${isDepartingStatus(f.kind) || (f.kind === "arriving" && !b.arrived) ? " tap" : ""}`}
              onClick={onStatusTap}
              title={
                isDepartingStatus(f.kind)
                  ? "탭하면 퇴실처리"
                  : f.kind === "arriving" && !b.arrived
                    ? "탭하면 숙박으로 전환"
                    : f.label
              }
            >
              {f.label}
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (tab === "now") {
    const scopeFloorsNow = orderedFloors(s).filter((f) => f.rooms.length && (bScope === "all" || f.buildingId === bScope));
    const floorsNow = scopeFloorsNow.filter((f) => floorTab === "all" || floorTab === f.id);
    const groupsNow = (multi ? s.buildings : s.buildings.slice(0, 1))
      .map((bd) => ({ bd, floors: multi ? floorsNow.filter((f) => f.buildingId === bd.id) : floorsNow }))
      .filter((g) => g.floors.length);
    const glanceRooms = floorsNow.flatMap((f) => f.rooms);
    const glanceVacant = glanceRooms.filter((r) => {
      const bk = nowBoardMap.get(r.id);
      return !bk || !isActive(bk);
    });
    const glanceTotal = glanceRooms.length;
    const glanceUsed = glanceTotal - glanceVacant.length;
    const glanceLeft = glanceVacant.length;
    /** 오늘 · 호텔 전체 stockTable remaining · 방 0개 타입 숨김 · 설정 타입 순서 */
    const typeStockAll = s.types
      .filter((t) => (totalsAll.get(t.id) ?? 0) > 0)
      .map((t) => ({
        t,
        rem: tableAll.get(t.id)?.get(today) ?? 0,
        total: totalsAll.get(t.id) ?? 0,
      }));
    const minimapNow: MinimapBuilding[] = groupsNow.map(({ bd, floors: fl }) => ({
      id: bd.id,
      name: L.buildings.get(bd.id)?.name ?? bd.name,
      floors: fl.map((f) => ({
        id: f.id,
        name: f.name,
        rooms: f.rooms.map((r) => ({
          id: r.id,
          kind: glanceMapKindNow(nowBoardMap.get(r.id) ?? null, today, nowOpts),
        })),
      })),
    }));
    const nowGlance = (
      <NowGlancePanel
        key={`now-glance-${bScope}`}
        total={glanceTotal}
        used={glanceUsed}
        left={glanceLeft}
        vacantRooms={glanceVacant.map((r) => ({
          id: r.id,
          label: multi && bScope === "all" ? (L.roomLabel(r.id) ?? r.no) : r.no,
        }))}
        onVacantChip={jumpToVacantRoom}
        typeStock={typeStockAll}
        lowThreshold={s.lowThreshold}
        onTypeStock={(typeId) => jumpToTypeStock(typeId, today)}
        buildings={minimapNow}
        onRoomBlock={jumpSelectNowRoom}
        open={glanceOpenNow}
        onOpenChange={(o) => rememberGlanceOpen("now", o)}
        occFilter={occFilter}
        onOccFilterChange={setOccFilter}
      />
    );
    /** 상태 범례 — 건물명 행 우측 · 페이지 하단 금지 */
    const nowLegend = (
      <div className="lg nowlg" aria-label="상태 범례">
        <span>
          <i className="nkdot nk-empty" />공실
        </span>
        <span>
          <i className="nkdot nk-arriving" />숙박예약
        </span>
        <span>
          <i className="nkdot nk-inhouse" />숙박
        </span>
        <span>
          <i className="nkdot nk-departing" />퇴실예정
        </span>
        <span>
          <i className="nkdot nk-lateOut" />늦은 퇴실
        </span>
        <span>
          <i className="nkdot nk-tent" />임시
        </span>
        <span>
          <i className="nkdot nk-ua" />미배정
        </span>
        <span>
          <i className="nkdot nk-ncx" />청소X
        </span>
        <span>
          <MessageCircle size={12} strokeWidth={2.2} aria-hidden />특이사항
        </span>
      </div>
    );
    return (
    <>
      <main className="page board-page now-page">
        <div className="main">
          {tabs}
          {banner}
          <div className="bdh">
            <div>
              <h1>현황</h1>
              <div className="bdh-s">
                영업일 {dayLabel(today)} · 화이트보드처럼 오늘 방 상태를 봐요 · 말풍선은 특이사항 · 칸을 누르면 우측 상세
              </div>
            </div>
            <div className="dnav nowfilters">
              <button type="button" className={`chip ${nowFilter === "all" ? "on" : ""}`} disabled={!!mvB} onClick={() => setNowFilter("all")}>
                전체
              </button>
              <button type="button" className={`chip ${nowFilter === "tentative" ? "on" : ""}`} disabled={!!mvB} onClick={() => setNowFilter("tentative")}>
                임시만{nowSide.tentative.length ? ` ${nowSide.tentative.length}` : ""}
              </button>
              {!readOnly && nowSide.tentative.length ? (
                <button type="button" className="btn sm dark" disabled={tentBusy || !!mvB} onClick={() => void confirmAllTentative()}>
                  {tentBusy ? "확정 중…" : `임시 ${nowSide.tentative.length}건 확정`}
                </button>
              ) : null}
              <button type="button" className="btn sm line" disabled={!!mvB} onClick={() => setTab("rooms")}>
                판매·배치로
              </button>
            </div>
          </div>
          {mvBar}
          <div className="nowlayout">
            {/* Chrome sticky lives in the board column only — full-width sticky covered .nowside (#128). */}
            <div className="nowboard">
              <div className="board-chrome-sticky">
                <div className="board-filter-sticky">
                  {buildingTabs}
                  {guestSearchBar}
                </div>
                {nowGlance}
              </div>
              <div className="nowgrid">
                {groupsNow.map(({ bd, floors: fl }, gi) => (
                  <section key={bd.id} className="bblock">
                    <div className="bname-row">
                      <h2 className="bname">{L.buildings.get(bd.id)?.name ?? bd.name}</h2>
                      {gi === 0 ? nowLegend : null}
                    </div>
                    {fl.map((f) => (
                      <div className="floor" key={f.id}>
                        <div className="fh">
                          <span className="fn" style={floorPaint(f.color) ? { ["--fc" as string]: floorPaint(f.color)! } : undefined}>
                            {f.name}
                          </span>
                        </div>
                        <div className="rooms">{f.rooms.map((r) => nowCell(r, f.color))}</div>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            </div>
            <NowSidePanel
              today={today}
              s={s}
              L={L}
              unassigned={nowSide.unassigned}
              lateOut={nowSide.lateOut}
              departing={nowSide.departing}
              selectedRoomIds={selectedRoomIds}
              selectedBooking={
                selectedRoomIds.length === 1 && selectedRoomId
                  ? (nowBoardMap.get(selectedRoomId) ?? null)
                  : null
              }
              selectedGroupBookings={selectedGroupBookings}
              selectedGroupInfo={
                selectedGroupBookings[0]?.groupId
                  ? (data.groups.get(selectedGroupBookings[0].groupId) ?? null)
                  : null
              }
              settleMembers={selectedSettle.members}
              settleGroupInfo={selectedSettle.info}
              mode={sideMode}
              onMode={setSideMode}
              glanceByRoom={glanceByRoom}
              readOnly={readOnly}
              assigning={assigning}
              setAssigning={setAssigningMode}
              coBusy={coBusy}
              onOpen={onOpen}
              onSimple={onSimple}
              onStaySale={openStaySale}
              staySaleCta={staySaleCta}
              dayuseForRoom={selectedDayuse}
              onNewDayuse={openNewDayuse}
              onCheckOut={(bk, need) => void doCheckOut(bk, need)}
              recentCheckedOut={
                selectedRoomIds.length === 1 && selectedRoomId && !nowBoardMap.get(selectedRoomId)
                  ? recentCheckedOutForRoom(bookings, selectedRoomId, today)
                  : null
              }
              onUndoCheckOut={(bk) => void doUndoCheckOut(bk)}
              onEndDayuse={(bk) => void doEndDayuse(bk)}
              onMemo={setMemoRoomId}
              onRoomMove={startOpsRoomMove}
              moving={!!mvB}
              onSetNoClean={(bk, v) => void setNoClean(bk, v)}
              ncxBusy={ncxBusy}
              onPaymentDesk={(bk) => openPaymentDesk(bk)}
              onLateOut={(bk) => {
                const lab = bk.roomId
                  ? `${L.roomLabel(bk.roomId) ?? allRooms(s).find((r) => r.id === bk.roomId)?.no ?? ""}호`
                  : vacantBookLabels[0]
                    ? `${vacantBookLabels[0]}호`
                    : "";
                setAddTime({ booking: bk, roomLabel: lab || "호실" });
              }}
              onExtendNight={(bk) => {
                if (!canExtend(bk) || isLongStay(bk)) return;
                const lab = bk.roomId
                  ? `${L.roomLabel(bk.roomId) ?? allRooms(s).find((r) => r.id === bk.roomId)?.no ?? ""}호`
                  : "";
                setExtendNight({ booking: bk, roomLabel: lab || "호실" });
              }}
              onEarlyIn={(bk) => {
                if (bk.arrived) return;
                const lab = bk.roomId
                  ? L.roomLabel(bk.roomId) ?? allRooms(s).find((r) => r.id === bk.roomId)?.no ?? ""
                  : "";
                setEarlyPay({ booking: bk, roomLabel: lab || "호실" });
              }}
              nowOpts={nowOpts}
            />
          </div>
          {/* 숙박 판매 CTA는 패널 판매 섹션만 · 바는 선택 글랜스+해제 (중복 금지) */}
          {!readOnly && !mvB && selectedRoomIds.length > 0 ? (
            <div className="nowbookbar" role="region" aria-label="선택한 객실">
              <span className="nowbookbar-labs">
                {(vacantBookLabels.length ? vacantBookLabels : selectedRoomIds.map((id) => L.roomLabel(id) ?? allRooms(s).find((r) => r.id === id)?.no ?? id)).map((n) => `${n}호`).join(", ")}
              </span>
              {selectedVacantIds.length > 1 && staySaleCta ? (
                <button type="button" className="btn sm stop" onClick={openStaySale}>
                  {staySaleCta}
                </button>
              ) : null}
              <button
                type="button"
                className="btn sm line nowbookbar-x"
                aria-label="선택 해제"
                onClick={() => setSelectedRoomIds([])}
              >
                해제
              </button>
            </div>
          ) : null}
        </div>
      </main>
      {memoRoomId ? (
        <RoomMemoModal
          roomId={memoRoomId}
          roomLabel={L.roomLabel(memoRoomId) ?? memoRoomId}
          list={memos.list ?? []}
          readOnly={readOnly}
          onClose={() => setMemoRoomId(null)}
          onSave={memos.save}
          onSetStatus={memos.setStatus}
          onRemove={memos.remove}
          notify={notify}
        />
      ) : null}
      {earlyPay ? (
        <EarlyInPayModal
          guestName={earlyPay.booking.guestName}
          roomLabel={earlyPay.roomLabel}
          today={today}
          busy={earlyBusy === earlyPay.booking.id}
          onCancel={() => !earlyBusy && setEarlyPay(null)}
          onConfirm={(plan, method) => void confirmEarlyIn(plan, method)}
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
          datesLabel={nowNightRange(coConfirm.booking).label}
          busy={coBusy === coConfirm.booking.id}
          onCancel={closeCoConfirm}
          onCheckoutOnly={() => void confirmCheckoutOnly()}
          onPayThenCheckout={(plan) => void confirmCheckoutPayThen(plan)}
        />
      ) : null}
      {dayuseSale ? (
        <DayuseSaleModal
          s={s}
          today={today}
          bookings={bookings}
          initialRoomId={dayuseSale.roomId}
          initialTypeId={dayuseSale.typeId}
          busy={dayuseSaleBusy}
          onCancel={() => !dayuseSaleBusy && (setDayuseSale(null), setDayuseSaleWarn(null))}
          onConfirm={(input) => void commitDayuseSale(input, false)}
        />
      ) : null}
      {addTime ? (
        <AddTimeModal
          s={s}
          today={today}
          booking={addTime.booking}
          roomLabel={addTime.roomLabel}
          busy={addTimeBusy}
          onCancel={() => !addTimeBusy && setAddTime(null)}
          onConfirm={(input) => void commitAddTime(input)}
        />
      ) : null}
      {extendNight ? (
        <ExtendNightModal
          today={today}
          booking={extendNight.booking}
          roomLabel={extendNight.roomLabel}
          busy={extendNightBusy}
          onCancel={() => !extendNightBusy && setExtendNight(null)}
          onConfirm={(input) => void commitOpsExtend(input)}
        />
      ) : null}
      {staySale ? (
        <StaySaleModal
          s={s}
          today={today}
          roomIds={staySale.roomIds}
          roomLabels={staySale.roomLabels}
          occupied={staySale.occupied}
          busy={staySaleBusy}
          onCancel={() => !staySaleBusy && setStaySale(null)}
          onConfirmCreate={(input) => void commitStaySaleCreate(input)}
          onConfirmOccupied={(input) => void commitStaySaleOccupied(input)}
        />
      ) : null}
      {extendOverlap ? (
        <ExtendOverlapConfirm
          extraNight={addDays(extendOverlap.booking.checkIn, extendOverlap.booking.nights ?? 0)}
          others={extendOverlap.hits}
          roomLabel={
            extendOverlap.booking.roomId
              ? L.roomLabel(extendOverlap.booking.roomId) ?? null
              : null
          }
          busy={staySaleBusy || extendNightBusy}
          onCancel={() => {
            setExtendOverlap(null);
          }}
          onApprove={() => {
            const pending = extendOverlap;
            setExtendOverlap(null);
            if (pending.opsInput) {
              void commitOpsExtend(pending.opsInput, { allowOverlap: true });
              return;
            }
            void (async () => {
              setStaySaleBusy(true);
              try {
                const d = applyExtend(pending.booking, pending.rate);
                await data.saveBooking(
                  {
                    ...pending.booking,
                    nights: d.nights,
                    price: d.price,
                    segments: d.segments,
                    nightRates: d.nightRates ?? pending.booking.nightRates,
                  },
                  false,
                );
                notify(`${pending.booking.guestName} 님 1박 연장했어요`);
                setStaySale(null);
              } catch (e) {
                notify(saveFailMessage(e, "연장을 저장하지 못했어요"));
              } finally {
                setStaySaleBusy(false);
              }
            })();
          }}
        />
      ) : null}
      {dayuseSaleWarn ? (
        <DayuseStayOverlapConfirm
          message={dayuseSaleWarn.message}
          busy={dayuseSaleBusy}
          onCancel={() => !dayuseSaleBusy && setDayuseSaleWarn(null)}
          onContinue={() => void commitDayuseSale(dayuseSaleWarn.input, true)}
        />
      ) : null}
      {payDesk ? (
        <PaymentDeskModal
          s={s}
          today={today}
          members={payDesk.members.map((m) => data.bookings.find((x) => x.id === m.id) ?? m)}
          groupInfo={
            payDesk.members[0]?.groupId ? (data.groups.get(payDesk.members[0].groupId) ?? null) : null
          }
          roomLabels={payDesk.members.map(
            (b) => L.roomLabel(b.roomId) ?? allRooms(s).find((r) => r.id === b.roomId)?.no ?? "?",
          )}
          stayCredits={data.stayCredits}
          busy={payDeskBusy}
          onCancel={() => !payDeskBusy && setPayDesk(null)}
          onPay={(plan) => void commitPaymentDesk(plan)}
          onApplyCredit={(c, bookingId, amount) => void commitDeskApplyCredit(c, bookingId, amount)}
          onSurcharge={(b, input) => void commitDeskSurcharge(b, input)}
          onDeletePayment={(bookingId, payId) => void commitDeskDeletePay(bookingId, payId)}
          onDeleteGroupPayment={(groupId, payId) => void commitDeskDeleteGroupPay(groupId, payId)}
          onClearResidual={(b, newPrice) => void commitDeskClearResidual(b, newPrice)}
        />
      ) : null}
      {renderAssignModals()}
    </>
  );
  }

  if (tab === "stock")
    return (
      <SalesCalendar
        data={data}
        s={s}
        today={today}
        selDate={selDate}
        viewDates={viewDates}
        viewTable={viewTable}
        totals={totals}
        scopeId={scopeId}
        unassigned={unassigned}
        readOnly={readOnly}
        rangeNav={rangeNav}
        buildingTabs={buildingTabs}
        periodSeg={periodSeg}
        banner={banner}
        tabs={tabs}
        bName={bName}
        over={over}
        wideRef={wideRef}
        notify={(m) => notify(m)}
        onSimple={onSimple}
        focusCell={stockFocus}
        onFocusConsumed={() => setStockFocus(null)}
      />
    );

  if (tab === "parking" && s.parking.enabled)
    return (
      <main className="page board-page one">
        <div className="main">
          {tabs}
          {banner}
          <ParkingView bookings={bookings} L={L} date={selDate} today={today} setDate={setSelDate} readOnly={readOnly} onOpen={(b) => onOpen(b, selDate)} />
        </div>
      </main>
    );

  if (tab === "calendar")
    return (
      <main className="page board-page one">
        <div className="main">
          {tabs}
          {banner}
          <div className="hl">
            <div>
              <div className="hl-t">
                <h1>객실 캘린더</h1>
                {periodSeg}
              </div>
              <div className="when">
                {nowLabel()} · 방마다 숙박 막대{scopeId ? ` · ${bName(scopeId)}만` : ""}
              </div>
            </div>
            <div className="lg cal-lg">
              <span><i className="lg-bar" />숙박</span>
              <span><i className="lg-bar ok" />입실 완료</span>
              <span><i className="lg-dot" />대실</span>
              <span><i className="lg-bar cx" />취소·노쇼</span>
            </div>
          </div>
          {rangeNav}
          {buildingTabs}
          {scopeId && unassigned ? (
            <div className="b-note">미배정(타입 홀드) {unassigned}건은 호텔 전체 재고 · 건물 탭에서는 '전체'에만 보여요.</div>
          ) : null}
          <RoomCalendar
            s={s}
            L={L}
            bookings={viewBookings}
            dates={viewDates}
            today={today}
            scopeId={scopeId}
            multi={multi}
            readOnly={readOnly}
            onOpen={onOpen}
            onNew={onNew}
          />
        </div>
      </main>
    );

  const uaActiveN = board.unassigned.filter(isActive).length;

  return (
    <>
    <main className={`page board-page${sideCollapsed ? " side-collapsed" : ""}`}>
      <div className="main">
        {tabs}
        {banner}
        <div className="bdh">
          <div>
            <h1>객실 배치 · 재고</h1>
            <div className="bdh-s">{readOnly ? "보기 전용 · 가는 테두리는 입실 전, 굵은 테두리는 입실 완료 (빨강 숙박 · 파랑 대실) · 점선은 임시" : "선택한 숙박일 배치 · 칸을 누르면 예약·단체 창 · 점선「임시」는 나중에 고쳐도 되고 재고는 막혀 있어요 · 현장은 「현황」 탭"}</div>
          </div>
          <div className="dnav">
            <span className="cnt-m">
              숙박 {board.nightCount}/{roomCount}
            </span>
            <button className="ar" aria-label="전날" disabled={!!mvB} onClick={() => setSelDate(addDays(selDate, -1))}>
              <ChevronLeft size={16} />
            </button>
            <span className="dn-day">{dayLabel(selDate)} 밤</span>
            <button className="ar" aria-label="다음날" disabled={!!mvB} onClick={() => setSelDate(addDays(selDate, 1))}>
              <ChevronRight size={16} />
            </button>
            <button className="btn sm" disabled={selDate === today || !!mvB} onClick={() => setSelDate(today)}>
              오늘
            </button>
          </div>
        </div>
        {mvBar}
        {!mvB && assignBk ? (
          <div className="now-assign-banner" role="status">
            <span>
              <b>{assignBk.guestName}</b>
              {` · ${typeLabel(L.types.get(assignBk.typeId))} · 배치 칸 체크 → 배정`}
              {assignBk.nights ? ` · ${assignBk.nights}박` : ""}
            </span>
            <button type="button" className="btn sm line" onClick={() => setAssigningMode(null)}>
              취소
            </button>
          </div>
        ) : null}
        {(() => {
          const glanceFloors = floorTab === "dayuse" ? scopeFloors : floors;
          const glanceGroups = (multi ? s.buildings : s.buildings.slice(0, 1))
            .map((bd) => ({
              bd,
              floors: multi ? glanceFloors.filter((f) => f.buildingId === bd.id) : glanceFloors,
            }))
            .filter((g) => g.floors.length);
          const gRooms = glanceFloors.flatMap((f) => f.rooms);
          const gVacant = gRooms.filter((r) => {
            const bk = board.byRoom.get(r.id);
            return !bk || !occupiesRoom(bk);
          });
          const typeStockNight = s.types
            .filter((t) => (totalsAll.get(t.id) ?? 0) > 0)
            .map((t) => ({
              t,
              rem: tableAll.get(t.id)?.get(selDate) ?? 0,
              total: totalsAll.get(t.id) ?? 0,
            }));
          const minimapRooms: MinimapBuilding[] = glanceGroups.map(({ bd, floors: fl }) => ({
            id: bd.id,
            name: L.buildings.get(bd.id)?.name ?? bd.name,
            floors: fl.map((f) => ({
              id: f.id,
              name: f.name,
              rooms: f.rooms.map((r) => ({
                id: r.id,
                kind: glanceMapKindPlacement(bookings, r.id, selDate, nowOpts),
              })),
            })),
          }));
          return (
            <div className="board-chrome-sticky">
              <div className="board-filter-sticky">
                {buildingTabs}
                {guestSearchBar}
              </div>
              <NowGlancePanel
                key={`rooms-glance-${bScope}-${selDate}`}
                total={gRooms.length}
                used={gRooms.length - gVacant.length}
                left={gVacant.length}
                vacantRooms={gVacant.map((r) => ({
                  id: r.id,
                  label: multi && bScope === "all" ? (L.roomLabel(r.id) ?? r.no) : r.no,
                }))}
                onVacantChip={jumpRoomsRoom}
                typeStock={typeStockNight}
                lowThreshold={s.lowThreshold}
                onTypeStock={(typeId) => jumpToTypeStock(typeId, selDate)}
                buildings={minimapRooms}
                onRoomBlock={jumpRoomsRoom}
                open={glanceOpenRooms}
                onOpenChange={(o) => rememberGlanceOpen("rooms", o)}
                occFilter={occFilter}
                onOccFilterChange={setOccFilter}
              />
            </div>
          );
        })()}
        <div className="fchips">
          <button className={floorTab === "all" ? "on" : ""} onClick={() => setFloorTab("all")}>
            전체
          </button>
          {/* 건물이 여럿이면 위 건물 탭을 먼저 고르고, 그 건물의 층만 보여 줘요 */}
          {(multi && bScope === "all" ? [] : scopeFloors).map((f) => (
            <button key={f.id} className={floorTab === f.id ? "on" : ""} onClick={() => setFloorTab(f.id)}>
              {f.name}
            </button>
          ))}
          <button className={floorTab === "dayuse" ? "on" : ""} onClick={() => setFloorTab("dayuse")}>
            대실 {activeDayuse}
          </button>
        </div>
        {floorTab !== "dayuse"
          ? groups.map((g) => (
              <section className={multi ? "bsec" : undefined} key={g.bd.id}>
                {multi ? (
                  <div className="bsh">
                    <b title={bName(g.bd.id)}>{bName(g.bd.id)}</b>
                    <span>
                      숙박 {nightIn(g.floors)}/{roomsIn(g.floors)}
                    </span>
                  </div>
                ) : null}
                {g.floors.map((f) => (
                  <div className="floor" key={f.id}>
                    <div className="fl" title={f.name}>
                      <span className="fdot" style={floorPaint(f.color) ? { background: floorPaint(f.color)!.bg } : undefined} />
                      <span className="fln">{f.name}</span>
                    </div>
                    <div className="rooms">{f.rooms.map((r) => roomCell(r, f.color))}</div>
                  </div>
                ))}
              </section>
            ))
          : null}
      </div>

      <aside className={`side ${sideCollapsed ? "collapsed" : ""} ${floorTab === "dayuse" ? "show-m" : ""}`}>
        {sideCollapsed ? (
          <div className="side-rail" role="toolbar" aria-label="배치 패널">
            <button
              type="button"
              className="side-rail-btn"
              onClick={() => rememberSideCollapsed(false)}
              aria-label="패널 펼치기"
              title="패널 펼치기"
            >
              <PanelLeftOpen size={18} strokeWidth={2.4} />
            </button>
            <button
              type="button"
              className={`side-rail-btn ${assignBk ? "on" : ""}`}
              onClick={() => rememberSideCollapsed(false)}
              aria-label={`방 미배정 ${uaActiveN}건 · 펼쳐서 방배정`}
              title={`방 미배정 ${uaActiveN}건 · 펼쳐서 방배정`}
            >
              <UserRound size={18} strokeWidth={2.4} />
              {uaActiveN > 0 ? <span className="side-rail-badge">{uaActiveN > 99 ? "99+" : uaActiveN}</span> : null}
            </button>
          </div>
        ) : (
          <>
            <div className="side-top">
              <button
                type="button"
                className="side-collapse-btn"
                onClick={() => rememberSideCollapsed(true)}
                aria-label="패널 접기"
                title="패널 접기"
              >
                <PanelRightClose size={16} strokeWidth={2.4} />
                <span>접기</span>
              </button>
            </div>
            <h3>
              {dayLabel(selDate)} 대실 <small>{activeDayuse}건 · 남은 객실에 포함되지 않아요</small>
            </h3>
            <div className="lst">
              {board.dayuse.length ? (
                board.dayuse.map((d) => (
                  <div key={d.id} {...act} className={`it ${isActive(d) ? "" : "cx"} ${mvB?.id === d.id ? "mvon" : ""}`} onClick={() => !mvB && onOpen(d, selDate)}>
                    <span className="tm">
                      {d.startTime}~{d.endTime}
                    </span>
                    <div className="md">
                      <b>
                        <PlatBadge p={L.plats.get(d.platformId)} />
                        <span className="gn">{d.guestName}</span>
                        {isActive(d) ? null : <span className="cxt">{STATUS[d.status]}</span>}
                      </b>
                      <span>
                        {d.roomId ? `${L.roomLabel(d.roomId) ?? "?"}호` : "방 미배정"} · {typeLabel(L.types.get(d.typeId)) || "?"}
                        {readOnly ? null : ` · ${won(d.price)}원`}
                      </span>
                    </div>
                    {isActive(d) && isCheckedOut(d) ? (
                      <span className="intag done">이용완료</span>
                    ) : isActive(d) && d.arrived ? (
                      <span className="intag">입실 완료</span>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="it muted">이날 대실 기록이 없어요</div>
              )}
              {readOnly ? null : (
                <button className="add" onClick={() => onNew({ kind: "dayuse", checkIn: selDate })}>
                  + 대실 기록
                </button>
              )}
            </div>

            <h3>
              방 미배정 숙박 <small>{uaActiveN}건</small>
            </h3>
            <div className="lst">
              {board.unassigned.length ? (
                board.unassigned.map((b) => {
                  const open = assigning === b.id;
                  const free = open ? freeRooms(s, bookings, b) : null;
                  const t = L.types.get(b.typeId);
                  return (
                    <div key={b.id} className={`it col ${isActive(b) ? "" : "cx"}`}>
                      <div className="itr">
                        <div className="md" {...act} onClick={() => !mvB && onOpen(b, selDate)}>
                          <b>
                            <TypeBadge t={t} />
                            <PlatBadge p={L.plats.get(b.platformId)} />
                            <span className="gn">{b.guestName}</span>
                            {isActive(b) ? null : <span className="cxt">{STATUS[b.status]}</span>}
                          </b>
                          <span>
                            {b.nights}박{readOnly ? "" : ` · ${won(b.price)}원`}{b.checkIn !== selDate ? ` · ${md(b.checkIn)} 입실` : ""}
                          </span>
                        </div>
                        {isActive(b) && !readOnly ? (
                          <button className="btn line sm" onClick={() => setAssigningMode(open ? null : b.id)}>
                            {open ? "닫기" : "방배정"}
                          </button>
                        ) : null}
                      </div>
                      {open && free ? (
                        <div className="rpick">
                          <AssignRoomPick
                            s={s}
                            L={L}
                            free={free}
                            typeId={b.typeId}
                            multi={multi}
                            onPick={(roomId) => requestAssign(b, roomId)}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <div className="it muted">모든 숙박에 방이 배정됐어요</div>
              )}
            </div>

            <div className="sum">
              <div>
                <span>{dayLabel(selDate)} 밤 숙박</span>
                <b>
                  {board.nightCount}실 / {roomCount}실
                </b>
              </div>
              {readOnly ? null : (
                <div>
                  <span>이날 입실 예약 금액</span>
                  <b>{won(dayTotal)}원</b>
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </main>
    {renderAssignModals()}
    </>
  );
}
