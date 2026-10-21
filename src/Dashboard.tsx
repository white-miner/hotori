import { parkingMark } from "../shared/parking";
import ParkingView from "./ParkingView";
import { type TurnWarn, clampHours, inTimeOf, outTimeOf, turnoverWarnings } from "../shared/extratime";
import {
  canCheckOut,
  hotelWallClock,
  isDepartingStatus,
  nowAmountGlance,
  nowByRoom,
  nowFlags,
  nowLists,
  nowMetaLine,
  nowNightRange,
  nowStaySummary,
  shouldAutoArrive,
} from "../shared/nowboard";
import { isLongStay, nightsAtCheckout } from "../shared/longstay";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Car, ChevronLeft, ChevronRight, Footprints, MessageCircle, PanelLeftOpen, PanelRightClose, TriangleAlert, UserRound } from "lucide-react";
import NowNightPopover from "./NowNightPopover";
import AssignCheckoutChoice from "./AssignCheckoutChoice";
import AssignRoomPick from "./AssignRoomPick";
import AssignSwapConfirm from "./AssignSwapConfirm";
import AssignTypeConfirm from "./AssignTypeConfirm";
import NowSidePanel, { type SideMode } from "./NowSidePanel";
import RoomMemoModal from "./RoomMemoModal";
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
  typeLabel,
  typeTotals,
  weekday,
  won,
  legsOf,
} from "../shared/ledger";
import { saveFailMessage } from "../shared/errors";
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
import { isOnsite, isWalkInPlaceholderName, payState } from "../shared/payment";
import { DateChip, FitText, PlatBadge, TypeBadge, TypeLine, floorPaint, lookups } from "./ui";

