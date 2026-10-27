import { ArrowDown, ArrowUp } from "lucide-react";
import { toggleUaSort, UA_SORT_KEYS, type UaSort } from "../shared/uaSort";

/** 미배정 예약 정렬 버튼 · 현황/배치 운영패널 공용. 같은 버튼을 다시 누르면 오름↔내림. */
export default function UaSortBar({ sort, onChange }: { sort: UaSort; onChange: (s: UaSort) => void }) {
  return (
    <div className="ua-sort" role="group" aria-label="미배정 정렬">
      {UA_SORT_KEYS.map((k) => {
        const on = sort.key === k.id;
        const Arrow = sort.dir === "asc" ? ArrowUp : ArrowDown;
        return (
          <button
            key={k.id}
            type="button"
            className={`ua-sort-btn ${on ? "on" : ""}`}
            aria-pressed={on}
            title={on ? `${k.label} · ${sort.dir === "asc" ? "오름차순" : "내림차순"} (다시 누르면 반대)` : k.label}
            onClick={() => onChange(toggleUaSort(sort, k.id))}
          >
            {k.label}
            {on ? <Arrow size={13} strokeWidth={2.6} aria-label={sort.dir === "asc" ? "오름차순" : "내림차순"} /> : null}
          </button>
        );
      })}
    </div>
  );
}
