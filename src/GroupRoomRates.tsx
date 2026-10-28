import { useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { won, type HotelSettings } from "../shared/ledger";
import { withAllSame } from "../shared/nightTable";
import {
  type ExtraDraft,
  type RateEdits,
  type RateSlot,
  ROW_SOURCE_LABEL,
  groupTotal,
  rowRateLine,
  slotRows,
  suggestNights,
} from "../shared/groupRates";
import NightRatesTable from "./NightRatesTable";
import RoomExtrasEditor from "./RoomExtrasEditor";

const num = (v: string) => Math.max(0, Math.min(100_000_000, Math.round(Number(v.replace(/\D/g, "").slice(0, 9)) || 0)));
const QUICK_EXTRAS = ["인원 추가", "추가 이불", "계약 조건"];

/**
 * 객실별 요금표 — 단체·다실 예약의 기본이자 하나뿐인 요금 입력.
 *  · 객실 한 줄마다 박당 요금(박마다 달라도 돼요) · 추가 항목 · 소계
 *  · 호텔 「객실 요금」 설정(특별일 > 시즌 > 평일/주말 > 기본)은 칸을 채워 주는 제안이에요 — 같은 타입이어도 방마다 따로 고쳐요
 *  · 총액은 맨 아래 소계의 합으로만 보여요 (총액을 먼저 적거나 나누지 않아요)
 */
export default function GroupRoomRates({
  s,
  slots,
  edits,
  onEdits,
  checkIn,
  nights,
  disabled,
}: {
  s: HotelSettings;
  slots: readonly RateSlot[];
  edits: RateEdits;
  onEdits: (next: RateEdits) => void;
  checkIn: string;
  nights: number;
  disabled?: boolean;
}) {
  const rows = slotRows(s, slots, edits, checkIn, nights);
  const total = groupTotal(rows);
  const patch = (key: string, p: Partial<RateEdits[string]> | null) => {
    const next = { ...edits };
    if (p === null) delete next[key];
    else next[key] = { ...next[key], ...p };
    onEdits(next);
  };
  return (
    <div className="grr" aria-label="객실별 요금">
      <div className="grr-hd">
        <span className="muted sm">객실마다 따로 정해요 · 같은 타입이어도 가격은 방마다 달라요</span>
        <a className="grr-set" href="#/settings/rates" target="_blank" rel="noopener noreferrer" title="새 탭에서 열려요 · 지금 쓰던 예약 창은 그대로예요">
          객실 요금 설정 ↗
        </a>
      </div>
      {rows.length ? (
        <ul className="grr-rows">
          {rows.map((r) => (
            <RateRow
              key={r.slot.key}
              s={s}
              row={r}
              edits={edits}
              checkIn={checkIn}
              nights={nights}
              disabled={disabled}
              onRates={(rates) => patch(r.slot.key, { rates })}
              onReset={() => patch(r.slot.key, { rates: null })}
              onExtras={(extras) => patch(r.slot.key, { extras })}
            />
          ))}
        </ul>
      ) : (
        <div className="muted sm grr-empty">방을 고르면 방마다 요금 줄이 생겨요. 호텔 요금표가 있으면 박마다 채워 드려요.</div>
      )}
      <div className="grr-tot" aria-live="polite">
        <span className="gtotal-lab">총액</span>
        <b className="num">{rows.length ? `${won(total)}원` : "—"}</b>
        <span className="muted sm">{rows.length ? ` · ${rows.length}실 소계의 합 (자동)` : " · 방을 고르면 합이 보여요"}</span>
      </div>
    </div>
  );
}

function RateRow({
  s,
  row,
  edits,
  checkIn,
  nights,
  disabled,
  onRates,
  onReset,
  onExtras,
}: {
  s: HotelSettings;
  row: ReturnType<typeof slotRows>[number];
  edits: RateEdits;
  checkIn: string;
  nights: number;
  disabled?: boolean;
  onRates: (r: NonNullable<RateEdits[string]["rates"]>) => void;
  onReset: () => void;
  onExtras: (e: ExtraDraft[]) => void;
}) {
  const { slot } = row;
  const extras = edits[slot.key]?.extras ?? [];
  const [xOpen, setXOpen] = useState(extras.length > 0);
  const sug = suggestNights(s, slot.typeId, checkIn, nights);
  const noRate = !(row.roomCharge > 0);
  const notes: Record<string, string> = {};
  if (!row.edited) for (const x of sug) notes[x.date] = x.source === "season" && x.seasonName ? `시즌 · ${x.seasonName}` : x.source === "none" ? "" : (({ date: "특별일", season: "시즌", weekend: "주말", weekday: "평일", flat: "기본", none: "" }) as const)[x.source];
  const setX = (i: number, p: Partial<ExtraDraft>) => onExtras(extras.map((x, k) => (k === i ? { ...x, ...p } : x)));
  return (
    <li className={`grr-row${noRate ? " empty" : ""}`}>
      <div className="grr-top">
        <span className="grr-no">
          <b>{slot.label}</b>
          <small className="muted">{slot.sub}</small>
        </span>
        <label className="inp price sm grr-inp">
          <span className="pl">1박</span>
          <input
            className="num"
            inputMode="numeric"
            disabled={disabled}
            aria-label={`${slot.label} 1박 요금`}
            placeholder={row.uniform == null && Object.keys(row.rates.nights ?? {}).length ? "박마다 다름" : "0"}
            value={row.uniform ? won(row.uniform) : ""}
            onChange={(e) => onRates(withAllSame(checkIn, nights, num(e.target.value)))}
          />
          원
        </label>
        <span className="grr-sub" aria-label={`${slot.label} 소계`}>
          <small className="muted">소계</small> <b className="num">{won(row.subtotal)}원</b>
        </span>
      </div>
      <div className="grr-meta muted sm">
        <span>{noRate ? "요금이 없어요 · 1박 요금을 입력해 주세요" : rowRateLine(row, nights)}</span>
        {row.sources.length ? (
          <span className="grr-src" aria-label={`${slot.label} 요금 출처`}>
            {row.sources.map((x) => (
              <i key={x} className={x === ROW_SOURCE_LABEL.edited ? "ed" : ""}>
                {x}
              </i>
            ))}
          </span>
        ) : null}
        {row.edited ? (
          <>
            <span className="grr-flag">직접 수정됨</span>
            <button type="button" className="grr-reset" disabled={disabled} onClick={onReset} title="호텔 요금표 값으로 되돌려요">
              <RotateCcw size={12} aria-hidden /> 호텔 요금으로
            </button>
          </>
        ) : null}
      </div>
      <NightRatesTable
        checkIn={checkIn}
        nights={nights}
        rates={row.rates}
        label={slot.label}
        bare
        disabled={disabled}
        notes={notes}
        onChange={(r) => onRates({ ...r, extras: null })}
      />
      <div className="grr-x">
        <button type="button" className={`grr-xtg${extras.length ? " on" : ""}`} aria-expanded={xOpen} onClick={() => setXOpen((o) => !o)}>
          <Plus size={13} aria-hidden /> 추가 항목{row.extras > 0 ? ` · +${won(row.extras)}원` : ""}
        </button>
        {xOpen ? (
          <RoomExtrasEditor label={slot.label} extras={extras} onChange={onExtras} />
        ) : null}
      </div>
    </li>
  );
}
