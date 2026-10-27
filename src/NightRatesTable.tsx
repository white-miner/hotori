import { useState } from "react";
import { md, won } from "../shared/ledger";
import type { StayNightRates } from "../shared/nightrates";
import { tableRows, tableSummary, tableTotal, withAllSame, withNight, withTotal } from "../shared/nightTable";

/**
 * 박별 요금표 — 총액 ⇄ 박별 금액 양방향.
 *  · 총액을 적으면 박수대로 나눠 박별 줄이 채워지고 (남는 원은 마지막 박)
 *  · 박별 금액을 고치면 총액이 합으로 바뀌어요.
 * 상태는 부모가 가진 StayNightRates 하나뿐이에요 (총액 = 박별 합).
 */
export default function NightRatesTable({
  checkIn,
  nights,
  rates,
  fallback = 0,
  onChange,
  label,
  defaultOpen = false,
  disabled,
  addons = 0,
  hideTotal,
}: {
  checkIn: string;
  nights: number;
  rates: StayNightRates | null | undefined;
  /** 박별 금액이 아직 없을 때 채울 1박 요금 */
  fallback?: number;
  onChange: (r: StayNightRates) => void;
  label?: string;
  defaultOpen?: boolean;
  disabled?: boolean;
  /** 객실료 말고 더해지는 금액 (표시용) */
  addons?: number;
  /** 총액 칸은 부모 화면에 이미 있을 때 숨겨요 */
  hideTotal?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rows = tableRows(checkIn, nights, rates, fallback);
  const total = tableTotal(rows);
  const num = (v: string) => Math.max(0, Math.min(100_000_000, Math.round(Number(v.replace(/\D/g, "").slice(0, 9)) || 0)));
  return (
    <div className="nrt" aria-label={label ? `${label} 박별 요금` : "박별 요금"}>
      <div className="nrt-top">
        {hideTotal ? <span className="muted sm">총액 ⇄ 박별 · 한쪽을 고치면 다른 쪽이 맞춰져요</span> : <label className="nrt-total">
          <span>{label ? `${label} 총액` : "총액"}</span>
          <input
            className="num"
            inputMode="numeric"
            disabled={disabled}
            aria-label={label ? `${label} 총액` : "총액"}
            value={total ? won(total) : ""}
            placeholder="0"
            onChange={(e) => onChange(withTotal(checkIn, nights, num(e.target.value)))}
          />
          <span>원</span>
        </label>}
        <button type="button" className="nrt-tg" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "박별 접기" : "박별 요금"}
        </button>
      </div>
      <div className="muted sm nrt-sum">
        {tableSummary(rows)}
        {addons > 0 ? ` · 가산 ${won(addons)}원 별도` : ""}
      </div>
      {open ? (
        <>
          <ul className="nrt-list" aria-label="박별 금액">
            {rows.map((r) => (
              <li key={r.date} className={`nrt-row${r.peak ? " peak" : ""}`}>
                <span className="nrt-d">
                  {md(r.date)}
                  <small>({r.weekday})</small>
                </span>
                <input
                  className="num"
                  inputMode="numeric"
                  disabled={disabled}
                  aria-label={`${md(r.date)}(${r.weekday}) 요금`}
                  value={r.amount ? won(r.amount) : ""}
                  placeholder="0"
                  onChange={(e) => onChange(withNight(checkIn, nights, rates, fallback, r.date, num(e.target.value)))}
                />
                <span className="nrt-u">원</span>
              </li>
            ))}
          </ul>
          {rows.length > 1 ? (
            <button type="button" className="nrt-same" disabled={disabled} onClick={() => onChange(withAllSame(checkIn, nights, rows[0]!.amount))}>
              모든 박을 {won(rows[0]!.amount)}원으로 맞추기
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
