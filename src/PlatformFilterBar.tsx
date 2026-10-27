import { X } from "lucide-react";
import type { PlatformChip } from "../shared/platformFilter";

/**
 * 플랫폼별 보기 — 현황·배치 상단. 칸을 숨기지 않고 해당 없는 칸만 흐리게 해요.
 * 칩은 흑백 한 가지 톤 (선택 = 검정 채움)으로 색을 늘리지 않아요.
 */
export default function PlatformFilterBar({
  chips,
  selected,
  onToggle,
  onClear,
  paused,
}: {
  chips: PlatformChip[];
  selected: readonly string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  /** 이동·방배정 중에는 흐림을 잠시 꺼요 */
  paused?: boolean;
}) {
  if (chips.length < 1) return null;
  const on = selected.length > 0;
  return (
    <div className="pf-bar" role="group" aria-label="플랫폼별 보기">
      <div className="pf-chips">
        <span className="pf-lab">플랫폼</span>
        <button type="button" className={`pf-chip ${on ? "" : "on"}`} aria-pressed={!on} onClick={onClear}>
          전체
        </button>
        {chips.map((c) => {
          const sel = selected.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              className={`pf-chip ${sel ? "on" : ""}`}
              aria-pressed={sel}
              onClick={() => onToggle(c.id)}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      {on ? (
        <div className="pf-note" role="status">
          <span>
            {paused ? "이동·배정 중에는 흐림을 잠시 꺼요" : "선택하지 않은 플랫폼 칸은 흐리게 보여요"} · 재고·초과는 전체 기준
          </span>
          <button type="button" className="pf-clear" onClick={onClear}>
            <X size={12} strokeWidth={2.6} aria-hidden />
            필터 해제
          </button>
        </div>
      ) : null}
    </div>
  );
}
