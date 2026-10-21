/**
 * 간단 예약 미니 객실 배치도 — 층별 호수 블럭 · 건물 칩(전체 기본)
 * 방배정/호실 정하기 통일 리스트와 별도: 건물 필터는 여기만.
 */
import { useMemo } from "react";
import {
  type HotelSettings,
  buildingName,
  isMultiBuilding,
  orderedFloors,
  typeLabel,
} from "../shared/ledger";
import { Chip, ChipGroup } from "./primitives";
import type { lookups } from "./ui";

type L = ReturnType<typeof lookups>;

export type BuildingFilter = "all" | string;

interface Props {
  s: HotelSettings;
  L: L;
  free: Set<string>;
  selectedIds: string[];
  buildingFilter: BuildingFilter;
  onBuildingFilter: (id: BuildingFilter) => void;
  onToggle: (roomId: string) => void;
}

export default function MiniFloorPlan({
  s,
  L,
  free,
  selectedIds,
  buildingFilter,
  onBuildingFilter,
  onToggle,
}: Props) {
  const multi = isMultiBuilding(s);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const floors = useMemo(() => {
    const all = orderedFloors(s).filter((f) => f.rooms.length > 0);
    if (buildingFilter === "all") return all;
    return all.filter((f) => f.buildingId === buildingFilter);
  }, [s, buildingFilter]);

  const showBpre = multi && buildingFilter === "all";

  return (
    <div className="mfp">
      {multi ? (
        <ChipGroup className="mfp-buildings">
          <Chip sm active={buildingFilter === "all"} onClick={() => onBuildingFilter("all")}>
            전체
          </Chip>
          {s.buildings.map((b) => (
            <Chip
              key={b.id}
              sm
              active={buildingFilter === b.id}
              onClick={() => onBuildingFilter(b.id)}
            >
              {buildingName(s, b.id) || b.name || "건물"}
            </Chip>
          ))}
        </ChipGroup>
      ) : null}

      <div className="mfp-floors" role="list">
        {floors.map((f) => (
          <div className="mfp-floor" key={f.id} role="listitem">
            <div className="mfp-flab">
              {showBpre ? <em className="bpre">{buildingName(s, f.buildingId)}</em> : null}
              {f.name}
            </div>
            <div className="mfp-rooms">
              {f.rooms.map((r) => {
                const ok = free.has(r.id);
                const on = selected.has(r.id);
                const tip = typeLabel(L.types.get(r.typeId ?? "")) || "타입 미정";
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`mfp-block${on ? " on" : ""}${ok ? "" : " busy"}`}
                    disabled={!ok}
                    aria-pressed={on}
                    aria-label={`${r.no}호 ${tip}${ok ? "" : " · 예약 불가"}`}
                    data-tip={tip}
                    title={tip}
                    onClick={() => ok && onToggle(r.id)}
                  >
                    {r.no}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!floors.length ? <span className="muted sm">표시할 호실이 없어요</span> : null}
      </div>
    </div>
  );
}
