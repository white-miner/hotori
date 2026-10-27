/**
 * 견적·청구 한 항목 = FO 숙박예약 프리미티브 조합
 * - StayTypeCountList (간단 `.gcnt` / TypeBadge 스테퍼)
 * - NightPickCalendar (Entry/간단 동일 · 날짜 칠하기 + 박당 요금)
 * - 요일·총액 요약
 * 평행 UI(칩벽·균등분배·표형 단가) 금지. HOT-108 parity audit와 정렬.
 */
import { Trash2 } from "lucide-react";
import {
  issuanceCellsFromAmountMap,
  issuanceCellsToAmountMap,
  issuanceNightWeekdayTotal,
  type IssuanceNightCell,
} from "../shared/issuanceNightDetail";
import { type RoomType } from "../shared/ledger";
import NightPickCalendar from "./NightPickCalendar";
import StayTypeCountList from "./StayTypeCountList";

type Props = {
  types: RoomType[];
  typeId: string;
  rooms: number;
  checkIn: string;
  nights: number;
  nightAmounts: IssuanceNightCell[];
  today: string;
  /** Invoice: type/count/dates from bookings */
  locked?: boolean;
  canRemove?: boolean;
  onTypeRooms: (typeId: string, rooms: number) => void;
  onStay: (checkIn: string, nights: number) => void;
  onNightAmounts: (cells: IssuanceNightCell[]) => void;
  onRemove?: () => void;
};

export default function IssuanceStayItemEditor({
  types,
  typeId,
  rooms,
  checkIn,
  nights,
  nightAmounts,
  today,
  locked,
  canRemove,
  onTypeRooms,
  onStay,
  onNightAmounts,
  onRemove,
}: Props) {
  const amountMap = issuanceCellsToAmountMap(nightAmounts);
  const summary = issuanceNightWeekdayTotal({ cells: nightAmounts, rooms: Math.max(1, rooms) });
  const ci = checkIn && /^\d{4}-\d{2}-\d{2}$/.test(checkIn) ? checkIn : today;
  const n = Math.max(1, nights || 1);

  const counts: Record<string, number> = {};
  for (const t of types) counts[t.id] = t.id === typeId ? Math.max(0, rooms) : 0;

  const setNight = (date: string, amount: number) => {
    const nextMap = { ...amountMap, [date]: amount };
    onNightAmounts(issuanceCellsFromAmountMap(ci, n, nextMap));
  };

  return (
    <div className="iss-stay-item">
      <div className="iss-stay-top">
        <StayTypeCountList
          types={types}
          counts={counts}
          locked={locked}
          exclusive
          onChange={(next) => {
            const picked = types.find((t) => (next[t.id] ?? 0) > 0);
            if (!picked) {
              onTypeRooms(typeId, 0);
              return;
            }
            onTypeRooms(picked.id, next[picked.id] ?? 0);
          }}
        />
        {canRemove && onRemove ? (
          <button type="button" className="btn line sm" aria-label="항목 삭제" onClick={onRemove}>
            <Trash2 size={14} />
          </button>
        ) : null}
      </div>

      <div className="fld iss-stay-cal">
        <label>이용 날짜</label>
        <div>
          <NightPickCalendar
            checkIn={ci}
            nights={n}
            bookings={[]}
            roomId={null}
            today={today}
            nightAmounts={amountMap}
            onPick={(nextCi, nextN) => {
              if (locked) return;
              onStay(nextCi, nextN);
              onNightAmounts(issuanceCellsFromAmountMap(nextCi, nextN, amountMap));
            }}
            onBlocked={() => {}}
            onEditNight={setNight}
          />
        </div>
      </div>

      <p className="iss-stay-sum" role="status">
        {summary.label}
      </p>
    </div>
  );
}
