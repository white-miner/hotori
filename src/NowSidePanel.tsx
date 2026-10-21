import { useMemo, useState } from "react";
import {
  canCheckOut,
  filterUnassignedByCheckIn,
  type NowKind,
  nowAmountGlance,
  nowFlags,
  nowNightRange,
  simplePayGlance,
  type UaCheckInFilter,
} from "../shared/nowboard";
import { EXTEND_COPY, canExtend } from "../shared/extend";
import { SURCHARGE_COPY, canAddSurcharge } from "../shared/addSurcharge";
import { isLongStay } from "../shared/longstay";
import {
  type Booking,
  type HotelSettings,
  type Room,
  allRooms,
  freeRooms,
  isActive,
  md,
  typeLabel,
  won,
} from "../shared/ledger";
import { isOnsite, payState } from "../shared/payment";
import type { OpenMemoGlance } from "../shared/roomMemo";
import { PlatBadge, lookups } from "./ui";

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
  bookings: Booking[];
  unassigned: Booking[];
  lateOut: Booking[];
  departing: Booking[];
  selectedRoomId: string | null;
  selectedBooking: Booking | null;
  mode: SideMode;
  onMode: (m: SideMode) => void;
  glanceByRoom: Map<string, OpenMemoGlance>;
  readOnly?: boolean;
  multi?: boolean;
  assigning: string | null;
  setAssigning: (id: string | null) => void;
  coBusy: string | null;
  onAssign: (b: Booking, roomId: string) => void;
  onOpen: (b: Booking, night?: string, opts?: { openExtend?: boolean; openSurcharge?: boolean }) => void;
  onSimple: (preset?: Partial<Booking>) => void;
  onCheckOut: (b: Booking, needConfirm?: boolean) => void;
  onMemo: (roomId: string) => void;
  nowOpts?: Parameters<typeof nowFlags>[2];
}

