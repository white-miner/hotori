import { useMemo, useState } from "react";
import { ArrowRightLeft, Ban, CalendarPlus, CircleDollarSign, Clock, LogIn, Undo2 } from "lucide-react";
import {
  canCheckOut,
  canEndDayuse,
  filterUnassignedByCheckIn,
  type NowKind,
  nowAmountGlance,
  nowFlags,
  nowNightRange,
  simplePayGlance,
  type UaCheckInFilter,
} from "../shared/nowboard";
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
import { isOnsite, payState } from "../shared/payment";
import { CLEAN_REQUEST_COPY } from "../shared/cleanRequest";
import { DAYUSE_SALE_CTA } from "../shared/dayuseSale";
import { STAY_SALE_CTA } from "../shared/staySale";
import { PAYMENT_DESK_CTA, canOpenPaymentDesk, paymentDeskGlance } from "../shared/paymentDesk";
import { groupSettleGlance, type GroupInfo } from "../shared/settle";
import { LATE_OUT_CTA, canAddTime } from "../shared/addTime";
import { EARLY_IN_CTA } from "../shared/earlyInPay";
import { EXTEND_COPY, canExtend } from "../shared/extend";
import type { OpenMemoGlance } from "../shared/roomMemo";
import CleanRequestModal from "./CleanRequestModal";
import { PlatBadge, lookups } from "./ui";
import type { CleanRequestChoice } from "../shared/cleanRequest";

export type SideMode = "room" | "simple" | "out";

type L = ReturnType<typeof lookups>;

const UA_FILTERS: { id: UaCheckInFilter; label: string }[] = [
  { id: "today", label: "오늘" },
  { id: "week", label: "일주일" },
  { id: "month", label: "한달" },
];

const MODE_LABEL: Record<SideMode, string> = {
  room: "선택 객실",
  simple: "간단 예약",
  out: "퇴실",
};

interface Props {
  today: string;
  s: HotelSettings;
  L: L;
  unassigned: Booking[];
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
  /** 늦은 퇴실 (숙박 lateOut · 대실 종료 연장) · Entry 금지 */
  onLateOut?: (b: Booking) => void;
  /** 1박 연장 (숙박·퇴실예정) · Entry/StaySale 우회 · 라이트 모달 */
  onExtendNight?: (b: Booking) => void;
  /** 빠른 입실 (숙박예약 · 미입실) */
  onEarlyIn?: (b: Booking) => void;
  /** 동일 groupId 점유 복수 선택 시 멤버 (패널 글랜스) */
  selectedGroupBookings?: Booking[];
  /** 그룹 정산 정보 (복수 잔금 글랜스) */
  selectedGroupInfo?: GroupInfo | null;
  /** 선택 방의 groupId 형제(단실 포함) · 정산 글랜스 SoT = settle */
  settleMembers?: Booking[];
  settleGroupInfo?: GroupInfo | null;
  nowOpts?: Parameters<typeof nowFlags>[2];
}

