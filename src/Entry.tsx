import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Minus, Plus } from "lucide-react";
import {
  type Booking,
  type Kind,
  type Status,
  TIME_RE,
  addDays,
  dayLabel,
  freeRooms,
  isActive,
  perNight,
  previewChange,
  stockLevel,
  stockTable,
  typeTotals,
  validateBooking,
  won,
} from "../shared/ledger";
import type { HotelData } from "./data";
import type { EntryRequest } from "./App";
import { PlatBadge, TypeBadge, isTypingTarget, lookups } from "./ui";

interface Props {
  data: HotelData;
  today: string;
  req: EntryRequest;
  onClose: () => void;
  onSaved: (msg: string, again?: Partial<Booking>) => void;
}
const TYPE_KEYS = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO"];
const TYPE_LABEL = "QWERTYUIO";
const fmtTime = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, d.length - 2).padStart(2, "0")}:${d.slice(-2)}`;
};
const plusHours = (t: string, h: number) => {
  if (!TIME_RE.test(t)) return "";
  const [a, b] = t.split(":").map(Number);
  const m = (a * 60 + b + h * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export default function Entry({ data, today, req, onClose, onSaved }: Props) {
  const s = data.hotel!.settings;
  const L = useMemo(() => lookups(s), [s]);
  const base = req.booking;
  const p = req.preset ?? {};
  const isNew = !base;
  const [kind, setKind] = useState<Kind>(base?.kind ?? p.kind ?? "stay");
  const [platformId, setPlatformId] = useState(base?.platformId ?? p.platformId ?? s.platforms[0]?.id ?? "");
  const [typeId, setTypeId] = useState(base?.typeId ?? p.typeId ?? s.types[0]?.id ?? "");
  const [checkIn, setCheckIn] = useState(base?.checkIn ?? p.checkIn ?? today);
  const [nights, setNights] = useState(base?.nights ?? p.nights ?? 1);
  const [startTime, setStart] = useState(base?.startTime ?? "");
  const [endTime, setEnd] = useState(base?.endTime ?? "");
  const [guestName, setName] = useState(base?.guestName ?? "");
  const [price, setPrice] = useState(base ? String(base.price) : "");
  const [roomId, setRoomId] = useState<string | null>(base?.roomId ?? p.roomId ?? null);
  const [arrived, setArrived] = useState(base?.arrived ?? false);
  const [memo, setMemo] = useState(base?.memo ?? "");
  const [status, setStatus] = useState<Status>(base?.status ?? "active");
  const [otherRooms, setOtherRooms] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

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
    checkIn,
    nights: kind === "stay" ? nights : null,
    startTime: kind === "dayuse" ? startTime : null,
    endTime: kind === "dayuse" ? endTime : null,
    arrived,
    memo: memo || null,
    cancelledAt: base?.cancelledAt ?? null,
    createdAt: base?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const draft = draftBase;
  const nightDates = useMemo(
    () => Array.from({ length: kind === "stay" ? nights : 1 }, (_, i) => addDays(checkIn, i)),
    [kind, nights, checkIn],
  );
  const others = useMemo(() => data.bookings.filter((b) => b.id !== draft.id), [data.bookings, draft.id]);
  const table = useMemo(() => stockTable(s, others, nightDates), [s, others, nightDates]);
  const totals = useMemo(() => typeTotals(s), [s]);
  const minRemain = (tid: string) => Math.min(...nightDates.map((d) => table.get(tid)?.get(d) ?? 0));
  const free = useMemo(
    () => freeRooms(s, data.bookings, draft),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, data.bookings, draft.id, kind, checkIn, nights, startTime, endTime],
  );
  const allRooms = s.floors.flatMap((f) => f.rooms);
  const sameType = allRooms.filter((r) => r.typeId === typeId && (free.has(r.id) || r.id === roomId));
  const otherType = allRooms.filter((r) => r.typeId !== typeId && (free.has(r.id) || r.id === roomId));
  const roomBusy = !!roomId && !free.has(roomId);
  const preview = kind === "stay" && status === "active" ? previewChange(s, data.bookings, draft) : [];

  async function save(again = false, override?: Status) {
    const draft = override ? { ...draftBase, status: override } : draftBase;
    const v = validateBooking(draft, s);
    if (v) return setErr(v);
    const slotChanged =
      !base ||
      !isActive(base) ||
      base.roomId !== draft.roomId ||
      base.checkIn !== draft.checkIn ||
      base.nights !== draft.nights ||
      base.startTime !== draft.startTime ||
      base.endTime !== draft.endTime ||
      base.kind !== draft.kind;
    if (roomBusy && isActive(draft) && slotChanged)
      return setErr(`${L.rooms.get(roomId!)?.no}호는 그 ${kind === "stay" ? "기간" : "시간"}에 다른 예약이 있어요.`);
    setBusy(true);
    setErr(null);
    try {
      const saved = await data.saveBooking(draft, isNew);
      const t = L.types.get(saved.typeId);
      const tail =
        kind === "stay" && isActive(saved) && preview[0]
          ? ` · ${L.types.get(preview[0].typeId)?.code} 남은 객실 ${preview[0].after}`
          : "";
      onSaved(
        override === "cancelled"
          ? `${saved.guestName} 님 예약을 취소했어요 · 남은 객실이 늘었어요`
          : override === "noshow"
            ? `${saved.guestName} 님 노쇼로 표시했어요 · 남은 객실이 늘었어요`
            : `${saved.guestName} 님 ${isNew ? "기록" : "수정"}했어요${tail}`,
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
      onSaved(`${base.guestName} 님 기록을 지웠어요`);
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
      if (ti >= 0 && s.types[ti]) {
        e.preventDefault();
        setTypeId(s.types[ti].id);
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
          {!isActive(draft) ? <span className="cxt big">{status === "noshow" ? "노쇼" : "취소"}된 예약</span> : null}
          <button type="button" className="x" onClick={onClose}>
            <kbd>Esc</kbd>닫기
          </button>
        </div>

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
            {s.types.map((t, k) => {
              const r = minRemain(t.id);
              const lv = stockLevel(r, totals.get(t.id) ?? 0, s.lowThreshold);
              return (
                <button type="button" key={t.id} className={`tchip ${t.id === typeId ? "on" : ""}`} onClick={() => setTypeId(t.id)}>
                  <span className="t1">
                    <TypeBadge t={t} />
                    <span className="tname">{t.name}</span>
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
              {custom ? dayLabel(checkIn) : "날짜 고르기"}
              <input
                ref={dateRef}
                type="date"
                value={checkIn}
                onChange={(e) => e.target.value && setCheckIn(e.target.value)}
                aria-label="입실 날짜"
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
              이용시간<em>*</em>
            </label>
            <div className="times">
              <input
                className="inp num tm-in"
                inputMode="numeric"
                placeholder="12:00"
                value={startTime}
                onChange={(e) => setStart(fmtTime(e.target.value))}
                aria-label="시작 시간"
              />
              <span className="tilde">~</span>
              <input
                className="inp num tm-in"
                inputMode="numeric"
                placeholder="14:00"
                value={endTime}
                onChange={(e) => setEnd(fmtTime(e.target.value))}
                aria-label="끝 시간"
              />
              {[2, 3, 4].map((h) => (
                <button type="button" key={h} className="chip sm" onClick={() => setEnd(plusHours(startTime, h))} disabled={!TIME_RE.test(startTime)}>
                  {h}시간
                </button>
              ))}
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
                aria-label="판매가격"
              />
              원{per ? <small>1박 평균 {won(per)}원</small> : null}
            </label>
          </div>
        </div>

        <div className="fld">
          <label>방 번호</label>
          <div className="chips">
            <button type="button" className={`rchip lt ${roomId === null ? "on" : ""}`} onClick={() => setRoomId(null)}>
              나중에 정하기
            </button>
            {sameType.map((r) => (
              <button type="button" key={r.id} className={`rchip ${r.id === roomId ? "on" : ""} ${free.has(r.id) ? "" : "busy"}`} onClick={() => setRoomId(r.id)}>
                {r.no}
              </button>
            ))}
            {otherRooms || (roomId && L.rooms.get(roomId)?.typeId !== typeId)
              ? otherType.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    className={`rchip other ${r.id === roomId ? "on" : ""} ${free.has(r.id) ? "" : "busy"}`}
                    onClick={() => setRoomId(r.id)}
                  >
                    {r.no}
                    <i>{L.types.get(r.typeId ?? "")?.code}</i>
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

        <div className="fld">
          <label>입실 · 메모</label>
          <div className="two memo">
            <button type="button" className={`chip ${arrived ? "on" : ""}`} onClick={() => setArrived((a) => !a)}>
              {arrived ? "◯ 입실 완료" : "◯ 입실 표시"}
            </button>
            <input className="inp" placeholder="메모 (선택)" maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
        </div>

        <div className="pv">
          {kind === "dayuse" ? (
            <div className="pt">대실은 남은 객실 계산에 들어가지 않아요. 이용시간만 따로 보여 줘요.</div>
          ) : !isActive(draft) ? (
            <div className="pt">취소·노쇼는 장부에 줄을 그어 남기고, 남은 객실은 다시 늘어나요.</div>
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
              {preview.length > 4 ? <div className="pt more">외 {preview.length - 4}개 밤도 같이 바뀌어요</div> : null}
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
                  <button type="button" className="btn line sm" onClick={() => void save(false, "noshow")}>
                    노쇼
                  </button>
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
                  기록 지우기
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
