/** 「현황」칸 날짜 탭 → 점유 밤 읽기 전용 캘린더 팝오버 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type Booking, addDays, md, stayEnd, usedNights, weekday } from "../shared/ledger";
import {
  addMonths,
  blockedNightsForRoom,
  isNightInRange,
  monthGrid,
  monthLabelKo,
  monthOf,
  nightPickSummary,
  paintedNightsFromStay,
} from "../shared/nightpick";
import { nowNightRange } from "../shared/nowboard";
import { EDIT_COPY } from "../shared/bookingEdit";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

interface Props {
  booking: Booking;
  bookings: Booking[];
  today: string;
  roomLabel?: string;
  onOpen: () => void;
  onClose: () => void;
}

export default function NowNightPopover({ booking, bookings, today, roomLabel, onOpen, onClose }: Props) {
  const nights = usedNights(booking) ?? booking.nights ?? 0;
  const painted = useMemo(() => paintedNightsFromStay(booking.checkIn, nights || 1), [booking.checkIn, nights]);
  const [month, setMonth] = useState(() => monthOf(booking.checkIn));
  const root = useRef<HTMLDivElement>(null);
  const range = nowNightRange(booking);
  const end = stayEnd(booking);
  const longStay = booking.stayMode === "long_stay";

  useEffect(() => {
    setMonth(monthOf(booking.checkIn));
  }, [booking.checkIn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose]);

  const cells = useMemo(() => monthGrid(month), [month]);
  const blocked = useMemo(() => {
    const from = addMonths(month, -1);
    const to = addDays(addMonths(month, 2), -1);
    return blockedNightsForRoom(bookings, booking.roomId, { excludeId: booking.id, from, to });
  }, [bookings, booking.roomId, booking.id, month]);

  const summary = longStay
    ? `${range.label}밤 · ${nights}박 · 퇴실 미정`
    : nightPickSummary(painted.firstNight, painted.lastNight);

  return (
    <div className="nownight-pop" ref={root} role="dialog" aria-label={`${roomLabel ?? ""} 점유 밤`} onClick={(e) => e.stopPropagation()}>
      <div className="nownight-h">
        <b>
          {roomLabel ? `${roomLabel} · ` : ""}점유 밤
        </b>
        <button type="button" className="sb ghost" aria-label="닫기" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="npick-nav">
        <button type="button" className="sb" aria-label="이전 달" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={18} />
        </button>
        <b className="npick-ml">{monthLabelKo(month)}</b>
        <button type="button" className="sb" aria-label="다음 달" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="npick-dow" aria-hidden>
        {DOW.map((d) => (
          <span key={d} className={d === "일" ? "su" : d === "토" ? "sa" : ""}>
            {d}
          </span>
        ))}
      </div>
      <div className="npick-grid nownight-grid" role="grid" aria-label="점유 밤 (읽기)">
        {cells.map((c) => {
          const blockedDay = blocked.has(c.date);
          const selected = isNightInRange(c.date, painted.firstNight, painted.lastNight);
          const isToday = c.date === today;
          const out = !c.inMonth;
          const cls = [
            "npick-d",
            "ro",
            out ? "out" : "",
            selected ? "sky" : "",
            blockedDay ? "blk" : "",
            isToday ? "td" : "",
            c.dow === 0 ? "su" : "",
            c.dow === 6 ? "sa" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <span
              key={c.date}
              className={cls}
              aria-label={`${md(c.date)}(${weekday(c.date)}) ${blockedDay ? "다른 예약" : selected ? "점유 밤" : ""}`}
              title={blockedDay ? "이 방 다른 예약" : selected ? "묵는 밤" : undefined}
            >
              <span className="num">{Number(c.date.slice(8))}</span>
            </span>
          );
        })}
      </div>
      <div className="npick-sum nownight-sum" role="status">
        <b>{summary}</b>
        {!longStay ? <span className="muted sm">퇴 {md(end)}아침</span> : null}
      </div>
      <button type="button" className="btn sm dark nownight-open" onClick={onOpen}>
        {EDIT_COPY}
      </button>
    </div>
  );
}
