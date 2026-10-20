import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type Booking, addDays, md, weekday } from "../shared/ledger";
import {
  addMonths,
  blockedNightsForRoom,
  isNightInRange,
  monthGrid,
  monthLabelKo,
  monthOf,
  nightPickSummary,
  orderNights,
  paintedNightsFromStay,
  rangeHitsBlocked,
  stayFromPaintedNights,
} from "../shared/nightpick";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

interface Props {
  checkIn: string;
  nights: number;
  bookings: Booking[];
  roomId: string | null;
  excludeId?: string;
  today: string;
  onPick: (checkIn: string, nights: number) => void;
  onBlocked: () => void;
}

export default function NightPickCalendar({ checkIn, nights, bookings, roomId, excludeId, today, onPick, onBlocked }: Props) {
  const painted = useMemo(() => paintedNightsFromStay(checkIn, nights), [checkIn, nights]);
  const [month, setMonth] = useState(() => monthOf(checkIn));
  const [anchor, setAnchor] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  /** 마우스 드래그/클릭을 pointer로 처리한 뒤 합성 click 무시 */
  const swallowClick = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMonth(monthOf(checkIn));
  }, [checkIn]);

  const preview = useMemo(() => {
    if (dragFrom && hover) return orderNights(dragFrom, hover);
    if (anchor && hover) return orderNights(anchor, hover);
    if (anchor) return { firstNight: anchor, lastNight: anchor };
    return painted;
  }, [anchor, dragFrom, hover, painted]);

  const cells = useMemo(() => monthGrid(month), [month]);
  const blocked = useMemo(() => {
    const from = addMonths(month, -1);
    const to = addDays(addMonths(month, 2), -1);
    return blockedNightsForRoom(bookings, roomId, { excludeId, from, to });
  }, [bookings, roomId, excludeId, month]);

  const commit = useCallback(
    (a: string, b: string) => {
      const range = orderNights(a, b);
      if (rangeHitsBlocked(range.firstNight, range.lastNight, blocked)) {
        onBlocked();
        return false;
      }
      const stay = stayFromPaintedNights(range.firstNight, range.lastNight);
      onPick(stay.checkIn, stay.nights);
      setAnchor(null);
      setDragFrom(null);
      setHover(null);
      return true;
    },
    [blocked, onBlocked, onPick],
  );

  const dateFromPoint = (clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const btn = el?.closest?.("[data-night]") as HTMLElement | null;
    return btn?.dataset.night ?? null;
  };

  const onCellClick = (date: string, blockedDay: boolean) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    if (blockedDay) {
      onBlocked();
      return;
    }
    if (!anchor) {
      setAnchor(date);
      setHover(date);
      return;
    }
    commit(anchor, date);
  };

  const onGridPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    const date = dateFromPoint(e.clientX, e.clientY);
    if (!date) return;
    if (blocked.has(date)) {
      onBlocked();
      return;
    }
    e.preventDefault();
    swallowClick.current = true;
    setDragFrom(date);
    setAnchor(null);
    setHover(date);
    try {
      gridRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onGridPointerMove = (e: React.PointerEvent) => {
    if (!dragFrom) return;
    const date = dateFromPoint(e.clientX, e.clientY);
    if (date) setHover(date);
  };

  const onGridPointerUp = (e: React.PointerEvent) => {
    if (!dragFrom) return;
    const end = dateFromPoint(e.clientX, e.clientY) ?? hover ?? dragFrom;
    const start = dragFrom;
    setDragFrom(null);
    commit(start, end);
  };

  const clear = () => {
    setAnchor(null);
    setDragFrom(null);
    setHover(null);
  };

  return (
    <div className="npick">
      <p className="npick-hint">묵는 밤을 고르세요 · 퇴실 아침은 마지막 밤 다음 날</p>
      <div className="npick-nav">
        <button type="button" className="sb" aria-label="이전 달" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={18} />
        </button>
        <b className="npick-ml">{monthLabelKo(month)}</b>
        <button type="button" className="sb" aria-label="다음 달" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight size={18} />
        </button>
        <button type="button" className="btn sm ghost" onClick={clear} disabled={!anchor && !dragFrom}>
          선택 해제
        </button>
      </div>
      <div className="npick-dow" aria-hidden>
        {DOW.map((d) => (
          <span key={d} className={d === "일" ? "su" : d === "토" ? "sa" : ""}>
            {d}
          </span>
        ))}
      </div>
      <div
        className="npick-grid"
        ref={gridRef}
        role="grid"
        aria-label="묵는 밤 선택"
        onPointerDown={onGridPointerDown}
        onPointerMove={onGridPointerMove}
        onPointerUp={onGridPointerUp}
        onPointerCancel={() => {
          setDragFrom(null);
          setHover(null);
          swallowClick.current = false;
        }}
      >
        {cells.map((c) => {
          const blockedDay = blocked.has(c.date);
          const selected = isNightInRange(c.date, preview.firstNight, preview.lastNight);
          const isToday = c.date === today;
          const out = !c.inMonth;
          const cls = [
            "npick-d",
            out ? "out" : "",
            selected ? "sel" : "",
            blockedDay ? "blk" : "",
            isToday ? "td" : "",
            c.dow === 0 ? "su" : "",
            c.dow === 6 ? "sa" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              type="button"
              key={c.date}
              data-night={out ? undefined : c.date}
              className={cls}
              disabled={out}
              aria-label={`${md(c.date)}(${weekday(c.date)}) ${blockedDay ? "이미 예약됨" : selected ? "선택됨" : "밤"}`}
              aria-pressed={selected}
              title={blockedDay ? "이미 예약됨" : undefined}
              onClick={() => !out && onCellClick(c.date, blockedDay)}
              onPointerEnter={() => {
                if (!out && anchor && !dragFrom) setHover(c.date);
              }}
            >
              <span className="num">{Number(c.date.slice(8))}</span>
            </button>
          );
        })}
      </div>
      <div className="npick-sum" role="status" aria-live="polite">
        <b>{nightPickSummary(preview.firstNight, preview.lastNight)}</b>
        <span className="muted sm">{blocked.size > 0 ? "빗금 = 이 방 이미 예약된 밤" : "방을 고르면 막힌 밤이 보여요"}</span>
      </div>
    </div>
  );
}
