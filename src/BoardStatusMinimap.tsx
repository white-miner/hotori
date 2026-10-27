/**
 * 「미니맵」상태 밴드 — 건물 가로 · 층=서브행 · 호수 숫자 없음.
 * MiniFloorPlan(피커)과 파일·API·색 분리. 클릭 = 점프(+선택)만.
 */
import { glanceKindMatchesOccFilter, type GlanceMapKind, type GlanceOccFilter } from "../shared/boardGlance";

export type MinimapFloor = {
  id: string;
  name: string;
  rooms: { id: string; kind: GlanceMapKind; /** 플랫폼 필터에 안 걸림 → 흐리게 */ dim?: boolean }[];
};

export type MinimapBuilding = {
  id: string;
  name: string;
  floors: MinimapFloor[];
};

interface Props {
  buildings: MinimapBuilding[];
  onRoomClick: (roomId: string) => void;
  /** 점유 필터 — 비매칭 블럭 dim (게스트검색 dim과 동일 톤) */
  occFilter?: GlanceOccFilter;
  /** 접근성 · 기본 상태 미니맵 */
  label?: string;
}

const KIND_TITLE: Record<GlanceMapKind, string> = {
  empty: "공실",
  arriving: "숙박예약",
  inhouse: "숙박",
  departing: "퇴실예정",
  held: "마감",
};

export default function BoardStatusMinimap({
  buildings,
  onRoomClick,
  occFilter = null,
  label = "상태 미니맵",
}: Props) {
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
                    {f.rooms.map((r) => {
                      const dim = !glanceKindMatchesOccFilter(r.kind, occFilter) || !!r.dim;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          role="listitem"
                          className={`bmap-blk nk-${r.kind}${dim ? " bmap-dim" : ""}`}
                          title={KIND_TITLE[r.kind]}
                          aria-label={`${bd.name} ${f.name} ${KIND_TITLE[r.kind]}`}
                          onClick={() => onRoomClick(r.id)}
                        />
                      );
                    })}
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
