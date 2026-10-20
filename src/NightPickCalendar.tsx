import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type Booking, addDays, md, weekday, won } from "../shared/ledger";
import {
  addMonths,
  blockedNightsForRoom,
  isNightInRange,
  monthGrid,
  monthLabelKo,
  monthOf,
  nextPaintedFromClick,
  nightPickSummary,
  orderNights,
  paintedNightsFromStay,
  rangeHitsBlocked,
  stayFromPaintedNights,
  type PaintedNightRange,
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
  /** 선택 밤 금액 (있으면 셀에 표시 · 중간 클릭으로 수정) */
  nightAmounts?: Record<string, number> | null;
  onEditNight?: (date: string, amount: number) => void;
}

function shortAmt(n: number): string {
  if (n >= 10_000 && n % 1000 === 0) {
    const m = n / 10_000;
    return Number.isInteger(m) ? `${m}만` : `${m.toFixed(1)}만`;
  }
  if (n <= 0) return "";
  return won(n);
}

export default function NightPickCalendar({
  checkIn,
  nights,
  bookings,
  roomId,
  excludeId,
  today,
  onPick,
  onBlocked,
  nightAmounts,
  onEditNight,
}: Props) {
  const paintedFromProps = useMemo(() => paintedNightsFromStay(checkIn, nights), [checkIn, nights]);
  /** 연속 클릭이 props 반영 전에 쌓이도록 로컬 구간 유지 (호버로는 절대 안 바꿈) */
  const [painted, setPainted] = useState<PaintedNightRange>(paintedFromProps);
  const [month, setMonth] = useState(() => monthOf(checkIn));
  /** Shift-클릭 범위 기준(마지막 클릭) */
  const [anchor, setAnchor] = useState<string | null>(null);
  /** 선택 해제 후 다음 클릭은 그 밤만 */
  const [fresh, setFresh] = useState(false);
  const [editDate, setEditDate] = useState<string | null>(null);
  const [editStr, setEditStr] = useState("");

  useEffect(() => {
    setMonth(monthOf(checkIn));
  }, [checkIn]);

  useEffect(() => {
    setPainted(paintedFromProps);
  }, [paintedFromProps]);

  const cells = useMemo(() => monthGrid(month), [month]);
  const blocked = useMemo(() => {
    const from = addMonths(month, -1);
    const to = addDays(addMonths(month, 2), -1);
    return blockedNightsForRoom(bookings, roomId, { excludeId, from, to });
  }, [bookings, roomId, excludeId, month]);

  const commit = useCallback(
    (next: PaintedNightRange) => {
      const range = orderNights(next.firstNight, next.lastNight);
      if (rangeHitsBlocked(range.firstNight, range.lastNight, blocked)) {
        onBlocked();
        return false;
      }
      const stay = stayFromPaintedNights(range.firstNight, range.lastNight);
      setPainted(range);
      onPick(stay.checkIn, stay.nights);
      setFresh(false);
      return true;
    },
    [blocked, onBlocked, onPick],
  );

  const openEdit = (date: string) => {
    if (!onEditNight) return;
    setEditDate(date);
    setEditStr(nightAmounts?.[date] != null ? String(nightAmounts[date]) : "");
  };

  const commitEdit = () => {
    if (!editDate || !onEditNight) return;
    const amount = Math.max(0, Math.round(Number(editStr.replace(/\D/g, "") || 0)));
    onEditNight(editDate, amount);
    setEditDate(null);
  };

  const onCellClick = (date: string, blockedDay: boolean, shiftKey: boolean) => {
    if (blockedDay) {
      onBlocked();
      return;
    }
    const next = nextPaintedFromClick(painted, date, { shiftKey, anchor, fresh });
    setAnchor(date);
    if (!next) {
      // 선택 구간 중간(또는 1박 재클릭) → 그날 요금 수정
      if (onEditNight && isNightInRange(date, painted.firstNight, painted.lastNight)) openEdit(date);
      return;
    }
    // 양끝 축소 대신, 금액 모드면 Alt 없이도 끝 클릭은 선택 변경 유지 · 금액은 칩으로
    commit(next);
  };

  const clear = () => {
    setAnchor(null);
    setFresh(true);
  };

  const selectedDates = useMemo(() => {
    const { firstNight, lastNight } = orderNights(painted.firstNight, painted.lastNight);
    const out: string[] = [];
    let d = firstNight;
    while (d <= lastNight) {
      out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }, [painted]);

  return (
    <div className="npick">
      <p className="npick-hint">
        묵는 밤을 클릭하세요 · Shift-클릭으로 구간 · 선택 밤을 다시 누르면 그날 요금
        {nightAmounts ? " · 셀에 금액" : ""}
      </p>
      <div className="npick-nav">
        <button type="button" className="sb" aria-label="이전 달" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={18} />
        </button>
        <b className="npick-ml">{monthLabelKo(month)}</b>
        <button type="button" className="sb" aria-label="다음 달" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight size={18} />
        </button>
        <button type="button" className="btn sm ghost" onClick={clear} disabled={!anchor && !fresh}>
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
      <div className="npick-grid" role="grid" aria-label="묵는 밤 선택">
        {cells.map((c) => {
          const blockedDay = blocked.has(c.date);
          const selected = isNightInRange(c.date, painted.firstNight, painted.lastNight);
          const isToday = c.date === today;
          const out = !c.inMonth;
          const amt = selected && nightAmounts?.[c.date] != null ? nightAmounts[c.date]! : null;
          const cls = [
            "npick-d",
            out ? "out" : "",
            selected ? "sel" : "",
            blockedDay ? "blk" : "",
            isToday ? "td" : "",
            c.dow === 0 ? "su" : "",
            c.dow === 6 ? "sa" : "",
            amt != null ? "has-amt" : "",
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
              aria-label={`${md(c.date)}(${weekday(c.date)}) ${blockedDay ? "이미 예약됨" : selected ? (amt != null ? `선택 · ${won(amt)}원` : "선택됨") : "밤"}`}
              aria-pressed={selected}
              title={blockedDay ? "이미 예약됨" : selected && onEditNight ? "다시 누르면 그날 요금" : undefined}
              onClick={(e) => !out && onCellClick(c.date, blockedDay, e.shiftKey)}
            >
              <span className="num">{Number(c.date.slice(8))}</span>
              {amt != null ? <span className="npick-amt">{shortAmt(amt)}</span> : null}
            </button>
          );
        })}
      </div>
      {nightAmounts && onEditNight && selectedDates.length ? (
        <div className="npick-rates" role="list" aria-label="선택 밤 요금">
          {selectedDates.map((d) => (
            <button
              type="button"
              key={d}
              className="npick-ratechip"
              role="listitem"
              onClick={() => openEdit(d)}
              aria-label={`${md(d)} 요금 ${won(nightAmounts[d] ?? 0)}원 수정`}
            >
              <b>{md(d)}</b>
              <span className="num">{won(nightAmounts[d] ?? 0)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {editDate ? (
        <div className="npick-edit" role="dialog" aria-label={`${md(editDate)} 요금`}>
          <span className="npick-edit-lab">
            <b>{md(editDate)}</b>({weekday(editDate)}) 밤
          </span>
          <label className="inp price sm">
            <input
              className="num"
              inputMode="numeric"
              autoFocus
              value={editStr ? won(Number(editStr)) : ""}
              onChange={(e) => setEditStr(e.target.value.replace(/\D/g, "").slice(0, 9))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitEdit();
                }
                if (e.key === "Escape") setEditDate(null);
              }}
              aria-label="그날 요금"
            />
            원
          </label>
          <button type="button" className="btn sm dark" onClick={commitEdit}>
            적용
          </button>
          <button type="button" className="btn sm ghost" onClick={() => setEditDate(null)}>
            취소
          </button>
        </div>
      ) : null}
      <div className="npick-sum" role="status" aria-live="polite">
        <b>{nightPickSummary(painted.firstNight, painted.lastNight)}</b>
        <span className="muted sm">{blocked.size > 0 ? "빗금 = 이 방 이미 예약된 밤" : "방을 고르면 막힌 밤이 보여요"}</span>
      </div>
    </div>
  );
}
