import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Ban, CalendarPlus, CircleDollarSign, Clock, FileText, Link2, Lock, LogIn, Undo2, Wand2 } from "lucide-react";
import { STAY_CONFIRM_COPY } from "../shared/hotelBiz";
import { DAMAGE_COPY } from "../shared/damageDoc";
import StayConfirmLetter from "./StayConfirmLetter";
import DamageLetter from "./DamageLetter";
import { ensureHotelBizReady } from "./hotelBizGate";
import { useDamageIssues } from "./data";
import {
  canCheckOut,
  canEndDayuse,
  filterUnassignedByCheckIn,
  type NowKind,
  nowAmountGlance,
  nowFlags,
  nowNightRange,
  simplePayGlance,
} from "../shared/nowboard";
import { filterOpsBookings } from "../shared/guestSearch";
import OpsPanelSearch from "./OpsPanelSearch";
import UaSortBar from "./UaSortBar";
import { sortUnassigned, UA_SORT_DEFAULT, type UaSort } from "../shared/uaSort";
import { CHECKOUT_UNDO_CTA } from "../shared/checkoutUndo";
import { isLongStay } from "../shared/longstay";
import {
  type Booking,
  type HotelSettings,
  type Room,
  allRooms,
  isActive,
  md,
  typeLabel,
  won,
} from "../shared/ledger";
import { isOnsite, payLineMain, payState } from "../shared/payment";
import { payLineSub } from "../shared/addSurcharge";
import { CLEAN_REQUEST_COPY } from "../shared/cleanRequest";
import { DAYUSE_SALE_CTA } from "../shared/dayuseSale";
import { STAY_SALE_CTA } from "../shared/staySale";
import {
  PAYMENT_DESK_CTA,
  canOpenPaymentDesk,
  opsPayHistoryLines,
  paymentDeskGlance,
} from "../shared/paymentDesk";
import { groupSettleGlance, type GroupInfo } from "../shared/settle";
import { LATE_OUT_CTA, canAddTime } from "../shared/addTime";
import { EARLY_IN_CTA } from "../shared/earlyInPay";
import { EXTEND_COPY, canExtend } from "../shared/extend";
import {
  CONNECT_STAY_COPY,
  canConnectPrior,
  priorOf,
  successorsOf,
} from "../shared/succeedStay";
import { EDIT_COPY } from "../shared/bookingEdit";
import {
  ROOM_HOLD_CREATE_CTA,
  ROOM_HOLD_RELEASE_CTA,
  ROOM_HOLD_STATUS,
  holdDateLabel,
  type RoomHold,
} from "../shared/roomHold";
import type { OpenMemoGlance } from "../shared/roomMemo";
import CleanRequestModal from "./CleanRequestModal";
import { PlatBadge, lookups } from "./ui";
import type { CleanRequestChoice } from "../shared/cleanRequest";

export type SideMode = "room" | "simple" | "out";

type L = ReturnType<typeof lookups>;

const MODE_LABEL: Record<SideMode, string> = {
  room: "선택 객실",
  simple: "간단 예약",
  out: "퇴실",
};

interface Props {
  today: string;
  hotelId: string;
  /** hotels.name · 숙박확인서 상호 fallback */
  hotelName: string;
  s: HotelSettings;
  L: L;
  unassigned: Booking[];
  /** 미배정 정렬 (현황·배치 공용, 기본 입실일 오름차순) */
  uaSort?: UaSort;
  onUaSort?: (s: UaSort) => void;
  /** 오늘 미배정 전체를 자동 배정 미리보기로 (검색과 무관) */
  onAutoAssign?: (list: Booking[]) => void;
  /** 플랫폼 필터에 안 걸리는 미배정 행을 흐리게 (숨기지 않음) */
  dimOf?: (b: Booking) => boolean;
  lateOut: Booking[];
  departing: Booking[];
  /** 「현황」선택 호실 (공실 복수 · 점유 단실) */
  selectedRoomIds: string[];
  selectedBooking: Booking | null;
  mode: SideMode;
  onMode: (m: SideMode) => void;
  glanceByRoom: Map<string, OpenMemoGlance>;
  readOnly?: boolean;
  assigning: string | null;
  setAssigning: (id: string | null) => void;
  coBusy: string | null;
  onOpen: (b: Booking, night?: string, opts?: { openExtend?: boolean; openSurcharge?: boolean }) => void;
  onSimple: (preset?: Partial<Booking>, opts?: { roomIds?: string[] }) => void;
  /** 공실/점유 → 「숙박 판매」= StaySaleModal (SimpleBooking 금지) */
  onStaySale?: () => void;
  staySaleCta?: string | null;
  /** 선택 호실 당일 대실 (현황 · 숙박 축과 분리) */
  dayuseForRoom?: Booking[];
  /** 단실 「대실 판매」→ DayuseSaleModal (Entry 금지 · MiniFloorPlan 금지) */
  onNewDayuse?: () => void;
  onCheckOut: (b: Booking, needConfirm?: boolean) => void;
  /** 선택 공실 · 최근 퇴실처리 건 (되돌리기 CTA) · MiniFloorPlan 금지 */
  recentCheckedOut?: Booking | null;
  /** 퇴실처리 되돌리기 · askConfirm 후 checkedOutAt null */
  onUndoCheckOut?: (b: Booking) => void;
  /** 당일 대실 「이용 종료」· confirm 후 checkedOutAt */
  onEndDayuse?: (b: Booking) => void;
  onMemo: (roomId: string) => void;
  /** 점유/예약 단실 → 현황 보드 객실 이동 모드 */
  onRoomMove?: () => void;
  /** 이동 모드 중이면 CTA 비활성 */
  moving?: boolean;
  /** 청소 요청 팝업 확정 → patchBooking({ noClean }) */
  onSetNoClean?: (b: Booking, noClean: boolean) => void;
  ncxBusy?: string | null;
  /** 결제/납입 데스크 (단실 · 동일 groupId 복수). b 주면 그 예약 기준 */
  onPaymentDesk?: (b?: Booking) => void;
  /** 다실 단체 「기간 결제」 시트 열기 (null이면 버튼 없음) */
  onGroupPay?: (() => void) | null;
  /** 늦은 퇴실 (숙박 lateOut · 대실 종료 연장) · Entry 금지 */
  onLateOut?: (b: Booking) => void;
  /** 1박 연장 (숙박·퇴실예정) · Entry/StaySale 우회 · 라이트 모달 */
  onExtendNight?: (b: Booking) => void;
  /** 연박 연결 · 다른 이름 예약 B → 이 투숙 A (succeeds) */
  onConnectStay?: (b: Booking) => void;
  /** 호텔 전체 예약 (연결 글랜스 · prior/successor) */
  allBookings?: Booking[];
  /** 빠른 입실 (숙박예약 · 미입실) */
  onEarlyIn?: (b: Booking) => void;
  /** 단실 공실 → 임시 마감 모달 */
  onRoomHold?: () => void;
  /** 단실 마감 → 취소 마감 */
  onRoomHoldRelease?: () => void;
  /** 선택 호실의 오늘 홀드 (없으면 null) */
  roomHold?: RoomHold | null;
  roomHoldBusy?: boolean;
  /** 동일 groupId 점유 복수 선택 시 멤버 (패널 글랜스) */
  selectedGroupBookings?: Booking[];
  /** 그룹 정산 정보 (복수 잔금 글랜스) */
  selectedGroupInfo?: GroupInfo | null;
  /** 선택 방의 groupId 형제(단실 포함) · 정산 글랜스 SoT = settle */
  settleMembers?: Booking[];
  settleGroupInfo?: GroupInfo | null;
  nowOpts?: Parameters<typeof nowFlags>[2];
  notify?: (m: string) => void;
}

