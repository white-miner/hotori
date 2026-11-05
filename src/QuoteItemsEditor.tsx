import { useState } from "react";
import { addDays, allRooms, buildingName, dayLabel, freeRooms, typeLabel, usableTypes, won, type Booking, type HotelSettings } from "../shared/ledger";
import { emptyQuoteLine, normalizeQuoteItemColor, QUOTE_ITEM_COLORS, QUOTE_LINES_MAX, quoteLineWithRates, type QuoteItemColor, type QuoteLine } from "../shared/quoteDoc";
import { missingQuoteTypeRate } from "../shared/quoteRates";
import { resizeQuoteLine } from "../shared/quoteTemplates";
import "./QuoteItemsEditor.css";

type Props = {
  settings: HotelSettings;
  bookings?: Booking[];
  start: string;
  lines: QuoteLine[];
  onChange: (lines: QuoteLine[]) => void;
};

const colorLabel: Record<QuoteItemColor, string> = {
  neutral: "기본", blue: "파랑", green: "초록", purple: "보라", amber: "앰버", pink: "분홍",
};
const noBookings: Booking[] = [];

function numberValue(value: string, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
}

const moneyValue = (value: string) => numberValue(value.replace(/\D/g, ""), 0, 2_147_483_647);
const assignedCount = (line: QuoteLine) => Math.min(line.rooms, new Set(line.roomIds ?? []).size);

type RoomBlocksProps = Omit<Props, "onChange"> & {
  line: QuoteLine;
  onChange: (ids: string[]) => void;
};

function RoomBlocks({ settings, bookings = noBookings, start, lines, line, onChange }: RoomBlocksProps) {
  const checkIn = line.checkIn || start;
  const end = addDays(checkIn, line.nights);
  const selected = new Set(line.roomIds ?? []);
  const unavailable = new Set<string>();
  for (const other of lines) {
    const otherStart = other.checkIn || start;
    if (other.id !== line.id && otherStart < end && checkIn < addDays(otherStart, other.nights)) {
      other.roomIds?.forEach((id) => unavailable.add(id));
    }
  }
  const free = freeRooms(settings, bookings, {
    id: line.id, kind: "stay", checkIn, nights: line.nights, startTime: null, endTime: null,
  });
  const rooms = allRooms(settings).filter((room) => room.typeId === line.typeId);
  if (!rooms.length) return <p className="quote-room-empty">이 타입에 등록된 호실이 없어요.</p>;
  return <div className="quote-room-blocks" aria-label="호실 선택">
    {[...new Set(rooms.map((room) => room.buildingId))].map((buildingId) => (
      <div className="quote-room-building" key={buildingId}>
        {settings.buildings.length > 1 && <small>{buildingName(settings, buildingId)}</small>}
        <div className="quote-room-grid">
          {rooms.filter((room) => room.buildingId === buildingId)
            .sort((a, b) => a.no.localeCompare(b.no, "ko", { numeric: true }))
            .map((room) => {
              const picked = selected.has(room.id);
              const conflict = unavailable.has(room.id) || !free.has(room.id);
              const full = line.rooms > 1 && selected.size >= line.rooms;
              return <button key={room.id} type="button" className="quote-room-block"
                aria-label={`${buildingName(settings, buildingId)} ${room.no}호`}
                aria-pressed={picked} disabled={!picked && (conflict || full)}
                title={conflict ? "이 기간에 배정할 수 없는 객실" : full && !picked ? "선택한 객실 수가 꽉 찼어요" : undefined}
                onClick={() => {
                  const next = new Set(selected);
                  if (picked) next.delete(room.id);
                  else {
                    if (line.rooms === 1) next.clear();
                    next.add(room.id);
                  }
                  onChange([...next]);
                }}>{room.no}</button>;
            })}
        </div>
      </div>
    ))}
  </div>;
}

