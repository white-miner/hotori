import { useState } from "react";
import { addDays, allRooms, buildingName, dayLabel, typeLabel, usableTypes, won, type HotelSettings } from "../shared/ledger";
import { emptyQuoteLine, QUOTE_LINES_MAX, quoteLineWithRates, type QuoteLine } from "../shared/quoteDoc";
import { missingQuoteTypeRate } from "../shared/quoteRates";
import { resizeQuoteLine } from "../shared/quoteTemplates";
import "./QuoteItemsEditor.css";

type Props = {
  settings: HotelSettings;
  start: string;
  lines: QuoteLine[];
  onChange: (lines: QuoteLine[]) => void;
};

function numberValue(value: string, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
}

export default function QuoteItemsEditor({ settings, start, lines, onChange }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const types = usableTypes(settings.types);
  const rooms = allRooms(settings);
  const replace = (id: string, next: QuoteLine[]) => onChange(lines.flatMap((line) => line.id === id ? next : [line]));
  const full = lines.length >= QUOTE_LINES_MAX;
  return <section className="quote-items" aria-label="객실 견적 내역">
    <div className="quote-items-head">
      <strong>객실 내역</strong>
      <button type="button" className="btn line sm" disabled={full || !types.length} onClick={() => {
        const type = types[0]!;
        onChange([...lines, { ...emptyQuoteLine(type.id), label: typeLabel(type), rateSource: "type" }]);
      }}>+ 항목 추가</button>
    </div>
    {lines.map((line, index) => {
      const ci = line.checkIn || start;
      const n = Math.max(1, line.nights);
      const count = Math.max(1, line.rooms);
      const dates = Array.from({ length: n }, (_, i) => addDays(ci, i));
      const rates = dates.map((_, i) => line.nightAmounts?.[i]?.amount ?? line.rate);
      const varied = rates.some((rate) => rate !== rates[0]);
      const label = (name: string) => `${index + 1}번 ${name}`;
      const patch = (fields: Partial<QuoteLine>) => replace(line.id, [{ ...line, ...fields }]);
      const setRates = (next: number[]) => replace(line.id, [quoteLineWithRates({ ...line, rateSource: "manual" }, ci, next)]);
      const automatic = line.rateSource === "type";
      const missing = missingQuoteTypeRate(line, start);
      const open = expanded === line.id;
      return <article key={line.id} className="quote-item" aria-label={label("객실 항목")}>
        <div className="quote-item-grid">
          <label>객실 타입<select aria-label={label("객실 타입")} value={line.typeId} onChange={(event) => {
            const type = types.find((item) => item.id === event.target.value);
            if (type) patch({ typeId: type.id, label: typeLabel(type), roomIds: [], rateSource: "type" });
          }}>
            {!types.some((type) => type.id === line.typeId) && <option value={line.typeId}>{line.label || "타입 선택"}</option>}
            {types.map((type) => <option key={type.id} value={type.id}>{typeLabel(type)}</option>)}
          </select></label>
          <label>입실<input type="date" aria-label={label("입실")} value={ci} onChange={(event) => {
            if (event.target.value) replace(line.id, [resizeQuoteLine(line, event.target.value, count, n)]);
          }} /></label>
          <label>박수<input type="number" min="1" max="365" aria-label={label("박수")} value={n} onChange={(event) =>
            replace(line.id, [resizeQuoteLine(line, ci, count, numberValue(event.target.value, 1, 365))])} /></label>
          <label>실수<input type="number" min="1" max="100" aria-label={label("실수")} value={count} onChange={(event) =>
            replace(line.id, [resizeQuoteLine(line, ci, numberValue(event.target.value, 1, 100), n)])} /></label>
          <label>실당 인원<input type="number" min="0" max="99" aria-label={label("실당 인원")} value={line.pax} onChange={(event) =>
            patch({ pax: numberValue(event.target.value, 0, 99) })} /></label>
          {n > 1 && n <= 3 ? <div className="quote-item-inline-rates">
            {dates.map((date, i) => <label key={date}>{dayLabel(date)}
              <input type="text" inputMode="numeric" aria-label={label(`${date} 단가`)}
                value={rates[i] || ""} placeholder="0" onChange={(event) => setRates(rates.map((rate, j) => j === i
                  ? numberValue(event.target.value.replace(/[^0-9]/g, ""), 0, 2_147_483_647) : rate))} />
            </label>)}
          </div> : <label>박당 단가<input type="text" inputMode="numeric" aria-label={label("박당 단가")} placeholder={varied ? "날짜별 요금" : "0"}
            value={varied ? "" : (rates[0] || "")} onChange={(event) => setRates(rates.map(() =>
              numberValue(event.target.value.replace(/[^0-9]/g, ""), 0, 2_147_483_647)))} /></label>}
          <div className="quote-item-amount"><span>금액</span><strong>{won(line.amount)}원</strong></div>
        </div>
        <div className="quote-item-actions">
          <span>{dayLabel(ci)} → {dayLabel(addDays(ci, n))} · {n}박{line.roomIds?.length ? ` · 호실 ${line.roomIds.length}실` : ""}{line.detail ? ` · ${line.detail}` : ""}</span>
          <small className={missing ? "quote-rate-missing" : "quote-rate-source"}>
            {missing ? `${dayLabel(missing)} 요금 미설정` : automatic ? "타입 요금 자동" : "개별 요금"}
          </small>
          {!automatic && <button type="button" className="btn line sm" onClick={() => patch({ rateSource: "type" })}>타입 요금 적용</button>}
          <button type="button" className="btn line sm" aria-expanded={open} onClick={() => setExpanded(open ? null : line.id)}>
            {n > 3 ? "날짜별 요금·호실" : "호실·요금 사유"}
          </button>
          <button type="button" className="btn line sm" disabled={full} onClick={() => replace(line.id, [line, { ...line, id: crypto.randomUUID(), roomIds: [] }])}>복제</button>
          <button type="button" className="btn line sm" disabled={lines.length === 1} onClick={() => replace(line.id, [])}>삭제</button>
        </div>
        {open && <div className="quote-item-detail">
          {n > 3 && <div className="quote-item-rates">{dates.map((date, i) => <label key={date}>{dayLabel(date)} 단가
            <input type="text" inputMode="numeric" aria-label={label(`${date} 단가`)} value={rates[i] || ""} placeholder="0"
              onChange={(event) => setRates(rates.map((rate, j) => j === i
                ? numberValue(event.target.value.replace(/[^0-9]/g, ""), 0, 2_147_483_647) : rate))} />
          </label>)}</div>}
          <label>요금 사유<input value={line.detail ?? ""} maxLength={60} placeholder="예: 추가 이불" onChange={(event) => patch({ detail: event.target.value })} /></label>
          <div className="quote-item-rates">
            {Array.from({ length: Math.min(count, (line.roomIds?.length ?? 0) + 1) }, (_, slot) => {
              const current = line.roomIds?.[slot] ?? "";
              const used = new Set(line.roomIds);
              for (const other of lines) {
                if (other.id === line.id) continue;
                const otherStart = other.checkIn || start;
                if (otherStart < addDays(ci, n) && ci < addDays(otherStart, other.nights)) {
                  other.roomIds?.forEach((id) => used.add(id));
                }
              }
              const choices = rooms.filter((room) => room.typeId === line.typeId && (room.id === current || !used.has(room.id)));
              return <label key={slot}>{slot + 1}번째 호실<select aria-label={label(`${slot + 1}번째 호실`)} value={current} onChange={(event) => {
                const ids = [...(line.roomIds ?? [])];
                ids[slot] = event.target.value;
                patch({ roomIds: ids.filter(Boolean) });
              }}>
                <option value="">미배정</option>
                {current && !choices.some((room) => room.id === current) && <option value={current}>기존 호실 다시 선택 필요</option>}
                {choices.map((room) => <option value={room.id} key={room.id}>{buildingName(settings, room.buildingId)} {room.no}호</option>)}
              </select></label>;
            })}
          </div>
          {count > 1 && <button type="button" className="btn line sm" disabled={lines.length + count - 1 > QUOTE_LINES_MAX} onClick={() =>
            replace(line.id, Array.from({ length: count }, (_, i) => quoteLineWithRates({
              ...line,
              id: i === 0 ? line.id : crypto.randomUUID(),
              rooms: 1,
              roomIds: line.roomIds?.[i] ? [line.roomIds[i]!] : [],
            }, ci, rates)))}>객실마다 인원·요금 따로 설정</button>}
        </div>}
      </article>;
    })}
  </section>;
}