export default function NowSidePanel({
  today,
  hotelId,
  hotelName,
  s,
  L,
  unassigned,
  uaSort = UA_SORT_DEFAULT,
  onAutoAssign,
  onUaSort,
  dimOf,
  lateOut,
  departing,
  selectedRoomIds,
  selectedBooking,
  mode,
  onMode,
  glanceByRoom,
  readOnly = false,
  assigning,
  setAssigning,
  coBusy,
  onOpen,
  onSimple,
  onStaySale,
  staySaleCta,
  dayuseForRoom = [],
  onNewDayuse,
  onCheckOut,
  recentCheckedOut = null,
  onUndoCheckOut,
  onEndDayuse,
  onMemo,
  onRoomMove,
  moving = false,
  onSetNoClean,
  ncxBusy = null,
  onPaymentDesk,
  onGroupPay,
  onLateOut,
  onExtendNight,
  onConnectStay,
  allBookings = [],
  onEarlyIn,
  onRoomHold,
  onRoomHoldRelease,
  roomHold = null,
  roomHoldBusy = false,
  selectedGroupBookings = [],
  selectedGroupInfo = null,
  settleMembers = [],
  settleGroupInfo = null,
  nowOpts,
  notify,
}: Props) {
  const [opsQuery, setOpsQuery] = useState("");
  const [outZoneOpen, setOutZoneOpen] = useState(false);
  const [cleanAsk, setCleanAsk] = useState<Booking | null>(null);
  const [stayConfirm, setStayConfirm] = useState<Booking | null>(null);
  const [damageBooking, setDamageBooking] = useState<Booking | null>(null);
  const [damageBusy, setDamageBusy] = useState(false);
  const damages = useDamageIssues(hotelId);

  const opsMeta = (b: Booking) => {
    const p = L.plats.get(b.platformId);
    return {
      typeName: typeLabel(L.types.get(b.typeId)),
      platformName: p?.name ?? null,
      platformAbbr: p?.abbr ?? null,
    };
  };

  /** 「현황」= 오늘만 (기한초과 포함). 일주일/한달 칩은 「배치」사이드. */
  const todayUa = useMemo(() => sortUnassigned(filterUnassignedByCheckIn(unassigned, today, "today"), uaSort).filter((b) => b.status === "active"), [unassigned, today, uaSort]);
  const filteredUa = useMemo(() => {
    const byDate = sortUnassigned(filterUnassignedByCheckIn(unassigned, today, "today"), uaSort);
    return filterOpsBookings(byDate, opsQuery, opsMeta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unassigned, today, opsQuery, L, uaSort]);
  const outList = useMemo(() => {
    const raw = [...lateOut, ...departing];
    return filterOpsBookings(raw, opsQuery, opsMeta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lateOut, departing, opsQuery, L]);
  const outCount = outList.length;
  /** 탭 배지 = 오늘 미배정 (검색과 무관) */
  const todayUaCount = unassigned.length;
  // E: 퇴실예정이 없으면 퇴실처리 존을 접음 (수동 펼침 가능)
  const showOutZone = outCount > 0 || outZoneOpen;

  const selectedRoomId = selectedRoomIds.length === 1 ? selectedRoomIds[0] : selectedRoomIds[selectedRoomIds.length - 1] ?? null;
  const multiGroup = selectedGroupBookings.length > 1;
  const multiVacant = selectedRoomIds.length > 1 && !selectedBooking && !multiGroup;
  const selectedRoom: (Room & { typeId?: string | null }) | null = selectedRoomId
    ? (L.rooms.get(selectedRoomId) ?? allRooms(s).find((r) => r.id === selectedRoomId) ?? null)
    : null;
  const b = selectedBooking;
  const roomLabels = selectedRoomIds.map(
    (id) => L.roomLabel(id) ?? allRooms(s).find((r) => r.id === id)?.no ?? id,
  );
  const roomLabel = roomLabels.length ? roomLabels.map((n) => `${n}호`).join(", ") : null;
  const typeId = b?.typeId ?? selectedGroupBookings[0]?.typeId ?? selectedRoom?.typeId ?? null;
  const t = typeId ? L.types.get(typeId) : null;
  const f = b ? nowFlags(b, today, nowOpts) : null;
  const plat = b ? L.plats.get(b.platformId) : null;
  const ps = b && !b.priceUnset ? payState(b, plat) : null;
  const balGlance = useMemo(() => {
    // 단체: 형제+GroupInfo settle (칸 nowAmountGlance와 동일 SoT · 단체 수납 반영)
    if (settleMembers.length >= 1 && settleMembers[0]?.groupId) {
      const p0 = L.plats.get(settleMembers[0]!.platformId);
      return paymentDeskGlance(settleMembers, p0, settleGroupInfo);
    }
    if (multiGroup && selectedGroupBookings.length > 1) {
      const p0 = L.plats.get(selectedGroupBookings[0]!.platformId);
      return paymentDeskGlance(selectedGroupBookings, p0, selectedGroupInfo);
    }
    if (b && !b.priceUnset) return paymentDeskGlance([b], plat);
    return null;
  }, [settleMembers, settleGroupInfo, multiGroup, selectedGroupBookings, selectedGroupInfo, b, plat, L.plats]);
  /** P1 단체 N/K 스트립 · 단체납/대납 (settleMode 없음) */
  const grpGlance = useMemo(() => {
    if (settleMembers.length >= 1 && settleMembers[0]?.groupId) {
      const p0 = L.plats.get(settleMembers[0]!.platformId);
      return groupSettleGlance(settleMembers, settleGroupInfo, p0);
    }
    if (multiGroup && selectedGroupBookings.length > 1) {
      const p0 = L.plats.get(selectedGroupBookings[0]!.platformId);
      return groupSettleGlance(selectedGroupBookings, selectedGroupInfo, p0);
    }
    if (b?.groupId && settleMembers.length === 0) {
      // 형제 미전달 시 단실만 — N=1 글랜스
      return groupSettleGlance([b], settleGroupInfo, plat);
    }
    return null;
  }, [settleMembers, settleGroupInfo, multiGroup, selectedGroupBookings, selectedGroupInfo, b, plat, L.plats]);
  /** 운영 = 통합 원장: 받을·받은·남은 + 이력(최신 위). 칸 하이브리드(최근액)와 분리 */
  const payHistMembers =
    settleMembers.length >= 1 && settleMembers[0]?.groupId
      ? settleMembers
      : multiGroup && selectedGroupBookings.length > 1
        ? selectedGroupBookings
        : b
          ? [b]
          : [];
  const payHistInfo =
    settleMembers.length >= 1 && settleMembers[0]?.groupId
      ? settleGroupInfo
      : multiGroup
        ? selectedGroupInfo
        : settleGroupInfo;
  const payHist = useMemo(
    () => (payHistMembers.length ? opsPayHistoryLines(payHistMembers, payHistInfo) : []),
    [payHistMembers, payHistInfo],
  );
  /** 운영 요금 줄: 잔금 또는 판매가(통합) · 칸 최근 결제액 아님 */
  const feeDisplay = (() => {
    if (!b) return null;
    if (b.priceUnset) return "금액미정";
    if (balGlance?.tracked && balGlance.left > 0) return `잔금 ₩${won(balGlance.left)}`;
    if (!balGlance && ps?.tracked && ps.left > 0) return `잔금 ₩${won(ps.left)}`;
    if (b.price > 0) return `₩${won(b.price)}`;
    return "—";
  })();
  const glance = selectedRoomId && !multiVacant && !multiGroup ? glanceByRoom.get(selectedRoomId) : undefined;
  const todayUaForType =
    typeId && !b && !multiVacant && !multiGroup
      ? unassigned.filter((u) => u.typeId === typeId && u.checkIn <= today).length
      : 0;
  const dayuseCtaLabel =
    !readOnly && onNewDayuse && selectedRoomIds.length === 1 ? DAYUSE_SALE_CTA : null;
  const payTarget = multiGroup ? selectedGroupBookings[0] : b;
  const showPaymentDesk = !readOnly && onPaymentDesk && payTarget && canOpenPaymentDesk(payTarget);

  const nowliTone = (label: string, tentative?: boolean) => {
    if (tentative) return "tent";
    if (label === "미배정" || label === "간단 예약") return "ua";
    if (label === "숙박예약") return "info";
    if (label === "숙박") return "stay";
    if (label === "퇴실예정") return "warn";
    if (label === "늦은 퇴실") return "danger";
    if (label === "공실") return "empty";
    return "";
  };

  /** Dense list row only — no per-row 「퇴실처리」 bar (ops-panel-list-density).
   * Checkout: 칸 퇴실예정 → confirm · or 선택 객실 compact CTA. */
  const sideRow = (x: Booking, label: string) => (
    <div key={x.id} className={`nowli-wrap ${x.tentative ? "tent" : ""} ${x.noClean ? "ncx" : ""} ${isLongStay(x) ? "long" : ""}`}>
      <button type="button" className={`nowli ${x.tentative ? "tent" : ""} ${x.noClean ? "ncx" : ""}`} onClick={() => onOpen(x, today)} disabled={readOnly}>
        <span className={`nowli-t ${nowliTone(label, x.tentative)}`}>{label}</span>
        <b>{x.guestName}</b>
        <span className="muted sm">
          {x.roomId ? `${L.roomLabel(x.roomId)}호` : typeLabel(L.types.get(x.typeId))}
          {x.groupName ? ` · ${x.groupName}` : ""}
          {isLongStay(x) ? " · 장기" : ""}
          {x.tentative ? " · 임시" : ""}
          {x.noClean ? " · 청소X" : ""}
        </span>
      </button>
    </div>
  );

  const uaRow = (x: Booking) => {
    const open = assigning === x.id;
    const p = L.plats.get(x.platformId);
    const glanceAmt = nowAmountGlance(x, p);
    const payG = simplePayGlance(x, isOnsite(p));
    // Dense row · 「방배정」→「배치」칸 체크 (칩 펼침/빈 존 금지 · 현황 좌표 유지)
    return (
      <div key={x.id} className={`side-ua-row ${open ? "open" : ""} ${dimOf?.(x) ? "pf-dim" : ""}`}>
        <div className="side-ua-main">
          <button type="button" className="side-ua-info" onClick={() => onOpen(x, today)} disabled={readOnly}>
            <span className="side-ua-l1">
              <b>{x.guestName}</b>
              {glanceAmt ? <span className="side-ua-amt">{glanceAmt}</span> : null}
            </span>
            <span className="side-ua-l2 muted sm">
              {typeLabel(L.types.get(x.typeId))}
              {x.nights ? ` · ${x.nights}박` : ""}
              {x.groupName ? ` · ${x.groupName}` : ""}
              {` · ${md(x.checkIn)}`}
              {payG ? ` · ${payG}` : ""}
            </span>
          </button>
          {isActive(x) && !readOnly ? (
            <button
              type="button"
              className={`side-ua-assign ${open ? "on" : ""}`}
              aria-pressed={open}
              aria-label={open ? "방배정 취소" : "방배정 · 배치로"}
              onClick={() => setAssigning(open ? null : x.id)}
            >
              {open ? "취소" : "방배정"}
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const kindLabel = (k: NowKind | undefined) => {
    if (!k || k === "empty") return "공실";
    if (k === "arriving") return "숙박예약";
    if (k === "inhouse") return "숙박";
    if (k === "departing") return "퇴실예정";
    if (k === "lateOut") return "늦은 퇴실";
    if (k === "unassigned") return "미배정";
    return f?.label ?? "";
  };

  /** 당일 대실 목록 · 행 탭=Entry · 「이용 종료」= board-side end (숙박 퇴실축과 분리) */
  const dayuseList = dayuseForRoom.length ? (
    <div className="nsel-du" role="list" aria-label="당일 대실">
      {dayuseForRoom.map((d) => (
        <div key={d.id} className="nsel-du-item" role="listitem">
          <button
            type="button"
            className="nsel-du-row"
            disabled={readOnly}
            onClick={() => onOpen(d, today)}
          >
            <span className="nsel-du-t">
              대실 {d.startTime}~{d.endTime}
            </span>
            <span className="nsel-du-n">{d.guestName || "이름 없음"}</span>
            {d.price > 0 ? <span className="nsel-du-p">{won(d.price)}원</span> : null}
          </button>
          <div className="nsel-du-acts">
            {!readOnly && onLateOut && canAddTime(d) ? (
              <button
                type="button"
                className="nowext side"
                disabled={moving}
                onClick={() => onLateOut(d)}
              >
                {LATE_OUT_CTA}
              </button>
            ) : null}
            {!readOnly && onEndDayuse && canEndDayuse(d) ? (
              <button
                type="button"
                className="nowext side nowco"
                disabled={moving || coBusy === d.id}
                onClick={() => void onEndDayuse(d)}
              >
                {coBusy === d.id ? "처리 중…" : "이용 종료"}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  ) : null;

  /** selection-first: 공실=신규 · 점유 숙박=연장·입·퇴 · 퇴실예정=다음 손님 판매도 StaySale */
  const showStaySell =
    !!staySaleCta &&
    !!onStaySale &&
    !multiGroup &&
    ((!b && selectedRoomIds.length > 0) || (!!b && b.kind === "stay"));
  /** 숙박예약·미입실만 · 이미 입실/늦은퇴실이면 숨김 */
  const showEarlyIn =
    !readOnly && !!onEarlyIn && !!b && b.kind === "stay" && !!f && f.kind === "arriving" && !b.arrived;
  /** 활성 숙박·대실 · 이미 늦은퇴실이어도 조정 시트 입구 유지 */
  const showLateOut = !readOnly && !!onLateOut && !!b && canAddTime(b);
  /** 숙박·퇴실예정(lateOut 포함) · 숙박예약(미입실)·장기·공실 숨김 · StaySale 비경유 */
  const showExtendNight =
    !readOnly &&
    !!onExtendNight &&
    !!b &&
    b.kind === "stay" &&
    canExtend(b) &&
    !isLongStay(b) &&
    !!f &&
    (f.kind === "inhouse" || f.kind === "departing" || f.kind === "lateOut");
  const showConnectStay =
    !readOnly &&
    !!onConnectStay &&
    !!b &&
    canConnectPrior(b, today, nowOpts);
  const showInOutCtas = showEarlyIn || showLateOut || showExtendNight;
  const succList = b && allBookings.length ? successorsOf(b.id, allBookings) : [];
  const priorBk = b && allBookings.length ? priorOf(b, allBookings) : null;

  return (
    <aside className="nowside" aria-label="운영">
      <div className="nowside-modes" role="tablist" aria-label="패널 모드">
        {(["room", "simple", "out"] as SideMode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`nowside-mode ${mode === m ? "on" : ""}`}
            onClick={() => onMode(m)}
          >
            {MODE_LABEL[m]}
            {m === "simple" && todayUaCount ? <small>{todayUaCount}</small> : null}
            {m === "out" && outCount ? <small>{outCount}</small> : null}
          </button>
        ))}
      </div>

      <OpsPanelSearch
        id="nowside-ops-search"
        value={opsQuery}
        onChange={setOpsQuery}
        label="운영 목록 검색"
      />

      {mode === "room" ? (
        <div className="nowside-body nowside-room">
          {!selectedRoomIds.length ? (
            <div className="muted sm nowempty-side">칸을 고르면 바로 숙박·대실 판매 · 청소·결제</div>
          ) : (
            <>
              <div className="nsel-head">
                <div className="nsel-no">{roomLabel}</div>
                <div className="nsel-sub">
                  {multiGroup
                    ? `단체 ${selectedGroupBookings.length}실 · 일괄 수납`
                    : multiVacant
                      ? `공실 ${selectedRoomIds.length}실`
                      : roomHold && !b
                        ? `${typeLabel(t) || "타입 미정"} · ${ROOM_HOLD_STATUS}`
                        : `${typeLabel(t) || "타입 미정"}${f ? ` · ${kindLabel(f.kind)}` : " · 공실"}${f?.tentative ? " · 임시" : ""}${f?.longStay ? " · 장기" : ""}`}
                </div>
              </div>
              {b ? (
                <div className="nsel-body">
                  <div className="nsel-row">
                    <span className="nsel-k">게스트</span>
                    <span className="nsel-v">
                      <PlatBadge p={plat} /> {b.guestName}
                    </span>
                  </div>
                  {b.guestPhone ? (
                    <div className="nsel-row">
                      <span className="nsel-k">연락</span>
                      <span className="nsel-v">{b.guestPhone}</span>
                    </div>
                  ) : null}
                  <div className="nsel-row">
                    <span className="nsel-k">일정</span>
                    <span className="nsel-v">
                      {nowNightRange(b).label}
                      {b.nights ? ` · ${b.nights}박` : ""}
                      {b.guests ? ` · ${b.guests}명` : ""}
                    </span>
                  </div>
                  {succList.length ? (
                    <div className="nsel-row" aria-label="연박 연결 후속">
                      <span className="nsel-k">연결</span>
                      <span className="nsel-v">
                        → {succList.map((x) => `${x.guestName}(${x.nights ?? 0}박)`).join(" · ")}
                      </span>
                    </div>
                  ) : null}
                  {priorBk ? (
                    <div className="nsel-row" aria-label="이전 투숙 연결">
                      <span className="nsel-k">이전</span>
                      <span className="nsel-v">← {priorBk.guestName} · 연박 연결</span>
                    </div>
                  ) : null}
                  <div className="nsel-row">
                    <span className="nsel-k">
                      {b.priceUnset
                        ? "요금"
                        : (balGlance?.tracked ? balGlance.left > 0 : !!(ps?.tracked && ps.left > 0))
                          ? "잔금"
                          : "판매금"}
                    </span>
                    <span className="nsel-v">{feeDisplay}</span>
                  </div>
                  {balGlance?.tracked ? (
                    <div className="nsel-row nsel-bal" aria-label="잔금 요약">
                      <span className="nsel-k">정산</span>
                      <span className={`nsel-v nsel-bal-v${balGlance.left > 0 ? " due" : ""}`}>
                        청구 {won(balGlance.due)} · 수납 {won(balGlance.paid)} · 잔액{" "}
                        <b>{won(balGlance.left)}</b>
                      </span>
                    </div>
                  ) : null}
                  {grpGlance ? (
                    <div className="nsel-row nsel-grp-settle" aria-label="단체 정산 글랜스">
                      <span className="nsel-k">단체</span>
                      <span className={`nsel-v nsel-bal-v${grpGlance.k > 0 ? " due" : ""}`}>
                        {grpGlance.strip.replace(/^단체 · /, "")}
                        {grpGlance.badge ? ` · ${grpGlance.badge}` : ""}
                      </span>
                    </div>
                  ) : null}
                  {payHist.length > 0 ? (
                    <div className="nsel-payhist" aria-label="결제 이력">
                      <div className="nsel-payhist-h">결제 이력</div>
                      <ul className="nsel-payhist-list">
                        {payHist.map((line) => (
                          <li key={`${line.scope}-${line.pay.id}`}>
                            <b>{payLineMain(line.pay.method, line.pay.amount)}</b>
                            <span className="muted">
                              {line.scope === "group" ? "단체 · " : ""}
                              {payLineSub(line.pay.kind, line.pay.bizDate, line.pay.note)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {showPaymentDesk ? (
                        <button type="button" className="linkish nsel-payhist-more" disabled={moving} onClick={() => onPaymentDesk?.()}>
                          더보기 · {PAYMENT_DESK_CTA}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="nsel-row nsel-memo">
                    <span className="nsel-k">메모</span>
                    <span className="nsel-v">
                      {glance?.count ? (
                        <button type="button" className="nsel-memobtn" onClick={() => onMemo(selectedRoomId!)}>
                          {glance.preview}
                          {glance.count > 1 ? ` · +${glance.count - 1}` : ""}
                        </button>
                      ) : (
                        <button type="button" className="nsel-memobtn muted" onClick={() => onMemo(selectedRoomId!)} disabled={readOnly}>
                          {readOnly ? "없음" : "메모 입력"}
                        </button>
                      )}
                    </span>
                  </div>
                  {dayuseList}
                  <div className="nsel-acts">
                    {/* 판매: 숙박(빨강·아이콘 없음) → 대실(파랑) · selection-first */}
                    {!readOnly && (dayuseCtaLabel || showStaySell) ? (
                      <div className="nsel-act-sec" role="group" aria-label="판매">
                        {showStaySell ? (
                          <button type="button" className="btn sm stop" disabled={moving} onClick={onStaySale}>
                            {staySaleCta ?? STAY_SALE_CTA}
                          </button>
                        ) : null}
                        {dayuseCtaLabel && onNewDayuse ? (
                          <button type="button" className="btn sm info" disabled={moving} onClick={onNewDayuse}>
                            {dayuseCtaLabel}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {!readOnly && !multiGroup && showInOutCtas ? (
                      <div
                        className={`nsel-act-sec${
                          [showEarlyIn, showLateOut, showExtendNight].filter(Boolean).length > 1
                            ? " nsel-act-row"
                            : ""
                        }`}
                        role="group"
                        aria-label="빠른 입실 · 늦은 퇴실 · 1박 연장"
                      >
                        {showEarlyIn ? (
                          <button
                            type="button"
                            className="btn sm dark"
                            disabled={moving}
                            onClick={() => onEarlyIn?.(b)}
                            aria-label={EARLY_IN_CTA}
                          >
                            <LogIn size={14} strokeWidth={2.2} aria-hidden />
                            {EARLY_IN_CTA}
                          </button>
                        ) : null}
                        {showLateOut ? (
                          <button
                            type="button"
                            className="btn sm stop"
                            disabled={moving}
                            onClick={() => onLateOut?.(b)}
                            aria-label={LATE_OUT_CTA}
                          >
                            <Clock size={14} strokeWidth={2.2} aria-hidden />
                            {LATE_OUT_CTA}
                          </button>
                        ) : null}
                        {showExtendNight ? (
                          <button
                            type="button"
                            className="btn sm dark"
                            disabled={moving}
                            onClick={() => onExtendNight?.(b)}
                            aria-label={EXTEND_COPY}
                          >
                            <CalendarPlus size={14} strokeWidth={2.2} aria-hidden />
                            {EXTEND_COPY}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {!readOnly && !multiGroup && showConnectStay ? (
                      <div className="nsel-act-sec" role="group" aria-label="연박 연결">
                        <button
                          type="button"
                          className="btn sm line"
                          disabled={moving}
                          onClick={() => onConnectStay?.(b)}
                          aria-label={CONNECT_STAY_COPY}
                        >
                          <Link2 size={14} strokeWidth={2.2} aria-hidden />
                          {CONNECT_STAY_COPY}
                        </button>
                      </div>
                    ) : null}
                    {!readOnly && !multiGroup && ((b.kind === "stay" && onSetNoClean) || showPaymentDesk || onGroupPay) ? (
                      <div className="nsel-act-sec nsel-act-row" role="group" aria-label="숙박 운영">
                        {b.kind === "stay" && onSetNoClean ? (
                          <button
                            type="button"
                            className={`btn sm line ncx ${b.noClean ? "on" : ""}`}
                            aria-pressed={b.noClean}
                            disabled={moving || ncxBusy === b.id}
                            onClick={() => setCleanAsk(b)}
                            title="청소 함 / 안 함 선택"
                          >
                            <Ban size={14} strokeWidth={2.2} aria-hidden />
                            {ncxBusy === b.id ? "저장 중…" : CLEAN_REQUEST_COPY}
                          </button>
                        ) : null}
                        {onGroupPay && !readOnly ? (
                          <button type="button" className="btn sm dark" disabled={moving} onClick={onGroupPay}>
                            <CircleDollarSign size={14} strokeWidth={2.2} aria-hidden />
                            기간 결제
                          </button>
                        ) : null}
                        {showPaymentDesk ? (
                          <button
                            type="button"
                            className="btn sm line"
                            disabled={moving}
                            onClick={() => onPaymentDesk?.()}
                            aria-label={PAYMENT_DESK_CTA}
                          >
                            <CircleDollarSign size={14} strokeWidth={2.2} aria-hidden />
                            {PAYMENT_DESK_CTA}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {!readOnly && !multiGroup ? (
                      <div className="nsel-act-sec" role="group" aria-label="이동 · 기록">
                        {onRoomMove ? (
                          <button
                            type="button"
                            className="btn sm dark"
                            disabled={moving}
                            onClick={onRoomMove}
                            aria-label="객실 이동"
                          >
                            <ArrowRightLeft size={14} strokeWidth={2.2} aria-hidden />
                            {moving ? "이동 중…" : "객실 이동"}
                          </button>
                        ) : null}
                        <button type="button" className="btn sm line" disabled={moving} onClick={() => onOpen(b, today)}>
                          {EDIT_COPY}
                        </button>
                        {b.kind === "stay" ? (
                          <button
                            type="button"
                            className="btn sm line"
                            disabled={moving}
                            onClick={() => {
                              void (async () => {
                                if (!(await ensureHotelBizReady(s.hotelBiz, hotelName))) return;
                                setStayConfirm(b);
                              })();
                            }}
                            aria-label={STAY_CONFIRM_COPY}
                          >
                            <FileText size={14} strokeWidth={2.2} aria-hidden />
                            {STAY_CONFIRM_COPY}
                          </button>
                        ) : null}
                        {b.kind === "stay" ? (
                          <button
                            type="button"
                            className="btn sm line"
                            disabled={moving}
                            onClick={() => {
                              void (async () => {
                                if (!(await ensureHotelBizReady(s.hotelBiz, hotelName))) return;
                                setDamageBooking(b);
                              })();
                            }}
                            aria-label={DAMAGE_COPY.title}
                          >
                            <AlertTriangle size={14} strokeWidth={2.2} aria-hidden />
                            {DAMAGE_COPY.cta}
                          </button>
                        ) : null}
                        {f && (f.kind === "departing" || f.kind === "lateOut") && canCheckOut(b, today) ? (
                          <button type="button" className="btn sm line" disabled={moving || coBusy === b.id} onClick={() => void onCheckOut(b, true)}>
                            {coBusy === b.id ? "처리 중…" : "퇴실처리"}
                          </button>
                        ) : null}
                        {selectedRoomId ? (
                          <button type="button" className="btn sm line" disabled={moving} onClick={() => onMemo(selectedRoomId)}>
                            메모
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : multiGroup ? (
                <div className="nsel-body">
                  <div className="muted sm">
                    동일 단체 {selectedGroupBookings.length}실 · {selectedGroupBookings[0]?.groupName || selectedGroupBookings[0]?.guestName}
                  </div>
                  {balGlance?.tracked ? (
                    <div className="nsel-row nsel-bal" aria-label="잔금 요약">
                      <span className="nsel-k">정산</span>
                      <span className={`nsel-v nsel-bal-v${balGlance.left > 0 ? " due" : ""}`}>
                        청구 {won(balGlance.due)} · 수납 {won(balGlance.paid)} · 잔액{" "}
                        <b>{won(balGlance.left)}</b>
                      </span>
                    </div>
                  ) : null}
                  {grpGlance ? (
                    <div className="nsel-row nsel-grp-settle" aria-label="단체 정산 글랜스">
                      <span className="nsel-k">단체</span>
                      <span className={`nsel-v nsel-bal-v${grpGlance.k > 0 ? " due" : ""}`}>
                        {grpGlance.strip.replace(/^단체 · /, "")}
                        {grpGlance.badge ? ` · ${grpGlance.badge}` : ""}
                      </span>
                    </div>
                  ) : null}
                  {payHist.length > 0 ? (
                    <div className="nsel-payhist" aria-label="결제 이력">
                      <div className="nsel-payhist-h">결제 이력</div>
                      <ul className="nsel-payhist-list">
                        {payHist.map((line) => (
                          <li key={`${line.scope}-${line.pay.id}`}>
                            <b>{payLineMain(line.pay.method, line.pay.amount)}</b>
                            <span className="muted">
                              {line.scope === "group" ? "단체 · " : ""}
                              {payLineSub(line.pay.kind, line.pay.bizDate, line.pay.note)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {showPaymentDesk ? (
                        <button type="button" className="linkish nsel-payhist-more" disabled={moving} onClick={() => onPaymentDesk?.()}>
                          더보기 · {PAYMENT_DESK_CTA}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="nsel-acts">
                    {onGroupPay && !readOnly ? (
                      <button type="button" className="btn sm dark" disabled={moving} onClick={onGroupPay}>
                        <CircleDollarSign size={14} strokeWidth={2.2} aria-hidden />
                        기간 결제
                      </button>
                    ) : null}
                    {showPaymentDesk ? (
                      <button type="button" className="btn sm line" disabled={moving} onClick={() => onPaymentDesk?.()}>
                        <CircleDollarSign size={14} strokeWidth={2.2} aria-hidden />
                        {PAYMENT_DESK_CTA}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="nsel-body">
                  <div className="muted sm">
                    {multiVacant
                      ? "선택한 공실"
                      : roomHold
                        ? `${ROOM_HOLD_STATUS} · ${holdDateLabel(roomHold)}${roomHold.note ? ` · ${roomHold.note}` : ""}`
                        : "비어 있음"}
                  </div>
                  {!multiVacant && !roomHold && recentCheckedOut ? (
                    <div className="nsel-row" aria-label="최근 퇴실">
                      <span className="nsel-k">최근 퇴실</span>
                      <span className="nsel-v">
                        <PlatBadge p={L.plats.get(recentCheckedOut.platformId)} /> {recentCheckedOut.guestName}
                        {recentCheckedOut.nights ? ` · ${recentCheckedOut.nights}박` : ""}
                      </span>
                    </div>
                  ) : null}
                  {!multiVacant && !roomHold && todayUaForType > 0 ? (
                    <p className="nsel-hint">
                      이 타입 오늘 입실 미배정 {todayUaForType}건 ·{" "}
                      <button type="button" className="linkish" onClick={() => onMode("simple")}>
                        간단 예약
                      </button>
                      에서 방배정
                    </p>
                  ) : null}
                  {dayuseList}
                  {!readOnly &&
                  (roomHold ||
                    onRoomHold ||
                    showStaySell ||
                    dayuseCtaLabel ||
                    (recentCheckedOut && onUndoCheckOut)) ? (
                    <div className="nsel-acts">
                      {!multiVacant && roomHold && onRoomHoldRelease ? (
                        <div className="nsel-act-sec" role="group" aria-label="마감 해제">
                          <button
                            type="button"
                            className="btn sm dark"
                            disabled={moving || roomHoldBusy}
                            onClick={() => onRoomHoldRelease()}
                            aria-label={ROOM_HOLD_RELEASE_CTA}
                          >
                            <Ban size={14} strokeWidth={2.2} aria-hidden />
                            {roomHoldBusy ? "처리 중…" : ROOM_HOLD_RELEASE_CTA}
                          </button>
                        </div>
                      ) : null}
                      {!multiVacant && !roomHold && onRoomHold ? (
                        <div className="nsel-act-sec" role="group" aria-label="임시 마감">
                          <button
                            type="button"
                            className="btn sm line"
                            disabled={moving || roomHoldBusy}
                            onClick={() => onRoomHold()}
                            aria-label={ROOM_HOLD_CREATE_CTA}
                          >
                            <Lock size={14} strokeWidth={2.2} aria-hidden />
                            {ROOM_HOLD_CREATE_CTA}
                          </button>
                        </div>
                      ) : null}
                      {!multiVacant && !roomHold && recentCheckedOut && onUndoCheckOut ? (
                        <div className="nsel-act-sec" role="group" aria-label="퇴실 되돌리기">
                          <button
                            type="button"
                            className="btn sm dark"
                            disabled={moving || coBusy === recentCheckedOut.id}
                            onClick={() => void onUndoCheckOut(recentCheckedOut)}
                            aria-label={CHECKOUT_UNDO_CTA}
                          >
                            <Undo2 size={14} strokeWidth={2.2} aria-hidden />
                            {coBusy === recentCheckedOut.id ? "처리 중…" : CHECKOUT_UNDO_CTA}
                          </button>
                          <button
                            type="button"
                            className="btn sm line"
                            disabled={moving}
                            onClick={() => onOpen(recentCheckedOut, today)}
                          >
                            {EDIT_COPY}
                          </button>
                        </div>
                      ) : null}
                      {!roomHold && (showStaySell || dayuseCtaLabel) ? (
                        <div className="nsel-act-sec" role="group" aria-label="판매">
                          {showStaySell ? (
                            <button type="button" className="btn sm stop" onClick={onStaySale}>
                              {staySaleCta ?? STAY_SALE_CTA}
                            </button>
                          ) : null}
                          {dayuseCtaLabel && onNewDayuse ? (
                            <button type="button" className="btn sm info" onClick={onNewDayuse}>
                              {dayuseCtaLabel}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
      ) : null}

      {mode === "simple" ? (
        <div className="nowside-body nowside-simple">
          <p className="muted sm nsel-note" title="타입 재고만 · 임시 배치 아님">
            미배정 예약 · 임시와 다름 · 입실일≤오늘
          </p>
          {onUaSort ? <UaSortBar sort={uaSort} onChange={onUaSort} /> : null}
          {onAutoAssign && !readOnly && todayUa.length ? (
            <button type="button" className="btn line sm ua-auto" disabled={assigning != null} onClick={() => onAutoAssign(todayUa)}>
              <Wand2 size={14} strokeWidth={2.4} /> 자동배정 · {todayUa.length}건 미리보기
            </button>
          ) : null}
          {filteredUa.length ? (
            <div className="side-ua-list">{filteredUa.map(uaRow)}</div>
          ) : (
            <div className="muted sm nowempty-side">
              {opsQuery.trim()
                ? "검색 결과 없음"
                : (
                  <>
                    미배정 예약 0 ·{" "}
                    {!readOnly ? (
                      <button type="button" className="linkish" onClick={() => onSimple({ kind: "stay", checkIn: today, roomId: null })}>
                        간단 예약
                      </button>
                    ) : (
                      "간단 예약"
                    )}
                    으로 수납할 수 있어요
                  </>
                )}
            </div>
          )}
        </div>
      ) : null}

      {mode === "out" ? (
        <div className="nowside-body nowside-out">
          <div className="nowsec">
            <h3>퇴실예정 {outCount}</h3>
            {outCount ? (
              outList.map((x) => sideRow(x, lateOut.some((y) => y.id === x.id) ? "늦은 퇴실" : "퇴실예정"))
            ) : (
              <div className="muted sm nowempty-side">오늘 퇴실예정 없어요</div>
            )}
          </div>
          <div className={`nowsec nowco-zone ${showOutZone ? "open" : "collapsed"}`}>
            <button type="button" className="nowco-zone-h" aria-expanded={showOutZone} onClick={() => setOutZoneOpen((v) => !v)}>
              <h3>퇴실처리</h3>
              <span className="muted sm">{outCount ? `${outCount}건 · 칸·선택에서` : "없음 · 접힘"}</span>
            </button>
            {showOutZone ? (
              <div className="nowco-zone-b">
                {outCount ? (
                  <p className="muted sm">칸의 퇴실예정 탭 또는 선택 객실 「퇴실처리」로 확인해요. 자동 공실 없음.</p>
                ) : (
                  <p className="muted sm">퇴실예정이 생기면 여기에 펼쳐져요.</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {cleanAsk && onSetNoClean ? (
        <CleanRequestModal
          guestName={cleanAsk.guestName}
          roomLabel={
            cleanAsk.roomId
              ? `${L.roomLabel(cleanAsk.roomId) ?? allRooms(s).find((r) => r.id === cleanAsk.roomId)?.no ?? ""}호`
              : roomLabel ?? ""
          }
          currentNoClean={!!cleanAsk.noClean}
          busy={ncxBusy === cleanAsk.id}
          onCancel={() => !ncxBusy && setCleanAsk(null)}
          onConfirm={(choice: CleanRequestChoice) => {
            const next = choice === "no_clean";
            if (next === !!cleanAsk.noClean) {
              setCleanAsk(null);
              return;
            }
            onSetNoClean(cleanAsk, next);
            setCleanAsk(null);
          }}
        />
      ) : null}
      {stayConfirm && stayConfirm.kind === "stay" ? (
        <StayConfirmLetter
          booking={stayConfirm}
          hotelName={hotelName}
          s={s}
          today={today}
          onClose={() => setStayConfirm(null)}
        />
      ) : null}
      {damageBooking && damageBooking.kind === "stay" ? (
        <DamageLetter
          hotelName={hotelName}
          s={s}
          today={today}
          booking={damageBooking}
          busy={damageBusy}
          notify={(m) => notify?.(m)}
          onIssue={async (draft) => {
            setDamageBusy(true);
            try {
              return await damages.issue(draft);
            } finally {
              setDamageBusy(false);
            }
          }}
          onClose={() => setDamageBooking(null)}
        />
      ) : null}
    </aside>
  );
}