export default function QuoteItemsEditor({ settings, bookings, start, lines, onChange }: Props) {
  const [openRooms, setOpenRooms] = useState<string | null>(null);
  const [openRates, setOpenRates] = useState<Record<string, boolean>>({});
  const types = usableTypes(settings.types);
  const roomsById = new Map(allRooms(settings).map((room) => [room.id, room]));
  const replace = (id: string, next: QuoteLine[]) => onChange(lines.flatMap((line) => line.id === id ? next : [line]));
  const full = lines.length >= QUOTE_LINES_MAX;
  const totalRooms = lines.reduce((sum, line) => sum + line.rooms, 0);
  const assignedRooms = lines.reduce((sum, line) => sum + assignedCount(line), 0);
  return <section className="quote-items" aria-label="객실 견적 내역">
    <div className="quote-items-head">
      <strong>객실 내역 <small>총 {totalRooms}실 · 배정 {assignedRooms}실 · 미배정 {totalRooms - assignedRooms}실</small></strong>
      <button type="button" className="btn line sm" disabled={full || !types.length} onClick={() => {
        const type = types[0]!;
        onChange([...lines, { ...emptyQuoteLine(type.id), label: typeLabel(type), rateSource: "type" }]);
      }}>+ 항목 추가</button>
    </div>
    {lines.map((line, index) => {
      const ci = line.checkIn || start;
      const nights = Math.max(1, line.nights);
      const count = Math.max(1, line.rooms);
      const dates = Array.from({ length: nights }, (_, i) => addDays(ci, i));
      const rates = dates.map((_, i) => line.nightAmounts?.[i]?.amount ?? line.rate);
      const varied = rates.some((rate) => rate !== rates[0]);
      const label = (name: string) => `${index + 1}번 ${name}`;
      const patch = (fields: Partial<QuoteLine>) => replace(line.id, [{ ...line, ...fields }]);
      const setRates = (next: number[]) => replace(line.id, [quoteLineWithRates({ ...line, rateSource: "manual" }, ci, next)]);
      const resize = (checkIn: string, rooms: number, n: number) =>
        replace(line.id, [resizeQuoteLine(line, checkIn, rooms, n, settings.quoteTypeRates?.[line.typeId])]);
      const automatic = line.rateSource === "type";
      const missing = missingQuoteTypeRate(line, start);
      const roomsOpen = openRooms === line.id;
      const ratesOpen = openRates[line.id] ?? nights <= 3;
      const assigned = assignedCount(line);
      return <article key={line.id} className="quote-item" data-quote-color={line.color} aria-label={label("객실 항목")}>
        <div className="quote-item-heading">
          <strong>항목 {index + 1}</strong>
          <label className="quote-item-color">색상
            <select aria-label={label("항목 색상")} value={line.color ?? "neutral"}
              onChange={(e) => patch({ color: normalizeQuoteItemColor(e.target.value) })}>
              {QUOTE_ITEM_COLORS.map((color) => <option key={color} value={color}>{colorLabel[color]}</option>)}
            </select>
          </label>
        </div>
        <div className="quote-item-grid">
          <label>객실 타입<select aria-label={label("객실 타입")} value={line.typeId} onChange={(e) => {
            const type = types.find((item) => item.id === e.target.value);
            if (type) patch({ typeId: type.id, label: typeLabel(type), roomIds: [], roomLabels: undefined, rateSource: "type" });
          }}>
            {!types.some((type) => type.id === line.typeId) && <option value={line.typeId}>{line.label || "타입 선택"}</option>}
            {types.map((type) => <option key={type.id} value={type.id}>{typeLabel(type)}</option>)}
          </select></label>
          <label>입실<input type="date" aria-label={label("입실")} value={ci}
            onChange={(e) => e.target.value && resize(e.target.value, count, nights)} /></label>
          <label>박수<input type="number" min="1" max="365" aria-label={label("박수")} value={nights}
            onChange={(e) => resize(ci, count, numberValue(e.target.value, 1, 365))} /></label>
          <label>실수<input type="number" min="1" max="100" aria-label={label("실수")} value={count}
            onChange={(e) => resize(ci, numberValue(e.target.value, 1, 100), nights)} /></label>
          <label>실당 인원<input type="number" min="0" max="99" aria-label={label("실당 인원")} value={line.pax}
            onChange={(e) => patch({ pax: numberValue(e.target.value, 0, 99) })} /></label>
          <label>{nights > 1 ? "전체 박 단가" : "박당 단가"}
            <input inputMode="numeric" aria-label={label(nights > 1 ? "전체 박 단가" : "박당 단가")}
              title={nights > 1 ? "입력한 금액을 이 항목의 모든 날짜에 적용합니다." : undefined}
              placeholder={varied ? "날짜별 입력" : "0"} value={varied ? "" : (rates[0] || "")}
              onFocus={(e) => e.currentTarget.select()} onChange={(e) => setRates(rates.map(() => moneyValue(e.target.value)))} />
          </label>
          <div className="quote-item-amount"><span>금액</span><strong>{won(line.amount)}원</strong></div>
        </div>
        <div className="quote-item-actions">
          <span>{dayLabel(ci)} → {dayLabel(addDays(ci, nights))} · {nights}박</span>
          <small className={missing ? "quote-rate-missing" : "quote-rate-source"}>
            {missing ? `${dayLabel(missing)} 요금 미설정` : automatic ? "타입 요금 자동" : "개별 요금"}
          </small>
          {nights > 1 && <button type="button" className="btn line sm" aria-expanded={ratesOpen}
            onClick={() => setOpenRates((current) => ({ ...current, [line.id]: !ratesOpen }))}>날짜별 단가</button>}
          {!automatic && <button type="button" className="btn line sm" onClick={() => patch({ rateSource: "type" })}>타입 요금 적용</button>}
          <button type="button" className="btn line sm" disabled={full}
            onClick={() => replace(line.id, [line, { ...line, id: crypto.randomUUID(), roomIds: [], roomLabels: undefined }])}>복제</button>
          <button type="button" className="btn line sm" disabled={lines.length === 1} onClick={() => replace(line.id, [])}>삭제</button>
        </div>
        {nights > 1 && ratesOpen && <div className="quote-item-daily" aria-label={label("날짜별 단가")}>
          {dates.map((date, i) => <label key={date}>{dayLabel(date)}
            <input inputMode="numeric" aria-label={label(`${date} 단가`)} value={rates[i] || ""} placeholder="0"
              onFocus={(e) => e.currentTarget.select()} onChange={(e) =>
                setRates(rates.map((rate, j) => j === i ? moneyValue(e.target.value) : rate))} />
          </label>)}
        </div>}
        <div className="quote-item-assignment">
          <button type="button" className="btn line sm" aria-expanded={roomsOpen}
            onClick={() => setOpenRooms(roomsOpen ? null : line.id)}>호실 배정</button>
          <strong>{assigned}/{count}실</strong>
          {[...new Set(line.roomIds ?? [])].map((id) => {
            const room = roomsById.get(id);
            return <span className="quote-room-selected" key={id}
              title={room ? buildingName(settings, room.buildingId) : undefined}>{room?.no ?? line.roomLabels?.[id] ?? "번호 미확인"}</span>;
          })}
          {count > 1 && <button type="button" className="btn line sm" disabled={lines.length + count - 1 > QUOTE_LINES_MAX} onClick={() =>
            replace(line.id, Array.from({ length: count }, (_, i) => quoteLineWithRates({
              ...line,
              id: i === 0 ? line.id : crypto.randomUUID(),
              rooms: 1,
              roomIds: line.roomIds?.[i] ? [line.roomIds[i]!] : [],
            }, ci, rates)))}>객실별 단가로 나누기</button>}
        </div>
        {roomsOpen && <RoomBlocks settings={settings} bookings={bookings} start={start} lines={lines} line={line}
          onChange={(roomIds) => patch({ roomIds })} />}
      </article>;
    })}
  </section>;
}