export default function NowSidePanel({
  today,
  s,
  L,
  unassigned,
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
  onLateOut,
  onExtendNight,
  onEarlyIn,
  selectedGroupBookings = [],
  selectedGroupInfo = null,
  settleMembers = [],
  settleGroupInfo = null,
  nowOpts,
}: Props) {
  const [uaFilter, setUaFilter] = useState<UaCheckInFilter>("today");
  const [outZoneOpen, setOutZoneOpen] = useState(false);
  const [cleanAsk, setCleanAsk] = useState<Booking | null>(null);

  const filteredUa = useMemo(
    () => filterUnassignedByCheckIn(unassigned, today, uaFilter),
    [unassigned, today, uaFilter],
  );
  const outList = useMemo(() => [...lateOut, ...departing], [lateOut, departing]);
  const outCount = outList.length;
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
  const groupPayCtx =
    b?.groupId && settleMembers.length
      ? { members: settleMembers, info: settleGroupInfo }
      : null;
  const amount = b ? nowAmountGlance(b, plat, groupPayCtx) : null;
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
      <div key={x.id} className={`side-ua-row ${open ? "open" : ""}`}>
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
  const showInOutCtas = showEarlyIn || showLateOut || showExtendNight;

  return (
    <aside className="nowside" aria-label="운영">
      <div className="nowside-h">운영</div>
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
            {m === "simple" && unassigned.length ? <small>{unassigned.length}</small> : null}
            {m === "out" && outCount ? <small>{outCount}</small> : null}
          </button>
        ))}
      </div>

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
                  <div className="nsel-row">
                    <span className="nsel-k">
                      {b.priceUnset
                        ? "요금"
                        : (balGlance?.tracked ? balGlance.left > 0 : !!(ps?.tracked && ps.left > 0))
                          ? "잔금"
                          : "판매금"}
                    </span>
                    <span className="nsel-v">
                      {b.priceUnset ? "금액미정" : amount ? amount : b.price > 0 ? `₩${won(b.price)}` : "—"}
                    </span>
                  </div>
                  {balGlance?.tracked ? (
                    <div className="nsel-row nsel-bal" aria-label="잔금 요약">
                      <span className="nsel-k">정산</span>
                      <span className={`nsel-v nsel-bal-v${balGlance.left > 0 ? " due" : ""}`}>
                        받을 {won(balGlance.due)} · 받은 {won(balGlance.paid)} · 남은{" "}
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
                          {readOnly ? "없음" : "메모 적기"}
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
                    {!readOnly && !multiGroup && ((b.kind === "stay" && onSetNoClean) || showPaymentDesk) ? (
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
                          예약 기록 열기
                        </button>
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
                        받을 {won(balGlance.due)} · 받은 {won(balGlance.paid)} · 남은{" "}
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
                  <div className="nsel-acts">
                    {showPaymentDesk ? (
                      <button type="button" className="btn sm dark" disabled={moving} onClick={() => onPaymentDesk?.()}>
                        <CircleDollarSign size={14} strokeWidth={2.2} aria-hidden />
                        {PAYMENT_DESK_CTA}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="nsel-body">
                  <div className="muted sm">{multiVacant ? "선택한 공실" : "비어 있음"}</div>
                  {!multiVacant && recentCheckedOut ? (
                    <div className="nsel-row" aria-label="최근 퇴실">
                      <span className="nsel-k">최근 퇴실</span>
                      <span className="nsel-v">
                        <PlatBadge p={L.plats.get(recentCheckedOut.platformId)} /> {recentCheckedOut.guestName}
                        {recentCheckedOut.nights ? ` · ${recentCheckedOut.nights}박` : ""}
                      </span>
                    </div>
                  ) : null}
                  {!multiVacant && todayUaForType > 0 ? (
                    <p className="nsel-hint">
                      이 타입 오늘 입실 미배정 {todayUaForType}건 ·{" "}
                      <button type="button" className="linkish" onClick={() => onMode("simple")}>
                        간단 예약
                      </button>
                      에서 방배정
                    </p>
                  ) : null}
                  {dayuseList}
                  {!readOnly && (showStaySell || dayuseCtaLabel || (recentCheckedOut && onUndoCheckOut)) ? (
                    <div className="nsel-acts">
                      {!multiVacant && recentCheckedOut && onUndoCheckOut ? (
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
                            예약 기록 열기
                          </button>
                        </div>
                      ) : null}
                      {showStaySell || dayuseCtaLabel ? (
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
          <div className="nsel-filters" role="group" aria-label="입실일 필터">
            {UA_FILTERS.map((x) => {
              const n = filterUnassignedByCheckIn(unassigned, today, x.id).length;
              return (
                <button
                  key={x.id}
                  type="button"
                  className={`chip sm ${uaFilter === x.id ? "on" : ""}`}
                  onClick={() => setUaFilter(x.id)}
                >
                  {x.label}
                  <small>{n}</small>
                </button>
              );
            })}
          </div>
          <p className="muted sm nsel-note" title="타입 재고만 · 임시 배치 아님">
            미배정(간단 예약) · 임시와 다름 · 입실일 기준
          </p>
          {filteredUa.length ? (
            <div className="side-ua-list">{filteredUa.map(uaRow)}</div>
          ) : (
            <div className="muted sm nowempty-side">
              미배정 0 ·{" "}
              {!readOnly ? (
                <button type="button" className="linkish" onClick={() => onSimple({ kind: "stay", checkIn: today, roomId: null })}>
                  간단 예약
                </button>
              ) : (
                "간단 예약"
              )}
              으로 받을 수 있어요
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
    </aside>
  );
}
