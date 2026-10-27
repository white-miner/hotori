/**
 * FO 간단예약형 타입×실수 스테퍼 목록.
 * SoT markup/classes: SimpleBooking `.mfp-types` / `.gcounts` / `.gcnt` / TypeBadge.
 * 견적·청구도 이 컴포넌트를 재사용 (평행 UI 금지).
 */
import { Minus, Plus } from "lucide-react";
import { type RoomType, typeLabel } from "../shared/ledger";
import { TypeBadge } from "./ui";

export type StayTypeCount = { typeId: string; count: number };

type Props = {
  types: RoomType[];
  /** typeId → 실수 */
  counts: Record<string, number>;
  /** 타입당 최대 실수 (기본 40) */
  maxPerType?: number;
  /** 전체 실수 합 상한 */
  maxTotal?: number;
  /** 재고 힌트 (간단예약 잔여 수) — 없으면 숨김 */
  leftByType?: Record<string, number>;
  /** true면 스테퍼 비활성(청구서: 예약에서 온 실수) */
  locked?: boolean;
  /** 단일 타입만 허용(견적 한 항목) — 다른 타입 + 시 기존 타입 0 */
  exclusive?: boolean;
  onChange: (counts: Record<string, number>) => void;
};

export default function StayTypeCountList({
  types,
  counts,
  maxPerType = 40,
  maxTotal = 40,
  leftByType,
  locked,
  exclusive,
  onChange,
}: Props) {
  const total = Object.values(counts).reduce((n, c) => n + Math.max(0, c || 0), 0);

  const setCount = (tid: string, next: number) => {
    if (locked) return;
    const v = Math.max(0, Math.min(maxPerType, Math.round(next) || 0));
    const others = total - (counts[tid] ?? 0);
    const capped = Math.min(v, Math.max(0, maxTotal - others));
    if (exclusive) {
      const nextMap: Record<string, number> = {};
      for (const t of types) nextMap[t.id] = t.id === tid ? capped : 0;
      onChange(nextMap);
      return;
    }
    onChange({ ...counts, [tid]: capped });
  };

  return (
    <div className="mfp-types">
      <div className="muted sm">타입 · 실수</div>
      <div className="gcounts mfp-type-list">
        {types.map((t) => {
          const c = counts[t.id] ?? 0;
          const left = leftByType?.[t.id];
          const max = Math.max(maxPerType, c);
          return (
            <div className={`gcnt ${c ? "on" : ""}`} key={t.id}>
              <TypeBadge t={t} />
              {left != null ? <span className="muted sm">잔여 {left}</span> : null}
              <span className="step sm">
                <button
                  type="button"
                  className="sb"
                  aria-label={`${typeLabel(t)} 1실 빼기`}
                  disabled={locked || !c}
                  onClick={() => setCount(t.id, c - 1)}
                >
                  <Minus size={14} />
                </button>
                <input
                  className="gin num"
                  inputMode="numeric"
                  aria-label={`${typeLabel(t)} 방 수`}
                  value={c}
                  disabled={locked}
                  onChange={(e) => setCount(t.id, Number(e.target.value.replace(/\D/g, "") || 0))}
                />
                <button
                  type="button"
                  className="sb"
                  aria-label={`${typeLabel(t)} 1실 더하기`}
                  disabled={locked || (c >= max && total >= maxTotal)}
                  onClick={() => setCount(t.id, c + 1)}
                >
                  <Plus size={14} />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
