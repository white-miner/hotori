import { Plus, X } from "lucide-react";
import { won } from "../shared/ledger";
import { ROOM_EXTRA_MAX, ROOM_EXTRA_NAME_MAX } from "../shared/nightrates";
import type { ExtraDraft } from "../shared/groupRates";

const num = (v: string) => Math.max(0, Math.min(100_000_000, Math.round(Number(v.replace(/\D/g, "").slice(0, 9)) || 0)));
const QUICK_EXTRAS = ["인원 추가", "추가 이불", "계약 조건"];

/**
 * 객실 추가 항목 고치기 — 이름 · 금액 · 박당/한 번. 예약창과 입력 뒤 정정에서 같은 칸을 써요.
 * 이름과 금액은 자유예요 (빠른 칸은 제안일 뿐).
 */
export default function RoomExtrasEditor({ label, extras, onChange, disabled }: { label: string; extras: ExtraDraft[]; onChange: (e: ExtraDraft[]) => void; disabled?: boolean }) {
  const setX = (i: number, p: Partial<ExtraDraft>) => onChange(extras.map((x, k) => (k === i ? { ...x, ...p } : x)));
  return (
    <div className="grr-xbody" role="group" aria-label={`${label} 추가 항목`}>
      {extras.map((x, i) => (
        <div className="grr-xline" key={i}>
          <input className="inp sm" placeholder="예: 추가 이불" maxLength={ROOM_EXTRA_NAME_MAX} disabled={disabled} aria-label={`${label} 추가 항목 이름 ${i + 1}`} value={x.name} onChange={(e) => setX(i, { name: e.target.value })} />
          <label className="inp price sm">
            <input className="num" inputMode="numeric" placeholder="0" disabled={disabled} aria-label={`${label} 추가 항목 금액 ${i + 1}`} value={x.amount ? won(x.amount) : ""} onChange={(e) => setX(i, { amount: num(e.target.value) })} />
            원
          </label>
          <span className="seg sm" role="group" aria-label="적용 방식">
            <button type="button" className={x.perNight ? "on" : ""} disabled={disabled} onClick={() => setX(i, { perNight: true })}>
              박당
            </button>
            <button type="button" className={x.perNight ? "" : "on"} disabled={disabled} onClick={() => setX(i, { perNight: false })}>
              한 번
            </button>
          </span>
          <button type="button" className="grr-xdel" disabled={disabled} aria-label={`${label} 추가 항목 ${i + 1} 지우기`} onClick={() => onChange(extras.filter((_, k) => k !== i))}>
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
      {extras.length < ROOM_EXTRA_MAX ? (
        <div className="grr-xadd">
          {QUICK_EXTRAS.map((q) => (
            <button key={q} type="button" className="chip sm" disabled={disabled} onClick={() => onChange([...extras, { name: q, amount: 0, perNight: q !== "계약 조건" }])}>
              <Plus size={11} aria-hidden /> {q}
            </button>
          ))}
          <button type="button" className="chip sm" disabled={disabled} onClick={() => onChange([...extras, { name: "", amount: 0, perNight: false }])}>
            <Plus size={11} aria-hidden /> 직접 쓰기
          </button>
        </div>
      ) : null}
      <div className="muted sm">이 객실 소계에 더해지고, 객실별 요금과 청구에 따로 보여요.</div>
    </div>
  );
}
