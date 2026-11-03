import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import "./CalendarDateNavigation.css";

/** 운영 규칙: 날짜는 본문 중앙. 오늘·기간 입력·알림은 날짜 중심을 밀지 않는다. */
export default function CalendarDateNavigation({ label, onPrevious, onNext, onToday, atToday, customFields, status }: {
  label: string;
  onPrevious?: () => void;
  onNext?: () => void;
  onToday?: () => void;
  atToday: boolean;
  customFields?: ReactNode;
  status?: ReactNode;
}) {
  return <section className="calendar-date-navigation" aria-label="보는 날짜">
    <div className="calendar-date-top">
      <div className="calendar-date-today">
        {onToday ? <button type="button" className="btn sm" disabled={atToday} onClick={onToday}>오늘</button> : null}
      </div>
      <div className="calendar-date-center">
        {onPrevious ? <button type="button" className="ar" aria-label="이전" onClick={onPrevious}><ChevronLeft size={18} aria-hidden /></button> : <span aria-hidden />}
        <b className="calendar-date-label" aria-live="polite">{label}</b>
        {onNext ? <button type="button" className="ar" aria-label="다음" onClick={onNext}><ChevronRight size={18} aria-hidden /></button> : <span aria-hidden />}
      </div>
      <div aria-hidden />
    </div>
    {customFields ? <div className="calendar-date-custom">{customFields}</div> : null}
    {status ? <div className="calendar-date-status" role="status">{status}</div> : null}
  </section>;
}
