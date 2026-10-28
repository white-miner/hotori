import { useState } from "react";
import { won } from "../shared/ledger";
import type { StayNightRates } from "../shared/nightrates";
import { enteredNightMap, nightTableStatus } from "../shared/nightTable";
import NightRatesEntry from "./NightRatesEntry";

/**
 * 박별 요금표 — 박별 표가 진실이에요 (총액을 박수로 나누는 칸은 없어요).
 *  · 안 적은 박은 비어 있고, 타입 요금은 회색 제안이에요
 *  · 「타입 요금으로 채우기」·「박당 금액으로 채우기」는 빈 박만 채워요 (채운 뒤에도 고칠 수 있어요)
 *  · 박별 합계가 판매금(price)과 다르면 차액을 알려 주기만 해요.
 *    「판매금도 박별 합계로 바꾸기」(useSum)를 체크했을 때만 부모가 판매금을 합계로 바꿔요
 * 상태는 부모가 가진 StayNightRates 하나뿐이에요.
 */
export default function NightRatesTable({
  checkIn,
  nights,
  rates,
  suggestions,
  onChange,
  label,
  defaultOpen = false,
  disabled,
  addons = 0,
  bare,
  notes,
  price,
  useSum,
  onUseSum,
}: {
  checkIn: string;
  nights: number;
  rates: StayNightRates | null | undefined;
  /** 박별 제안 요금 (설정의 타입 요금) — 회색 placeholder · 「타입 요금으로 채우기」 */
  suggestions: Record<string, number>;
  onChange: (r: StayNightRates) => void;
  label?: string;
  defaultOpen?: boolean;
  disabled?: boolean;
  /** 객실료 말고 더해지는 금액 (표시용) */
  addons?: number;
  /** 객실별 요금 줄 안에서: 요약·차액 없이 박별 칸만 (소계는 부모가 보여 줘요) */
  bare?: boolean;
  /** 날짜별 보조 문구 (예: 주말 요금) */
  notes?: Record<string, string>;
  /** 판매금 (차액 안내용) — 체크 전에는 박별 합계와 달라도 그대로예요 */
  price?: number;
  useSum?: boolean;
  /** 있으면 차액이 있을 때 「판매금도 박별 합계로 바꾸기」 체크가 보여요 */
  onUseSum?: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const st = nightTableStatus({ checkIn, nights, rates, price: price ?? 0, addons });
  const hasPrice = price != null && price > 0;
  const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${won(Math.abs(n))}원`;
  return (
    <div className="nrt" aria-label={label ? `${label} 박별 요금` : "박별 요금"}>
      <div className="nrt-top">
        <button type="button" className="nrt-tg" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "박별 접기" : bare ? "박마다 고치기" : "박별 요금"}
        </button>
      </div>
      {bare ? null : (
        <div className="muted sm nrt-sum" aria-live="polite">
          적은 박 {st.count}/{st.total}
          {st.count ? ` · 박별 합계 ${won(st.sum)}원` : " · 박마다 적으면 합계가 보여요"}
          {addons > 0 ? ` · 가산 ${won(addons)}원 별도` : ""}
          {hasPrice && st.diff != null ? (
            st.diff === 0 ? " · 판매금과 같아요" : <> · 차액 <b>{signed(st.diff)}</b> (박별 합계 − 판매금)</>
          ) : hasPrice && st.count > 0 ? " · 모든 박을 적으면 판매금과 비교해요" : ""}
        </div>
      )}
      {!bare && onUseSum && st.diff != null && (st.diff !== 0 || useSum) ? (
        <label className="rec-usesum">
          <input type="checkbox" checked={!!useSum} disabled={disabled} onChange={(e) => onUseSum(e.target.checked)} />
          <span>
            판매금도 박별 합계로 바꾸기
            <small className="muted"> ({won(price ?? 0)}원 → {won(st.sumTotal)}원 · 끄면 판매금은 그대로)</small>
          </span>
        </label>
      ) : null}
      {open ? (
        <NightRatesEntry
          checkIn={checkIn}
          nights={nights}
          values={enteredNightMap(checkIn, nights, rates?.nights)}
          suggestions={suggestions}
          disabled={disabled}
          notes={notes}
          compact={bare}
          onChange={(map) => onChange({ ...(rates ?? { flat: null }), nights: map })}
        />
      ) : null}
    </div>
  );
}
