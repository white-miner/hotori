import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowRightLeft, CalendarDays, Check, Clock, DoorOpen, Minus, Plus, Undo2, X } from "lucide-react";
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
  fullLegsOf,
  canEarlyOutToday,
  checkOut,
  earlyOutDates,
  isEarlyOut,
  roomOnNight,
  usedLabel,
  usedNights,
  validateEarlyOut,
  revenueOf,
  moveStay,
  undoMove,
  type RoomSegment,
  isActive,
  perNight,
  previewChange,
  stockLevel,
  stockTable,
  typeLabel,
  typeTotals,
  usableTypes,
  validateBooking,
  won,
} from "../shared/ledger";
import type { HotelData } from "./data";
import type { EntryRequest, ToastOpt } from "./App";
import { PlatBadge, TypeBadge, isTypingTarget, lookups } from "./ui";
import { PAY_KIND_LABEL, isOnsite, validatePayment } from "../shared/payment";
import { PAY_LABEL, type PayMethod } from "../shared/shop";

interface Props {
  data: HotelData;
  today: string;
  req: EntryRequest;
  onClose: () => void;
  onSaved: (msg: string, again?: Partial<Booking>) => void;
  /** 객실 배치에서 열었으면: 창을 닫고 빈 방을 눌러 옮기기 */
  onBoardMove?: () => void;
  notify: (m: string, opt?: ToastOpt) => void;
  /** 중도 퇴실 되돌리기 (비운 밤이 다시 팔렸으면 막고 false) */
  undoEarlyOut: (id: string) => Promise<boolean>;
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

export default function Entry({ data, today, req, onClose, onSaved, onBoardMove, notify, undoEarlyOut }: Props) {
  const s = data.hotel!.settings;
  const L = useMemo(() => lookups(s), [s]);
  const base = req.booking;
  // 이름이 빈 타입은 고를 수 없어요 (고치는 예약에 이미 붙은 타입은 그대로 보여요)
  const pickTypes = s.types.filter((t) => typeLabel(t) || t.id === base?.typeId);
  const p = req.preset ?? {};
  const isNew = !base;
  const [kind, setKind] = useState<Kind>(base?.kind ?? p.kind ?? "stay");
  const [platformId, setPlatformId] = useState(base?.platformId ?? p.platformId ?? s.platforms[0]?.id ?? "");
  const [typeId, setTypeId] = useState(base?.typeId ?? p.typeId ?? usableTypes(s.types)[0]?.id ?? "");
  const [checkIn, setCheckIn] = useState(base?.checkIn ?? p.checkIn ?? today);
  const [nights, setNights] = useState(base?.nights ?? p.nights ?? 1);
  // 대실 시간: 적는 중인 글자(raw)는 그대로 두고, 알아볼 수 있으면 HH:MM으로 저장해요
  const [startRaw, setStartRaw] = useState(base?.startTime ?? "");
  const [endRaw, setEndRaw] = useState(base?.endTime ?? "");
  const startTime = parseTime(startRaw);
  const [dur, setDur] = useState<number | null>(() => {
    const m = base?.startTime && base?.endTime ? dayuseMinutes(base.startTime, base.endTime) : null;
    return m && DURATIONS.includes(m / 60) ? m / 60 : null;
  });
  // 이용 시간을 골랐으면 끝 시간은 시작 + 이용 시간
  const endTime = dur != null && startTime ? addMinutesToTime(startTime, dur * 60) : parseTime(endRaw);
  const useMin = dayuseMinutes(startTime, endTime);
  const startRef = useRef<HTMLInputElement>(null);
  // 오늘 대실을 새로 적을 때는 지금 시각(5분 단위)을 시작 시간으로 넣어 둬요
  useEffect(() => {
    if (!isNew || kind !== "dayuse" || startRaw || checkIn !== today) return;
    setStartRaw(nowRounded());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, checkIn]);
  const [guestName, setName] = useState(base?.guestName ?? "");
  const [price, setPrice] = useState(base ? String(base.price) : "");
  const [roomId, setRoomId] = useState<string | null>(base?.roomId ?? p.roomId ?? null);
  // 객실 이동 구간 (첫 구간 방 = roomId). 저장할 때 같이 저장돼요
  const [segs, setSegs] = useState<RoomSegment[] | null>(base?.segments ?? null);
  const [mv, setMv] = useState<{ from: number; room: string | null; other: boolean } | null>(null);
  const [arrived, setArrived] = useState(base?.arrived ?? false);
  const [memo, setMemo] = useState(base?.memo ?? "");
  // 선금·잔금: 선금은 저장할 때 같이, '잔금 받음'은 바로 저장
  const [dep, setDep] = useState<{ amount: string; method: PayMethod; date: string }>({ amount: "", method: "card", date: today });
  const [bal, setBal] = useState<{ method: PayMethod; amount: string } | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);
  // 중도 퇴실: 작은 확인 창 (날짜 · 환불 금액) → 바로 저장
  const [eo, setEo] = useState<{ date: string; refund: string } | null>(null);
  const [eoBusy, setEoBusy] = useState(false);
  const [eoErr, setEoErr] = useState<string | null>(null);
  const live = base ? (data.bookings.find((x) => x.id === base.id) ?? base) : null;
  const eoNow = !!live && isEarlyOut(live) && live.status === "active";
  const eoToday = !!live && canEarlyOutToday(live, today);
  // 지난 숙박 바로잡기: 이미 끝난 2박 이상 숙박은 아래 단추로 날짜를 골라 적어요
  const eoPast = !!live && !eoNow && !eoToday && live.status === "active" && live.kind === "stay" && (live.nights ?? 0) >= 2 && today >= checkOut(live);
  const eocRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (eo) eocRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!eo]);
  const openEo = () => {
    if (!live) return;
    const ds = earlyOutDates(live);
    setEoErr(null);
    setEo({ date: ds.includes(today) ? today : ds[ds.length - 1], refund: "" });
  };
  const confirmEo = async () => {
    if (!live || !eo || eoBusy) return;
    const refund = eo.refund.trim() ? Number(eo.refund.replace(/\D/g, "")) : null;
    const v = validateEarlyOut(live, eo.date, refund);
    if (v) return setEoErr(v);
    setEoBusy(true);
    setEoErr(null);
    try {
      const saved = await data.setEarlyOut(live.id, eo.date, refund || null);
      const freed = (saved.nights ?? 0) - (usedNights(saved) ?? 0);
      const room = L.roomLabel(roomOnNight(live, eo.date) ?? null);
      onClose();
      notify(
        `${saved.guestName} 님 ${eo.date === today ? "오늘" : dayLabel(eo.date)} 중도 퇴실 · ${usedLabel(saved)} · ${room ? `${room}호 ` : ""}${freed}박 비웠어요${refund ? ` · 환불 ${won(refund)}원` : ""}`,
        { action: { label: "되돌리기", run: () => void undoEarlyOut(saved.id) }, ms: 8000 },
      );
    } catch (e) {
      setEoErr(e instanceof Error ? `저장하지 못했어요: ${e.message}` : "저장하지 못했어요");
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
  // 입실 완료: 예약 창 위 단추로 바로 저장해요 (저장 버튼을 안 눌러도 돼요)
  const [inBusy, setInBusy] = useState(false);
  const [inErr, setInErr] = useState<string | null>(null);
  const toggleIn = async () => {
    if (!base || inBusy) return;
    const next = !arrived;
    setInBusy(true);
    setInErr(null);
    setArrived(next);
    try {
      await data.patchBooking(base.id, { arrived: next });
    } catch {
      setArrived(!next);
      setInErr("입실 완료를 저장하지 못했어요. 다시 눌러 주세요.");
    } finally {
      setInBusy(false);
    }
  };
  const [status, setStatus] = useState<Status>(base?.status ?? "active");
  const [otherRooms, setOtherRooms] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
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

  const draftBase: Booking = {
    id: base?.id ?? "__draft__",
    kind,
    status,
    platformId,
    price: Number(price || 0),
    guestName,
    typeId,
    roomId,
    segments: kind === "stay" ? fitSegments(segs, roomId, nights) : null,
    checkIn,
    nights: kind === "stay" ? nights : null,
    startTime: kind === "dayuse" ? startTime : null,
    endTime: kind === "dayuse" ? endTime : null,
    arrived,
    earlyOut: base?.earlyOut ?? null,
    refund: base?.refund ?? null,
    memo: memo || null,
    cancelledAt: base?.cancelledAt ?? null,
    createdAt: base?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const draft = draftBase;
  const livePays = (base ? data.bookings.find((x) => x.id === base.id)?.payments : null) ?? base?.payments ?? [];
  const payTracked = isOnsite(L.plats.get(platformId)) || livePays.length > 0;
  const depAmt = payTracked && !livePays.length ? Number(dep.amount || 0) : 0;
  const payPaid = livePays.reduce((n, x) => n + x.amount, 0) + depAmt;
  const payDue = revenueOf({ ...draftBase, status: "active" });
  const payLeft = Math.max(0, payDue - payPaid);
  const takeBalance = async () => {
    if (!base || !bal || payBusy) return;
    const amount = Number(bal.amount || 0);
    const v = validatePayment(amount, bal.method, today);
    if (v) return setPayErr(v);
    setPayBusy(true);
    setPayErr(null);
    try {
      await data.addPayment(base.id, { kind: "balance", method: bal.method, amount, bizDate: today });
      setBal(null);
      const left = Math.max(0, payDue - payPaid - amount);
      notify(`${guestName} 님 잔금 ${won(amount)}원 받음 (${PAY_LABEL[bal.method]})${left ? ` · 남은 잔금 ${won(left)}원` : " · 완납"}`);
    } catch (e) {
      setPayErr(e instanceof Error ? `저장하지 못했어요: ${e.message}` : "저장하지 못했어요");
    } finally {
      setPayBusy(false);
    }
  };
  const delPay = async (id: string) => {
    if (!base || payBusy) return;
    if (!window.confirm("이 결제 줄을 지울까요? 잔금이 다시 늘어나요.")) return;
    setPayBusy(true);
    setPayErr(null);
    try {
      await data.deletePayment(base.id, id);
    } catch (e) {
      setPayErr(e instanceof Error ? `지우지 못했어요: ${e.message}` : "지우지 못했어요");
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
  // 방 번호 고르기: 객실 이동이 있으면 첫 방에 묵는 밤만 봐요 (중도 퇴실했으면 실제로 묵은 밤까지만)
  const firstNights = Math.min(moved ? legs[0].nights : nights, usedNights(draft) ?? nights);
  const free = useMemo(
    () => freeRooms(s, data.bookings, { ...draft, nights: kind === "stay" ? firstNights : null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, data.bookings, draft.id, kind, checkIn, nights, firstNights, startTime, endTime],
  );
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
  const sameType = allRooms.filter((r) => r.typeId === typeId && (free.has(r.id) || r.id === roomId));
  const otherType = allRooms.filter((r) => r.typeId !== typeId && (free.has(r.id) || r.id === roomId));
  const roomBusy = kind === "stay" ? busyLegs.length > 0 : !!roomId && !free.has(roomId);
  const preview = kind === "stay" && status === "active" ? previewChange(s, data.bookings, draft) : [];

  async function save(again = false, override?: Status) {
    const draft = override ? { ...draftBase, status: override } : draftBase;
    const v = validateBooking(draft, s);
    if (v) return setErr(v);
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
    if (roomBusy && isActive(draft) && slotChanged)
      return setErr(
        kind === "stay" && busyLegs.length
          ? `${busyLegs.map((l) => `${L.roomLabel(l.roomId)}호(${md(l.checkIn)}~${md(addDays(l.checkIn, l.nights))})`).join(", ")}는 그 기간에 다른 예약이 있어요.`
          : `${L.roomLabel(roomId)}호는 그 ${kind === "stay" ? "기간" : "시간"}에 다른 예약이 있어요.`,
      );
    if (depAmt > 0) {
      const pv = validatePayment(depAmt, dep.method, dep.date);
      if (pv) return setErr(`선금: ${pv}`);
      if (depAmt > draft.price) return setErr("선금이 판매 가격보다 커요.");
    }
    setBusy(true);
    setErr(null);
    try {
      const saved = await data.saveBooking(draft, isNew);
      // 선금: 예약을 저장한 다음 한 줄 적어요 (못 적으면 알려 드려요)
      let depNote = "";
      if (depAmt > 0 && isActive(saved)) {
        try {
          await data.addPayment(saved.id, { kind: "deposit", method: dep.method, amount: depAmt, bizDate: dep.date });
          depNote = ` · 선금 ${won(depAmt)}원(${PAY_LABEL[dep.method]})`;
        } catch (e) {
          depNote = ` · 선금은 적지 못했어요: ${e instanceof Error ? e.message : "다시 시도해 주세요"}`;
        }
      }
      const t = L.types.get(saved.typeId);
      const tail =
        kind === "stay" && isActive(saved) && preview[0]
          ? ` · ${L.types.get(preview[0].typeId)?.name} 남은 객실 ${preview[0].after}`
          : "";
      onSaved(
        override === "cancelled"
          ? `${saved.guestName} 님 예약을 취소했어요 · 남은 객실이 늘었어요`
          : override === "noshow"
            ? `${saved.guestName} 님 노쇼로 표시했어요 · 받은 금액은 매출에 남고 남은 객실이 늘었어요`
            : `${saved.guestName} 님 예약을 ${isNew ? "기록" : "수정"}했어요${tail}${depNote}`,
        again ? { kind, platformId, typeId: t?.id, checkIn, nights: kind === "stay" ? nights : undefined } : undefined,
      );
    } catch (e) {
      setErr(e instanceof Error ? `저장하지 못했어요: ${e.message}` : "저장하지 못했어요");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!base) return;
    setBusy(true);
    try {
      await data.deleteBooking(base.id);
      onSaved(`${base.guestName} 님 예약을 지웠어요`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "지우지 못했어요");
      setBusy(false);
    }
  }

  // 단축키: 입력 칸 밖에서는 그대로, 입력 칸 안에서는 Alt와 함께
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
        setNights((n) => Math.min(90, Math.max(1, n + (e.key === "ArrowRight" ? 1 : -1))));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const per = kind === "stay" ? perNight({ price: Number(price || 0), nights }) : null;
  const dateChips = [
    { d: today, l: `오늘 ${dayLabel(today)}` },
    { d: addDays(today, 1), l: `내일 ${dayLabel(addDays(today, 1))}` },
    { d: addDays(today, 2), l: `모레 ${dayLabel(addDays(today, 2))}` },
  ];
  const custom = !dateChips.some((c) => c.d === checkIn);

  return (
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <div className="grab" />
        <div className="mh">
          <h2>{isNew ? "예약 기록" : "예약 수정"}</h2>
          <div className="seg">
            <button type="button" className={kind === "stay" ? "on" : ""} onClick={() => setKind("stay")}>
              숙박
            </button>
            <button type="button" className={kind === "dayuse" ? "on" : ""} onClick={() => setKind("dayuse")}>
              대실
            </button>
          </div>
          {!isActive(draft) ? <span className="cxt big">{status === "noshow" ? "노쇼 처리된" : "취소된"} 예약</span> : null}
          <button type="button" className="x" onClick={onClose}>
            <kbd>Esc</kbd>닫기
          </button>
        </div>
        {base && isActive(base) ? (
          <div className={`mtop n${1 + (onBoardMove ? 1 : 0) + (eoNow || eoToday ? 1 : 0)}`}>
            {onBoardMove ? (
              <button type="button" className="bmove" onClick={onBoardMove}>
                <ArrowRightLeft size={17} />
                <b>객실 이동</b>
                <span>창을 닫고 옮길 빈 방을 눌러요{base.kind === "stay" && base.nights && base.nights > 1 && req.night && req.night > base.checkIn ? " · 이 밤부터 옮겨요" : ""}</span>
              </button>
            ) : null}
            <button
              type="button"
              className={`bin ${arrived ? "on" : ""}`}
              aria-pressed={arrived}
              disabled={inBusy}
              onClick={() => void toggleIn()}
            >
              <Check size={17} strokeWidth={2.6} />
              <b>{arrived ? "입실 완료됨 · 취소" : "입실 완료"}</b>
              {arrived ? null : <span>누르면 바로 저장돼요</span>}
            </button>
            {eoNow ? (
              <button type="button" className="beo undo" disabled={eoBusy} onClick={() => void undoEo()}>
                <Undo2 size={17} />
                <b>중도 퇴실 되돌리기</b>
              </button>
            ) : eoToday ? (
              <button type="button" className={`beo ${eo ? "on" : ""}`} aria-expanded={!!eo} onClick={() => (eo ? setEo(null) : openEo())}>
                <DoorOpen size={17} />
                <b>중도 퇴실</b>
              </button>
            ) : null}
          </div>
        ) : null}
        {eoNow && live ? (
          <div className="eoline">
            <DoorOpen size={15} />
            <b>{dayLabel(live.earlyOut!)} 중도 퇴실</b>
            <span>
              {usedLabel(live)} · {dayLabel(live.earlyOut!)} 밤부터 방이 비었어요{live.refund ? ` · 환불 ${won(live.refund)}원` : " · 환불 없음"}
            </span>
          </div>
        ) : null}
        {eo && live ? (
          <div className="eoc" role="group" aria-label="중도 퇴실" ref={eocRef}>
            <div className="eoc-h">
              <b>
                {eo.date === today ? "오늘 퇴실" : `${dayLabel(eo.date)} 퇴실`} · {live.nights}박 중 {daysBetween(live.checkIn, eo.date)}박 이용
              </b>
              <span>
                {dayLabel(eo.date)} 밤부터 {live.nights! - daysBetween(live.checkIn, eo.date)}박은 바로 빈 방이 돼요
                {L.roomLabel(roomOnNight(live, eo.date) ?? null) ? ` (${L.roomLabel(roomOnNight(live, eo.date) ?? null)}호)` : ""}
              </span>
            </div>
            {earlyOutDates(live).length > 1 || eo.date !== today ? (
              <div className="eoc-d">
                <label>퇴실한 날</label>
                {earlyOutDates(live).length <= 6 ? (
                  <div className="chips">
                    {earlyOutDates(live).map((d) => (
                      <button type="button" key={d} className={`chip ${eo.date === d ? "on" : ""}`} onClick={() => setEo({ ...eo, date: d })}>
                        {d === today ? `오늘 ${dayLabel(d)}` : dayLabel(d)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <select className="inp" value={eo.date} onChange={(e) => setEo({ ...eo, date: e.target.value })}>
                    {earlyOutDates(live).map((d) => (
                      <option key={d} value={d}>
                        {d === today ? `오늘 ${dayLabel(d)}` : dayLabel(d)} · {daysBetween(live.checkIn, d)}박 이용
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : null}
            <div className="eoc-r">
              <label htmlFor="eo-refund">
                환불 금액
              </label>
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
                결제 {won(live.price)}원 → 매출 {won(Math.max(0, live.price - (Number(eo.refund) || 0)))}원 · 환불은 {dayLabel(eo.date)} 매출에서 빠져요
              </small>
            </div>
            {eoErr ? <div className="ferr">{eoErr}</div> : null}
            <div className="eoc-a">
              <button type="button" className="btn" onClick={() => setEo(null)}>
                닫기
              </button>
              <button type="button" className="btn dark" disabled={eoBusy} onClick={() => void confirmEo()}>
                {eoBusy ? "저장 중…" : "중도 퇴실"}
              </button>
            </div>
          </div>
        ) : null}
        {inErr ? <div className="ferr mtop-err">{inErr}</div> : null}

        <div className="fld">
          <label>
            플랫폼<em>*</em>
          </label>
          <div className="chips scroll">
            {s.platforms.map((pl, k) => (
              <button type="button" key={pl.id} className={`chip ${pl.id === platformId ? "on" : ""}`} onClick={() => setPlatformId(pl.id)}>
                <PlatBadge p={pl} />
                {pl.name}
                {k < 9 ? <i>{k + 1}</i> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="fld">
          <label>
            객실 타입<em>*</em>
          </label>
          <div className="chips scroll">
            {pickTypes.map((t, k) => {
              const r = minRemain(t.id);
              const lv = stockLevel(r, totals.get(t.id) ?? 0, s.lowThreshold);
              return (
                <button type="button" key={t.id} className={`tchip ${t.id === typeId ? "on" : ""}`} onClick={() => setTypeId(t.id)}>
                  <span className="t1">
                    <TypeBadge t={t} />
                  </span>
                  {kind === "stay" ? (
                    <span className={`t2 ${lv === "full" || lv === "over" ? "full" : ""}`}>
                      남은 <b>{r}</b>
                      {k < 9 ? <span className="kk"> · {TYPE_LABEL[k]}</span> : null}
                    </span>
                  ) : k < 9 ? (
                    <span className="t2 kk">{TYPE_LABEL[k]}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

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
                aria-label="입실 날짜"
                title="눌러서 달력에서 고르거나, 숫자로 바로 적어도 돼요"
              />
            </label>
          </div>
        </div>

        {kind === "stay" ? (
          <div className="fld">
            <label>
              박수<em>*</em>
            </label>
            <div className="step">
              <button type="button" className="sb" aria-label="1박 줄이기" onClick={() => setNights((n) => Math.max(1, n - 1))}>
                <Minus size={16} />
              </button>
              <span className="sv">
                {nights}
                <small>박</small>
              </span>
              <button type="button" className="sb" aria-label="1박 늘리기" onClick={() => setNights((n) => Math.min(90, n + 1))}>
                <Plus size={16} />
              </button>
              <span className="rng">
                <b>{dayLabel(checkIn)}</b> 입실 → <b>{dayLabel(addDays(checkIn, nights))}</b> 퇴실 · 퇴실날은 다시 팔 수 있어요
              </span>
            </div>
          </div>
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
                  title="1330처럼 숫자만 적어도 돼요"
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
                    if (!startTime) setStartRaw(checkIn === today ? nowRounded() : "");
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
                <span>시작 시간을 적고 이용 시간을 누르면 끝 시간이 저절로 들어가요</span>
              )}
            </div>
          </div>
        )}

        <div className="fld">
          <label>
            이름 · 가격<em>*</em>
          </label>
          <div className="two">
            <input
              ref={nameRef}
              className="inp"
              placeholder="손님 이름"
              value={guestName}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              aria-label="이름"
            />
            <label className="inp price">
              <input
                className="num"
                inputMode="numeric"
                placeholder={kind === "stay" ? "총액" : "금액"}
                value={price ? won(Number(price)) : ""}
                onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 9))}
                aria-label="판매 가격"
              />
              원{per ? <small>1박 평균 {won(per)}원</small> : null}
            </label>
          </div>
        </div>

        <div className="fld pay">
          <label>결제</label>
          <div className="payb">
            {!payTracked ? (
              <div className="muted sm payota">플랫폼에서 결제 · 잔금 없음 <span>(설정 › 플랫폼에서 '현장 결제'를 켜면 잔금을 따져요)</span></div>
            ) : (
              <>
                {livePays.map((x) => (
                  <div className="payrow" key={x.id}>
                    <b>{PAY_KIND_LABEL[x.kind]}</b>
                    <span className="num">{won(x.amount)}원</span>
                    <span className="muted">{PAY_LABEL[x.method]} · {dayLabel(x.bizDate)}</span>
                    <button type="button" className="ic" aria-label="이 결제 지우기" disabled={payBusy} onClick={() => void delPay(x.id)}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {!livePays.length ? (
                  <div className="paydep">
                    <span className="pl">선금</span>
                    <label className="inp price sm">
                      <input
                        className="num"
                        inputMode="numeric"
                        placeholder="없으면 비워 두세요"
                        aria-label="선금"
                        value={dep.amount ? won(Number(dep.amount)) : ""}
                        onChange={(e) => setDep({ ...dep, amount: e.target.value.replace(/\D/g, "").slice(0, 9) })}
                      />
                      원
                    </label>
                    <div className="seg sm">
                      {(["card", "cash"] as const).map((m) => (
                        <button type="button" key={m} className={dep.method === m ? "on" : ""} onClick={() => setDep({ ...dep, method: m })}>
                          {PAY_LABEL[m]}
                        </button>
                      ))}
                    </div>
                    <input className="inp sm" type="date" aria-label="선금 받은 날" value={dep.date} onChange={(e) => e.target.value && setDep({ ...dep, date: e.target.value })} />
                  </div>
                ) : null}
                <div className={`payleft ${payLeft > 0 ? "due" : "ok"}`}>
                  {payLeft > 0 ? (
                    <>
                      잔금 <b className="num">{won(payLeft)}원</b>
                      <span className="muted"> = 판매 가격 {won(payDue)} − 받은 돈 {won(payPaid)}</span>
                    </>
                  ) : payPaid > 0 ? (
                    <>
                      <Check size={14} strokeWidth={2.6} /> 완납 <span className="muted">· 받은 돈 {won(payPaid)}원</span>
                    </>
                  ) : (
                    <span className="muted">판매 가격을 적으면 잔금이 보여요</span>
                  )}
                  {live && isActive(live) && payLeft > 0 && !bal ? (
                    <button type="button" className="btn sm dark balbtn" onClick={() => setBal({ method: "card", amount: String(payLeft) })}>
                      잔금 받음
                    </button>
                  ) : null}
                </div>
                {bal ? (
                  <div className="paybal">
                    <div className="seg sm">
                      {(["card", "cash"] as const).map((m) => (
                        <button type="button" key={m} className={bal.method === m ? "on" : ""} onClick={() => setBal({ ...bal, method: m })}>
                          {PAY_LABEL[m]}
                        </button>
                      ))}
                    </div>
                    <label className="inp price sm">
                      <input
                        className="num"
                        inputMode="numeric"
                        aria-label="받은 잔금"
                        value={bal.amount ? won(Number(bal.amount)) : ""}
                        onChange={(e) => setBal({ ...bal, amount: e.target.value.replace(/\D/g, "").slice(0, 9) })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void takeBalance();
                          }
                        }}
                      />
                      원
                    </label>
                    <button type="button" className="btn sm" onClick={() => setBal(null)}>
                      닫기
                    </button>
                    <button type="button" className="btn sm red" disabled={payBusy} onClick={() => void takeBalance()}>
                      {payBusy ? "저장 중…" : "받음 기록"}
                    </button>
                  </div>
                ) : null}
                {payErr ? <div className="ferr">{payErr}</div> : null}
              </>
            )}
          </div>
        </div>

        <div className="fld">
          <label>{moved ? "첫 방" : "방 번호"}</label>
          <div className="chips">
            <button type="button" className={`rchip lt ${roomId === null ? "on" : ""}`} onClick={() => setRoomId(null)}>
              나중에 정하기
            </button>
            {sameType.map((r) => (
              <button type="button" key={r.id} className={`rchip ${r.id === roomId ? "on" : ""} ${free.has(r.id) ? "" : "busy"}`} title={L.roomLabel(r.id) ?? r.no} onClick={() => setRoomId(r.id)}>
                {bpre(r.buildingId)}
                {r.no}
              </button>
            ))}
            {otherRooms || (roomId && L.rooms.get(roomId)?.typeId !== typeId)
              ? otherType.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    className={`rchip other ${r.id === roomId ? "on" : ""} ${free.has(r.id) ? "" : "busy"}`}
                    title={L.roomLabel(r.id) ?? r.no}
                    onClick={() => setRoomId(r.id)}
                  >
                    {bpre(r.buildingId)}
                    {r.no}
                    <i>{typeLabel(L.types.get(r.typeId ?? ""))}</i>
                  </button>
                ))
              : otherType.length ? (
                  <button type="button" className="rchip lt" onClick={() => setOtherRooms(true)}>
                    다른 타입 방 +{otherType.length}
                  </button>
                ) : null}
            {!sameType.length && !otherRooms ? <span className="muted sm">이 타입은 그 {kind === "stay" ? "기간" : "시간"}에 빈 방이 없어요</span> : null}
          </div>
        </div>

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
                        {k}박째 {dayLabel(addDays(checkIn, k - 1))} 밤부터
                      </button>
                    ))}
                  </div>
                  <div className="mvq">옮길 방 <span className="muted">· {dayLabel(addDays(checkIn, mv.from - 1))} 밤 ~ {dayLabel(addDays(checkIn, nights))} 퇴실</span></div>
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
            {isNew ? (
              <button type="button" className={`chip ${arrived ? "on" : ""}`} aria-pressed={arrived} onClick={() => setArrived((a) => !a)}>
                {arrived ? <Check size={14} strokeWidth={2.6} /> : null}입실 완료
              </button>
            ) : null}
            <input className="inp" placeholder="메모 (선택)" maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
        </div>

        <div className="pv">
          {kind === "dayuse" ? (
            <div className="pt">대실은 남은 객실에 포함되지 않아요. 이용 시간만 따로 보여 줘요.</div>
          ) : !isActive(draft) ? (
            <div className="pt">
              {status === "noshow"
                ? "노쇼는 결제한 금액을 매출에 그대로 남기고, 방과 남은 객실은 다시 비워요."
                : "취소는 전액 환불로 보고 장부에 줄을 그어 남겨요. 매출에서 빠지고 남은 객실은 다시 늘어나요."}
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
                    <span className="pn">{t?.name} 남은 객실</span>
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
            <div className="pt">남은 객실 숫자는 그대로예요.</div>
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
          ) : (
            <div className="keys acts">
              {isActive(draft) ? (
                <>
                  <button type="button" className="btn line sm" onClick={() => void save(false, "cancelled")}>
                    취소 처리
                  </button>
                  <button type="button" className="btn line sm" title="결제한 금액은 매출에 남고, 방·재고는 비워요" onClick={() => void save(false, "noshow")}>
                    노쇼
                  </button>
                  {eoPast ? (
                    <button type="button" className="btn line sm" title="지난 숙박을 바로잡아요: 떠난 날을 고르면 그 뒤 밤은 비워요" onClick={() => (eo ? setEo(null) : openEo())}>
                      중도 퇴실 적기
                    </button>
                  ) : null}
                </>
              ) : (
                <button type="button" className="btn line sm" onClick={() => setStatus("active")}>
                  예약 되살리기
                </button>
              )}
              {confirmDel ? (
                <button type="button" className="btn sm danger" onClick={() => void remove()}>
                  정말 지울까요?
                </button>
              ) : (
                <button type="button" className="btn sm ghost" onClick={() => setConfirmDel(true)}>
                  예약 지우기
                </button>
              )}
            </div>
          )}
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          <button className="btn red" disabled={busy}>
            {busy ? "저장 중…" : "저장"} <span className="num kbdh">Enter</span>
          </button>
        </div>
      </form>
    </div>
  );
}
