import { useState } from "react";
import { md, won } from "../shared/ledger";
import { weekday } from "../shared/ledger";
import { enteredNightMap, fillBlankNights, fillBlankWithAmount } from "../shared/nightTable";
import { occupiedNightDates } from "../shared/nightrates";
import { isPeakNight } from "../shared/surcharge";

/**
 * 박별 요금 입력 (기록 정정) — 적은 박만 진실이에요.
 *  · 안 적은 박은 비어 있고, 타입 요금은 회색 제안(placeholder)으로만 보여요
 *  · 「타입 요금으로 채우기」는 빈 박만 채우고, 채운 값도 고칠 수 있어요
 *  · 총액을 박수로 나누지 않아요
 */
export default function NightRatesEntry({
  checkIn,
  nights,
  values,
  suggestions,
  onChange,
  disabled,
  notes,
  compact,
}: {
  checkIn: string;
  nights: number;
  values: Record<string, number | null | undefined> | null | undefined;
  suggestions: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  disabled?: boolean;
  /** 날짜별 보조 문구 (예: 시즌 · 성수기) */
  notes?: Record<string, string>;
  /** 객실 줄 안에서: 안내 문구를 줄여요 */
  compact?: boolean;
}) {
  const [per, setPer] = useState("");
  const dates = occupiedNightDates(checkIn, nights);
  const cur = enteredNightMap(checkIn, nights, values);
  const hasSug = dates.some((d) => (suggestions[d] ?? 0) > 0);
  const blanks = dates.filter((d) => cur[d] == null).length;
  const num = (v: string) => Math.max(0, Math.min(100_000_000, Math.round(Number(v.replace(/\D/g, "").slice(0, 9)) || 0)));
  return (
    <div className="nrt nre" aria-label="박별 요금">
      <div className="nrt-top">
        {compact ? null : <span className="muted sm nre-hint">박마다 적어요 · 비워 둔 박은 비어 있는 그대로 저장돼요 (총액을 나눠 채우지 않아요)</span>}
        <button
          type="button"
          className="nrt-same"
          disabled={disabled || !hasSug || !blanks}
          title={hasSug ? "설정의 타입 요금(판매 캘린더)으로 빈 박만 채워요 · 채운 뒤에도 고칠 수 있어요" : "이 타입에 설정된 요금이 없어요"}
          onClick={() => onChange(fillBlankNights(checkIn, nights, cur, suggestions))}
        >
          타입 요금으로 채우기
        </button>
        <label className="nre-per">
          <input
            className="num"
            inputMode="numeric"
            disabled={disabled || !blanks}
            aria-label="박당 금액"
            placeholder="박당 금액"
            value={per ? won(Number(per)) : ""}
            onChange={(e) => setPer(e.target.value.replace(/\D/g, "").slice(0, 9))}
          />
          <span className="nrt-u">원</span>
        </label>
        <button
          type="button"
          className="nrt-same"
          disabled={disabled || !blanks || !(Number(per) > 0)}
          title="적은 금액을 빈 박에만 넣어요 · 이미 적은 박은 그대로 · 채운 뒤에도 박마다 고칠 수 있어요"
          onClick={() => onChange(fillBlankWithAmount(checkIn, nights, cur, Number(per)))}
        >
          박당 금액으로 채우기
        </button>
        <button type="button" className="nrt-same" disabled={disabled || !Object.keys(cur).length} onClick={() => onChange({})}>
          비우기
        </button>
      </div>
      <ul className="nrt-list" aria-label="박별 금액">
        {dates.map((d) => {
          const wd = weekday(d);
          return (
            <li key={d} className={`nrt-row${isPeakNight(d, []) ? " peak" : ""}`}>
              <span className="nrt-d">
                {md(d)}
                <small>({wd})</small>
                {notes?.[d] ? <em className="nrt-note">{notes[d]}</em> : null}
              </span>
              <input
                className="num"
                inputMode="numeric"
                disabled={disabled}
                aria-label={`${md(d)}(${wd}) 요금`}
                value={cur[d] != null ? won(cur[d]!) : ""}
                placeholder={(suggestions[d] ?? 0) > 0 ? won(suggestions[d]!) : "금액"}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, "");
                  const next = { ...cur };
                  if (!raw) delete next[d];
                  else next[d] = num(raw);
                  onChange(next);
                }}
              />
              <span className="nrt-u">원</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