interface Props {
  data: HotelData;
  today: string;
  selDate: string;
  setSelDate: (d: string) => void;
  onOpen: (b: Booking, night?: string, opts?: { openExtend?: boolean; openSurcharge?: boolean }) => void;
  onNew: (preset: Partial<Booking>) => void;
  /** 간단 예약 축약 폼 (기본 Path A · 미배정) */
  onSimple?: (preset?: Partial<Booking>) => void;
  notify: (m: string, opt?: ToastOpt) => void;
  /** 객실 배치에서 빈 방을 눌러 옮기는 중 */
  move?: BoardMove | null;
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

export default function Dashboard({ data, today, selDate, setSelDate: setSelRaw, onOpen: openRaw, onNew: newRaw, onSimple: simpleRaw, notify, readOnly = false, minDate, maxDate, move = null, onMoveEnd = () => {} }: Props) {
  const setSelDate = (d: string) => setSelRaw(minDate && d < minDate ? minDate : maxDate && d > maxDate ? maxDate : d);
  const onOpen = readOnly ? () => {} : openRaw;
  const onNew = readOnly ? () => {} : newRaw;
  const onSimple = readOnly ? () => {} : (simpleRaw ?? ((preset?: Partial<Booking>) => onNew({ kind: "stay", roomId: null, ...preset })));
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
  const viewBookings = needOld ? (old?.key === oldKey ? old.list : []) : bookings;
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
  const [nowFilter, setNowFilter] = useState<"all" | "tentative">("all");
  const [tentBusy, setTentBusy] = useState(false);
  const [nightPopId, setNightPopId] = useState<string | null>(null);
  const [earlyBusy, setEarlyBusy] = useState<string | null>(null);
  const [memoRoomId, setMemoRoomId] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [sideMode, setSideMode] = useState<SideMode>("simple");
  const memos = useRoomMemos(data.hotel!.id);
  const glanceByRoom = useMemo(() => openMemoGlances(memos.list ?? []), [memos.list]);
  const selectRoom = (roomId: string) => {
    setSelectedRoomId(roomId);
    setSideMode("room");
    setNightPopId(null);
  };
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
  /** 「방배정」모드: 「배치」칸 체크 · 본관·별관 한 풀 · 입실일로 보드 맞춤 */
  const setAssigningMode = (id: string | null) => {
    setAssigning(id);
    setTypeConfirm(null);
    setCheckoutChoice(null);
    if (id) {
      const bk = bookings.find((x) => x.id === id && isActive(x) && !x.roomId);
      setSideMode("simple");
      if (multi) setBTab("all");
      setFloorTab("all");
      if (bk) setSelDate(bk.checkIn);
      setTab("rooms");
    }
  };
  // ---------- 객실 배치에서 옮기기 (+ 활성 투숙 맞교환) ----------
  const mvB = !readOnly && move ? (bookings.find((x) => x.id === move.id && isActive(x)) ?? null) : null;
  const mvNight = mvB ? (mvB.kind === "dayuse" ? mvB.checkIn : move!.night) : null;
  const [pick, setPick] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [swapChoice, setSwapChoice] = useState<RoomSwapPlan | null>(null);
  const [swapTypeGate, setSwapTypeGate] = useState<RoomSwapPlan | null>(null);
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
      return;
    }
    // 옮길 예약이 없어졌거나 취소됐으면 끝
    if (!bookings.some((x) => x.id === move.id && isActive(x))) return onMoveEnd();
    const b = bookings.find((x) => x.id === move.id)!;
    setSelDate(b.kind === "dayuse" ? b.checkIn : move.night);
    setTab("rooms");
    setFloorTab((f) => (f === "dayuse" ? "all" : f));
    setPick(null);
    setSwapChoice(null);
    setSwapTypeGate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move?.id, move?.night]);
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
  const doMove = async () => {
    if (!mvB || !mvNight || !pick || moving) return;
    // 점유 방이면 맞교환 (빈 방만 여기로)
    const swap = swapTargets.get(pick);
    if (swap) {
      requestSwap(swap);
      return;
    }
    const b = mvB;
    const to = pick;
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
      if (siblings.length) setAssigningMode(siblings[0].id);
      else setAssigningMode(null);
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

  const roomCell = (r: (typeof s.floors)[number]["rooms"][number], fColor: string | null | undefined) => {
    const b = board.byRoom.get(r.id);
    const t = r.typeId ? L.types.get(r.typeId) : null;
    const du = dayuseByRoom.get(r.id) ?? [];
    const strip = pastelColor(r.color ?? fColor ?? null);
    const k = /^\d+$/.test(r.no) ? "" : "k";
    const headOf = (extra?: React.ReactNode) => (
      <div className={`r1 ${strip ? "strip" : ""}`} style={strip ? { background: strip } : undefined}>
        <FitText className={`no ${k}`} text={r.no} />
        {extra}
      </div>
    );
    const head = headOf();
    const tline = <TypeLine t={t} />;
    const duTags = du.map((d) => (
      <span key={d.id} className="du">
        대실 {d.startTime}~{d.endTime}
      </span>
    ));
    // 옮기는 중: 빈 방(초록) · 맞교환 가능 점유(파란빛) · 같은 타입 더 진하게 · 나머지 흐리게
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
    const mvAttr = mvB ? (mvOk ? { role: "button" as const, tabIndex: 0, "aria-label": `${r.no}호로 옮기기` } : { "aria-disabled": true }) : act;
    if (!b)
      return (
        <div
          key={r.id}
          {...mvAttr}
          className={`cell em ${du.length ? "duc" : ""} ${du.some((d) => d.arrived) ? "in" : ""} ${readOnly ? "ro" : ""} ${mvCls} ${assignCls}`}
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
          {tline}
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
    // 배정 모드: 점유 칸은 체크 없음 · 흐리게만
    const occAssignCls = assignMode ? "assign-off" : "";
    return (
      <div
        key={r.id}
        {...mvAttr}
        className={`cell bk ${b.groupId ? "grp" : ""} ${cancelled ? "cx" : du.length ? "st hasdu" : "st"} ${!cancelled && b.arrived ? "in" : ""} ${!cancelled && b.tentative ? "tent" : ""} ${!cancelled && b.noClean ? "ncx" : ""} ${readOnly ? "ro" : ""} ${mvCls} ${occAssignCls}`}
        onClick={
          mvClick ??
          (() => {
            if (assignMode) return;
            onOpen(b, selDate);
          })
        }
        onKeyDown={mvClick ? (e) => e.key === "Enter" && mvClick() : undefined}
      >
        {!cancelled && du.length ? (
          <span className="dumark" title={du.map((d) => `대실 ${d.startTime}~${d.endTime}`).join(" · ")}>
            <i>대실 </i>
            {du[0].startTime}
            {du.length > 1 ? <em> +{du.length - 1}</em> : null}
          </span>
        ) : null}
        {pm}
        {headOf(
          <>
            {b.guests && !cancelled ? <span className="gcount" title={`인원 ${b.guests}명`}>{b.guests}명</span> : null}
          </>,
        )}
        {tline}
        <div className="nm">
          <PlatBadge p={L.plats.get(b.platformId)} />
          <span>{b.guestName}</span>
          {!cancelled && isWalkInPlaceholderName(b.guestName) ? (
            <span className="wiittag" title="바로 입실 · 이름·연락처 미입력">
              바로입실
            </span>
          ) : null}
          {!cancelled && b.noClean ? <span className="ncxtag" title="청소하지 않음">청소X</span> : null}
          {!cancelled && b.tentative ? <span className="tenttag" title="임시 배치 · 재고는 막혀 있어요">임시</span> : null}
          {b.groupId ? <span className="grptag" title={`단체 ${b.groupName ?? ""}`}>단체</span> : null}
        </div>
        <div className="r3 rp">
          {readOnly ? (
            <span />
          ) : (
            ((left) =>
              left > 0 ? (
                <span className="pr dueamt" title={isLongStay(b) ? `미수 ${won(left)}원` : `판매 가격 ${won(b.price)}원`}>
                  {isLongStay(b) ? "미수" : "잔금"} {won(left)}
                </span>
              ) : isLongStay(b) ? (
                <span className="pr muted">장기</span>
              ) : (
                <span className="pr">{won(b.price)}</span>
              ))(cancelled || b.groupId ? 0 : payState(b, L.plats.get(b.platformId)).left)
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
              <span>{b.nights === 1 ? "1박" : !cancelled && isEarlyOut(b) && nth === usedNights(b) ? `${nth}박째 · 중도 퇴실` : `${b.nights}박 중 ${nth}박째`}</span>
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

  /** 퇴실처리: 칸 하단 「퇴실예정」탭은 확인 필수 · 옆 패널도 동일 */
  const doCheckOut = async (b: Booking, needConfirm = false) => {
    if (readOnly || coBusy || !canCheckOut(b, today)) return;
    if (needConfirm) {
      const room = b.roomId ? L.roomLabel(b.roomId) ?? "" : "";
      const dates = nowNightRange(b).label;
      if (!window.confirm(`퇴실처리할까요?\n${room ? `${room} · ` : ""}${b.guestName} · ${dates}`)) return;
    }
    setCoBusy(b.id);
    try {
      const patch: Parameters<typeof data.patchBooking>[1] = { checkedOutAt: new Date().toISOString(), arrived: true };
      if (isLongStay(b) && stayEnd(b) > today) {
        const n = nightsAtCheckout(b.checkIn, today);
        patch.nights = n;
        patch.segments = fitSegments(b.segments, b.roomId, n);
      }
      await data.patchBooking(b.id, patch);
      notify(`${b.guestName} 님 퇴실처리했어요`);
    } catch {
      notify("퇴실처리를 저장하지 못했어요. 다시 해 주세요");
    } finally {
      setCoBusy(null);
    }
  };

  const nowCell = (r: (typeof s.floors)[number]["rooms"][number], fColor: string | null | undefined) => {
    const b = nowBoardMap.get(r.id);
    const t = r.typeId ? L.types.get(r.typeId) : null;
    const strip = pastelColor(r.color ?? fColor ?? null);
    const k = /^\d+$/.test(r.no) ? "" : "k";
    const glance = glanceByRoom.get(r.id);
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
    if (!b || !isActive(b)) {
      if (nowFilter === "tentative") return null;
      const emptySel = selectedRoomId === r.id;
      return (
        <div
          key={r.id}
          {...act}
          className={`cell em nowempty ${emptySel ? "nowsel" : ""} ${readOnly ? "ro" : ""}`}
          onClick={() => selectRoom(r.id)}
        >
          <div className="cell-body nowstack sparse">
            {head}
            <TypeLine t={t} />
            <div className="nowstatus-slot">
              <span className="nowstatus nk-empty">공실</span>
            </div>
          </div>
        </div>
      );
    }
    const f = nowFlags(b, today, nowOpts);
    if (nowFilter === "tentative" && !f.tentative) return null;
    const nights = nowNightRange(b);
    // 숙박예약(입실 전)은 박째 숨김 · 1박도 총박·일만 (nowStaySummary)
    const staySummary = nowStaySummary(b, today, f.kind !== "arriving");
    const amount = nowAmountGlance(b, L.plats.get(b.platformId));
    const meta = nowMetaLine(b);
    const popOpen = nightPopId === b.id;
    const doEarlyIn = async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (readOnly || earlyBusy || b.arrived) return;
      setEarlyBusy(b.id);
      try {
        await data.patchBooking(b.id, { arrived: true });
        notify(`${b.guestName} 님 빠른 입실했어요`);
      } catch {
        notify("빠른 입실을 저장하지 못했어요. 다시 해 주세요");
      } finally {
        setEarlyBusy(null);
      }
    };
    const onStatusTap = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (readOnly) return;
      if (isDepartingStatus(f.kind) && canCheckOut(b, today)) {
        void doCheckOut(b, true);
        return;
      }
      selectRoom(r.id);
    };
    const occupiedSel = selectedRoomId === r.id;
    return (
      <div
        key={r.id}
        {...act}
        className={`cell bk nowcell nk-${f.kind} ${occupiedSel ? "nowsel" : ""} ${f.tentative ? "tent" : ""} ${f.group ? "grp" : ""} ${f.noClean ? "ncx" : ""} ${f.arrived ? "in" : ""} ${readOnly ? "ro" : ""}`}
        onClick={() => selectRoom(r.id)}
      >
        <div className="cell-body nowstack dense">
          {head}
          <TypeLine t={t} />
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
          {staySummary ? <span className="nowchip nownights">{staySummary}</span> : null}
          <div className="nm">
            <PlatBadge p={L.plats.get(b.platformId)} />
            <span>{b.guestName}</span>
            {isWalkInPlaceholderName(b.guestName) ? (
              <span className="wiittag" title="바로 입실 · 이름·연락처 미입력">
                바로입실
              </span>
            ) : null}
            {f.noClean ? <span className="ncxtag" title="청소하지 않음">청소X</span> : null}
            {f.tentative ? <span className="tenttag">임시</span> : null}
            {f.longStay ? <span className="longtag" title="장기 · 퇴실 미정">장기</span> : null}
            {f.group ? <span className="grptag">단체</span> : null}
          </div>
          {amount ? (
            <div className="nowamt" title={f.longStay ? "미수" : "요금·잔금"}>
              {amount}
            </div>
          ) : null}
          {meta ? <div className="nowmeta">{meta}</div> : null}
          <div className="nowstatus-slot">
            {!readOnly && f.kind === "arriving" && !b.arrived ? (
              <button type="button" className="nowearly" disabled={earlyBusy === b.id} onClick={(e) => void doEarlyIn(e)}>
                {earlyBusy === b.id ? "처리 중…" : "빠른 입실"}
              </button>
            ) : null}
            <button
              type="button"
              className={`nowstatus nk-${f.kind}${isDepartingStatus(f.kind) ? " tap" : ""}`}
              onClick={onStatusTap}
              title={isDepartingStatus(f.kind) ? "탭하면 퇴실처리" : f.label}
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
              <button type="button" className={`chip ${nowFilter === "all" ? "on" : ""}`} onClick={() => setNowFilter("all")}>
                전체
              </button>
              <button type="button" className={`chip ${nowFilter === "tentative" ? "on" : ""}`} onClick={() => setNowFilter("tentative")}>
                임시만{nowSide.tentative.length ? ` ${nowSide.tentative.length}` : ""}
              </button>
              {!readOnly && nowSide.tentative.length ? (
                <button type="button" className="btn sm dark" disabled={tentBusy} onClick={() => void confirmAllTentative()}>
                  {tentBusy ? "확정 중…" : `임시 ${nowSide.tentative.length}건 확정`}
                </button>
              ) : null}
              <button type="button" className="btn sm line" onClick={() => setTab("rooms")}>
                판매·배치로
              </button>
            </div>
          </div>
          {buildingTabs}
          <div className="nowlayout">
            <div className="nowgrid">
              {multi && bScope === "all" ? null : null}
              {groupsNow.map(({ bd, floors: fl }) => (
                <section key={bd.id} className="bblock">
                  {multi ? <h2 className="bname">{L.buildings.get(bd.id)?.name ?? bd.name}</h2> : null}
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
            <NowSidePanel
              today={today}
              s={s}
              L={L}
              unassigned={nowSide.unassigned}
              lateOut={nowSide.lateOut}
              departing={nowSide.departing}
              selectedRoomId={selectedRoomId}
              selectedBooking={selectedRoomId ? (nowBoardMap.get(selectedRoomId) ?? null) : null}
              mode={sideMode}
              onMode={setSideMode}
              glanceByRoom={glanceByRoom}
              readOnly={readOnly}
              assigning={assigning}
              setAssigning={setAssigningMode}
              coBusy={coBusy}
              onOpen={onOpen}
              onSimple={onSimple}
              onCheckOut={(bk, need) => void doCheckOut(bk, need)}
              onMemo={setMemoRoomId}
              nowOpts={nowOpts}
            />
          </div>
          <div className="lg nowlg">
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
        {mvB && mvNight ? (
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
        ) : null}
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
        {buildingTabs}
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
                    {isActive(d) && d.arrived ? <span className="intag">입실 완료</span> : null}
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