export default function NowSidePanel({
  today,
  s,
  L,
  bookings,
  unassigned,
  lateOut,
  departing,
  selectedRoomId,
  selectedBooking,
  mode,
  onMode,
  glanceByRoom,
  readOnly = false,
  multi = false,
  assigning,
  setAssigning,
  coBusy,
  onAssign,
  onOpen,
  onSimple,
  onCheckOut,
  onMemo,
  nowOpts,
}: Props) {
  const [uaFilter, setUaFilter] = useState<UaCheckInFilter>("today");
  const [outZoneOpen, setOutZoneOpen] = useState(false);

  const filteredUa = useMemo(
    () => filterUnassignedByCheckIn(unassigned, today, uaFilter),
    [unassigned, today, uaFilter],
  );
  const outList = useMemo(() => [...lateOut, ...departing], [lateOut, departing]);
  const outCount = outList.length;
  // E: 퇴실예정이 없으면 퇴실처리 존을 접음 (수동 펼침 가능)
  const showOutZone = outCount > 0 || outZoneOpen;

  const selectedRoom: (Room & { typeId?: string | null }) | null = selectedRoomId
    ? (L.rooms.get(selectedRoomId) ?? allRooms(s).find((r) => r.id === selectedRoomId) ?? null)
    : null;
  const b = selectedBooking;
  const roomLabel = selectedRoomId ? L.roomLabel(selectedRoomId) ?? selectedRoom?.no ?? selectedRoomId : null;
  const typeId = b?.typeId ?? selectedRoom?.typeId ?? null;
  const t = typeId ? L.types.get(typeId) : null;
  const f = b ? nowFlags(b, today, nowOpts) : null;
  const plat = b ? L.plats.get(b.platformId) : null;
  const amount = b ? nowAmountGlance(b, plat) : null;
  const ps = b && !b.priceUnset ? payState(b, plat) : null;
  const glance = selectedRoomId ? glanceByRoom.get(selectedRoomId) : undefined;
  const todayUaForType =
    typeId && !b ? unassigned.filter((u) => u.typeId === typeId && u.checkIn <= today).length : 0;

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

  const sideRow = (x: Booking, label: string, departingRow = false) => (
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
      {departingRow && !readOnly && canCheckOut(x, today) ? (
        <button type="button" className="nowext side nowco" disabled={coBusy === x.id} onClick={() => void onCheckOut(x, true)}>
          {coBusy === x.id ? "처리 중…" : "퇴실처리"}
        </button>
      ) : null}
      {departingRow && !readOnly && canAddSurcharge(x) ? (
        <button type="button" className="nowext side" onClick={() => onOpen(x, today, { openSurcharge: true })}>
          {SURCHARGE_COPY}
        </button>
      ) : null}
      {departingRow && !readOnly && canExtend(x) ? (
        <button type="button" className="nowext side" onClick={() => onOpen(x, today, { openExtend: true })}>
          {EXTEND_COPY}
        </button>
      ) : null}
    </div>
  );

  const uaRow = (x: Booking) => {
    const open = assigning === x.id;
    const free = open ? freeRooms(s, bookings, x) : null;
    const options = free
      ? allRooms(s)
          .filter((r) => free.has(r.id))
          .sort((a, c) => Number(a.typeId !== x.typeId) - Number(c.typeId !== x.typeId))
      : [];
    const p = L.plats.get(x.platformId);
    const glanceAmt = nowAmountGlance(x, p);
    const payG = simplePayGlance(x, isOnsite(p));
    return (
      <div key={x.id} className={`now-ua-row side-ua-row ${open ? "open" : ""}`}>
        <button type="button" className="nowli now-ua-item" onClick={() => onOpen(x, today)} disabled={readOnly}>
          <span className="nowli-t ua">간단 예약</span>
          <b>{x.guestName}</b>
          <span className="muted sm">
            {typeLabel(L.types.get(x.typeId))}
            {x.nights ? ` · ${x.nights}박` : ""}
            {x.groupName ? ` · ${x.groupName}` : ""}
            {` · ${md(x.checkIn)} 입실`}
            {glanceAmt ? ` · ${glanceAmt}` : ""}
            {payG ? ` · ${payG}` : ""}
          </span>
        </button>
        {isActive(x) && !readOnly ? (
          <button type="button" className="nowext side" onClick={() => setAssigning(open ? null : x.id)}>
            {open ? "닫기" : "호실 정하기"}
          </button>
        ) : null}
        {open ? (
          <div className="rpick now-ua-pick">
            {options.length ? (
              options.slice(0, 24).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`rchip ${r.typeId !== x.typeId ? "other" : ""}`}
                  title={L.roomLabel(r.id) ?? r.no}
                  onClick={() => onAssign(x, r.id)}
                >
                  {multi ? <em className="bpre">{L.buildings.get(r.buildingId)?.name}</em> : null}
                  {r.no}
                  {r.typeId !== x.typeId ? <i>{typeLabel(L.types.get(r.typeId ?? ""))}</i> : null}
                </button>
              ))
            ) : (
              <span className="muted">그 기간에 빈 방이 없어요</span>
            )}
          </div>
        ) : null}
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
          {!selectedRoomId ? (
            <div className="muted sm nowempty-side">보드에서 객실을 고르면 상세가 여기에 보여요</div>
          ) : (
            <>
              <div className="nsel-head">
                <div className="nsel-no">{roomLabel}호</div>
                <div className="nsel-sub">
                  {typeLabel(t) || "타입 미정"}
                  {f ? ` · ${kindLabel(f.kind)}` : " · 공실"}
                  {f?.tentative ? " · 임시" : ""}
                  {f?.longStay ? " · 장기" : ""}
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
                    <span className="nsel-k">{b.priceUnset ? "요금" : ps?.tracked && ps.left > 0 ? "잔금" : "판매금"}</span>
                    <span className="nsel-v">
                      {b.priceUnset ? "금액미정" : amount ? amount : b.price > 0 ? `₩${won(b.price)}` : "—"}
                    </span>
                  </div>
                  <div className="nsel-row nsel-memo">
                    <span className="nsel-k">특이사항</span>
                    <span className="nsel-v">
                      {glance?.count ? (
                        <button type="button" className="nsel-memobtn" onClick={() => onMemo(selectedRoomId!)}>
                          {glance.preview}
                          {glance.count > 1 ? ` · +${glance.count - 1}` : ""}
                        </button>
                      ) : (
                        <button type="button" className="nsel-memobtn muted" onClick={() => onMemo(selectedRoomId!)} disabled={readOnly}>
                          {readOnly ? "없음" : "특이사항 적기"}
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="nsel-acts">
                    {!readOnly ? (
                      <button type="button" className="btn sm dark" onClick={() => onOpen(b, today)}>
                        예약 기록 열기
                      </button>
                    ) : null}
                    {!readOnly && f && (f.kind === "departing" || f.kind === "lateOut") && canCheckOut(b, today) ? (
                      <button type="button" className="btn sm line" disabled={coBusy === b.id} onClick={() => void onCheckOut(b, true)}>
                        {coBusy === b.id ? "처리 중…" : "퇴실처리"}
                      </button>
                    ) : null}
                    {!readOnly ? (
                      <button type="button" className="btn sm line" onClick={() => onMemo(selectedRoomId!)}>
                        호실 특이사항
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="nsel-body">
                  <div className="muted sm">비어 있음</div>
                  {todayUaForType > 0 ? (
                    <p className="nsel-hint">
                      이 타입 오늘 입실 미배정 {todayUaForType}건 ·{" "}
                      <button type="button" className="linkish" onClick={() => onMode("simple")}>
                        간단 예약
                      </button>
                      에서 호실 정하기
                    </p>
                  ) : null}
                  {!readOnly ? (
                    <div className="nsel-acts">
                      <button
                        type="button"
                        className="btn sm dark"
                        onClick={() =>
                          onSimple({ kind: "stay", checkIn: today, roomId: selectedRoomId, typeId: typeId ?? undefined })
                        }
                      >
                        이 방에 간단 예약
                      </button>
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
              outList.map((x) => sideRow(x, lateOut.some((y) => y.id === x.id) ? "늦은 퇴실" : "퇴실예정", true))
            ) : (
              <div className="muted sm nowempty-side">오늘 퇴실예정 없어요</div>
            )}
          </div>
          <div className={`nowsec nowco-zone ${showOutZone ? "open" : "collapsed"}`}>
            <button type="button" className="nowco-zone-h" aria-expanded={showOutZone} onClick={() => setOutZoneOpen((v) => !v)}>
              <h3>퇴실처리</h3>
              <span className="muted sm">{outCount ? `${outCount}건 · 행에서 처리` : "없음 · 접힘"}</span>
            </button>
            {showOutZone ? (
              <div className="nowco-zone-b">
                {outCount ? (
                  <p className="muted sm">퇴실예정 행의 「퇴실처리」로 확인 후 공실이 돼요. 자동 공실 없음.</p>
                ) : (
                  <p className="muted sm">퇴실예정이 생기면 여기에 펼쳐져요.</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
