import { useEffect, useRef, useState } from "react";
import { addDays, STAY_NIGHTS_MAX, type Booking } from "../shared/ledger";
import NightPickCalendar from "./NightPickCalendar";

export default function StayDatesPopup(p: { checkIn: string; nights: number; today: string; bookings: Booking[]; roomIds: string[]; onClose: () => void; onPick: (day: string, nights: number) => void }) {
  const [day, setDay] = useState(p.checkIn), [nights, setNights] = useState(p.nights), [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>(".x")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); p.onClose(); }
      if (e.key === "Tab") {
        const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("keydown", key, true); previous?.focus(); };
  }, []);
  return <div className="dim stay-dates-dim" onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) p.onClose(); }}><div className="modal stay-dates-popup" ref={dialog} role="dialog" aria-modal="true" aria-label="숙박일 선택">
    <div className="mh"><h2>숙박일 선택</h2><button type="button" className="x" onClick={p.onClose}>닫기</button></div>
    <p>입실일과 퇴실일을 차례로 선택하세요.</p>
    <NightPickCalendar checkIn={day} nights={nights} bookings={p.bookings} roomId={p.roomIds[0] ?? null} roomIds={p.roomIds} today={p.today} rangeMode onBlocked={() => setError("선택한 객실에 다른 예약이 있어요.")} onPick={(d, n) => { if (n > STAY_NIGHTS_MAX) { setError(`${STAY_NIGHTS_MAX}박까지 선택할 수 있어요.`); return; } setDay(d); setNights(n); setError(""); }} />
    <p role="status">{day} 입실 → {addDays(day, nights)} 퇴실 · <b>{nights}박</b></p>
    {error ? <p role="alert" className="ferr">{error}</p> : null}
    <div className="mf"><button type="button" className="btn line" onClick={p.onClose}>취소</button><button type="button" className="btn dark" onClick={() => { p.onPick(day, nights); p.onClose(); }}>선택 적용</button></div>
  </div></div>;
}
