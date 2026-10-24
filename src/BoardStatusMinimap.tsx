/**
 * 「미니맵」상태 밴드 — 건물 가로 · 층=서브행 · 호수 숫자 없음.
 * MiniFloorPlan(피커)과 파일·API·색 분리. 클릭 = 점프(+선택)만.
 */
import type { GlanceMapKind } from "../shared/boardGlance";

export type MinimapFloor = {
  id: string;
  name: string;
  rooms: { id: string; kind: GlanceMapKind }[];
};

export type MinimapBuilding = {
  id: string;
  name: string;
  floors: MinimapFloor[];
};

interface Props {
  buildings: MinimapBuilding[];
  onRoomClick: (roomId: string) => void;
  /** 접근성 · 기본 상태 미니맵 */
  label?: string;
}

const KIND_TITLE: Record<GlanceMapKind, string> = {
  empty: "공실",
  arriving: "숙박예약",
  inhouse: "숙박",
  departing: "퇴실예정",
};

export default function BoardStatusMinimap({ buildings, onRoomClick, label = "상태 미니맵" }: Props) {
  if (!buildings.length) return null;
  return (
    <div className="bmap" role="region" aria-label={label}>
      <div className={`bmap-bands${buildings.length > 1 ? " multi" : ""}`}>
        {buildings.map((bd) => (
          <section key={bd.id} className="bmap-band" aria-label={bd.name}>
            <h3 className="bmap-bname">{bd.name}</h3>
            <div className="bmap-floors">
              {bd.floors.map((f) => (
                <div className="bmap-floor" key={f.id}>
                  <span className="bmap-flab">{f.name}</span>
                  <div className="bmap-rooms" role="list">
                    {f.rooms.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        role="listitem"
                        className={`bmap-blk nk-${r.kind}`}
                        title={KIND_TITLE[r.kind]}
                        aria-label={`${bd.name} ${f.name} ${KIND_TITLE[r.kind]}`}
                        onClick={() => onRoomClick(r.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
