import { useId, useState } from 'react';
import { md, weekday, won } from '../shared/ledger';
import { type StayNightRates, extrasTotal, occupiedNightDates, sumNightAmounts } from '../shared/nightrates';
import { type StayPriceDraft, type StayPriceMode, priceDigits, resolveStayPrice } from '../shared/stayPricing';

/** One input method at a time. Switching tabs never changes saved/draft money. */
export default function StayPriceEditor({ checkIn, nights, draft, rates, price, addons = 0, suggestions = {}, onChange, disabled, label = '객실 요금' }: {
  checkIn: string; nights: number; draft?: StayPriceDraft | null; rates?: StayNightRates | null;
  price: number; addons?: number; suggestions?: Record<string, number>;
  onChange: (draft: StayPriceDraft) => void; disabled?: boolean; label?: string;
}) {
  const id = useId();
  const dates = occupiedNightDates(checkIn, nights);
  const vals = dates.map(d => rates?.nights?.[d]);
  const full = dates.length > 0 && vals.every(v => v != null);
  const same = full && vals.every(v => v === vals[0]);
  const [mode, setMode] = useState<StayPriceMode>(() => draft?.mode ?? (nights === 1 ? 'total' : full ? (same ? 'uniform' : 'daily') : 'uniform'));
  const current = draft ? resolveStayPrice(checkIn, nights, { ...draft, rates: { ...draft.rates, extras: rates?.extras } }, addons) : null;
  const map = rates?.nights ?? {};
  const extra = extrasTotal(rates) + addons;
  const baselineAmount = mode === 'total' ? Math.max(0, price - extra) : same ? vals[0]! : rates?.flat ?? 0;
  const amount = draft?.mode === mode ? draft.amount : baselineAmount > 0 ? String(baselineAmount) : '';
  const emitAmount = (raw: string) => onChange({ mode, amount: priceDigits(raw), rates });
  const emitDaily = (date: string, raw: string) => {
    const next = { ...map }; const digits = priceDigits(raw);
    if (digits === '') delete next[date]; else next[date] = Number(digits);
    onChange({ mode: 'daily', amount: '', rates: { ...rates, nights: next } });
  };
  const displayTotal = current?.price ?? price;
  const options: [StayPriceMode, string][] = [['uniform', '매일 같은 요금'], ['daily', '날짜별 요금'], ['total', nights === 1 ? '총액 입력' : '총액에서 균등 계산']];
  return <section className="stay-pricing" aria-label={label}>
    <div className="stay-pricing-tabs" role="tablist" aria-label={`${label} 입력 방식`}>
      {options.map(([key, text]) => <button key={key} id={`${id}-${key}`} aria-controls={`${id}-panel`} type="button" role="tab" aria-selected={mode === key} disabled={disabled} onClick={() => setMode(key)}>{text}</button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${mode}`}>
      {mode !== 'daily' ? <>
        <label className="stay-pricing-amount"><span>{mode === 'uniform' ? '1박 객실료' : '객실료 총액'}</span><span className="stay-pricing-input"><input inputMode="numeric" className="num" aria-label={mode === 'uniform' ? '1박 객실료' : '객실료 총액'} disabled={disabled} value={amount !== '' ? won(Number(amount)) : ''} placeholder="금액 입력" onChange={e => emitAmount(e.target.value)} /><span>원{mode === 'uniform' ? '/박' : ''}</span></span></label>
        <div className="stay-pricing-help">{mode === 'uniform' ? `${nights}박에 같은 요금을 적용합니다.` : nights === 1 ? '총액을 해당 숙박일의 요금으로 함께 저장합니다.' : `객실료 총액을 ${nights}박에 균등 배분합니다. 남는 원은 마지막 숙박일에 더합니다.`} 추가금은 별도입니다.</div>
        {!draft || draft.mode !== mode ? <button type="button" className="btn line sm" disabled={disabled || amount === ''} onClick={() => emitAmount(amount)}>{mode === 'uniform' ? '같은 요금 적용' : nights === 1 ? '해당 날짜 요금으로 적용' : '균등 계산 적용'}</button> : null}
      </> : <>
        <div className="stay-pricing-help">숙박일마다 약속한 객실료를 입력하면 총액이 자동 계산됩니다.</div>
        <div className="stay-pricing-dates">{dates.map(d => <label className="stay-pricing-date" key={d}><span>{md(d)}({weekday(d)})</span><span className="stay-pricing-input"><input inputMode="numeric" className="num" aria-label={`${md(d)}(${weekday(d)}) 객실료`} disabled={disabled} value={map[d] != null ? won(map[d]) : ''} placeholder={suggestions[d] > 0 ? won(suggestions[d]) : '금액 입력'} onChange={e => emitDaily(d, e.target.value)} /><span>원</span></span></label>)}</div>
        {dates.some(d => suggestions[d] > 0) ? <button type="button" className="btn line sm" disabled={disabled} onClick={() => onChange({ mode: 'daily', amount: '', rates: { ...rates, nights: Object.fromEntries(dates.filter(d => map[d] != null || suggestions[d] > 0).map(d => [d, map[d] ?? suggestions[d]])) } })}>빈 날짜에 설정 요금 적용</button> : null}
      </>}
      {mode === 'total' && current && draft?.mode === 'total' ? <div className="stay-pricing-preview" aria-label="날짜별 배분 결과">{dates.map(d => <span key={d}>{md(d)}({weekday(d)}) <b>{won(current.rates.nights?.[d] ?? 0)}원</b></span>)}</div> : null}
      <div className="stay-pricing-total" aria-live="polite"><span>{mode === 'uniform' && draft?.mode === mode ? `${won(Number(amount) || 0)}원 × ${nights}박` : '객실료'}{extra > 0 ? ` + 추가금 ${won(extra)}원` : extra < 0 ? ` − 할인 ${won(-extra)}원` : ''}</span><strong>총액 {won(displayTotal)}원</strong></div>
      {current?.error ? <div className="ferr" role="status">{current.error}</div> : !draft && full && sumNightAmounts(map) + extra !== price ? <div className="stay-pricing-help">기존 총액과 날짜별 합계가 다릅니다. 입력 방식을 선택해 금액을 적용하기 전까지 기존 값을 유지합니다.</div> : null}
    </div>
  </section>;
}
