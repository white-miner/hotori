/**
 * 간단 예약 — 이용 날짜: 입실일 칩(오늘·내일·모레) · 박수(칩 + 증감) · 입실→퇴실 요약 · 달력(두 번 누르기)
 * 순수 로직은 shared/dateChips.ts. 영업일(새벽 6시 전은 전날)은 today가 이미 반영해요.
 */
import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import type { Booking } from "../shared/ledger";
import { NIGHT_CHIPS, activeDateChip, quickDateChips, stayRangeSummary } from "../shared/dateChips";
import { STAY_NIGHTS_MAX, STAY_NIGHTS_MIN } from "../shared/ledger";
import { Chip, ChipGroup, Stepper } from "./primitives";
import NightPickCalendar from "./NightPickCalendar";

interface Props {
  checkIn: string;
  nights: number;
  today: string;
  bookings: Booking[];
  roomId: string | null;
  onChange: (checkIn: string, nights: number) => void;
  onBlocked: () => void;
  /** 이용 기간 미정 중이면 박수 입력을 숨기고 ∞ 미정으로 */
  open?: boolean;
}

export default function StayDateFields({ checkIn, nights, today, bookings, roomId, onChange, onBlocked, open }: Props) {
  const [calOpen, setCalOpen] = useState(false);
  const chips = quickDateChips(today);
  const active = activeDateChip(today, checkIn);
  const sum = stayRangeSummary(checkIn, nights);
  return (
    <div className="sdf">
      <div className="sdf-row">
        <span className="sdf-lab">입실</span>
        <ChipGroup role="group" aria-label="입실일 빠른 선택">
          {chips.map((c) => (
            <Chip key={c.id} active={active === c.id} aria-pressed={active === c.id} onClick={() => onChange(c.date, nights)}>
              {c.label}
            </Chip>
          ))}
          <Chip
            active={calOpen || active == null}
            className="sdf-other"
            aria-expanded={calOpen}
            onClick={() => setCalOpen((v) => !v)}
          >
            <CalendarDays size={14} />
            {active == null ? "다른 날짜" : "달력"}
            <ChevronDown size={14} className={calOpen ? "flip" : ""} />
          </Chip>
        </ChipGroup>
      </div>
      {open ? null : <div className="sdf-row">
        <span className="sdf-lab">숙박</span>
        <ChipGroup role="group" aria-label="박수 빠른 선택">
          {NIGHT_CHIPS.filter((n) => n <= 4).map((n) => (
            <Chip key={n} active={nights === n} aria-pressed={nights === n} onClick={() => onChange(checkIn, n)}>
              {n}박
            </Chip>
          ))}
        </ChipGroup>
        <Stepper
          value={nights}
          unit="박"
          min={STAY_NIGHTS_MIN}
          max={STAY_NIGHTS_MAX}
          onChange={(n) => onChange(checkIn, Math.min(STAY_NIGHTS_MAX, Math.max(STAY_NIGHTS_MIN, n)))}
        />
      </div>}
      <div className="sdf-sum" role="status" aria-live="polite">
        {open ? (
          <>
            <b>{sum.inLabel}</b> 입실 <span aria-hidden>→</span> <b>∞ 미정</b>
          </>
        ) : (
          <>
            <b>{sum.inLabel}</b> 입실 <span aria-hidden>→</span> <b>{sum.outLabel}</b> 퇴실
            <span className="sdf-n">
              {sum.nights}박 {sum.nights + 1}일
            </span>
          </>
        )}
      </div>
      {calOpen ? (
        <NightPickCalendar
          rangeMode
          checkIn={checkIn}
          nights={nights}
          bookings={bookings}
          roomId={roomId}
          today={today}
          onPick={onChange}
          onBlocked={onBlocked}
        />
      ) : null}
    </div>
  );
}
