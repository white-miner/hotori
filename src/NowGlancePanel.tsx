/**
 * 「미니맵」— 상태 밴드 · 공실 요약 · 타입 칩 단일 sticky 패널.
 * 총/사용/남음 = 헤더「미니맵」토글 바로 옆(왼쪽 한 줄) · 탭=점유 필터(사이드 목록 ❌).
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { GLANCE_ROOM_CHIP_CAP, type GlanceOccFilter } from "../shared/boardGlance";
import type { RoomType } from "../shared/ledger";
import { typeLabel } from "../shared/ledger";
import BoardStatusMinimap, { type MinimapBuilding } from "./BoardStatusMinimap";
import { TypeStockChip } from "./primitives";

export type GlanceVacantRoom = { id: string; label: string };

export type GlanceTypeStock = {
  t: RoomType;
  rem: number;
  total: number;
  /** 이 타입 여유가 오버 대체의 소스로 쓰임 */
  subSrc?: boolean;
  /** 이 타입 오버에 대체 지정됨 */
  subRelieved?: boolean;
};

interface Props {
  total: number;
  used: number;
  left: number;
  vacantRooms: GlanceVacantRoom[];
  onVacantChip: (roomId: string) => void;
  typeStock: GlanceTypeStock[];
  lowThreshold: number;
  onTypeStock: (typeId: string) => void;
  buildings: MinimapBuilding[];
  onRoomBlock: (roomId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 점유 필터 (총=null · 사용 · 남음) — 보드 칸 dim과 동기 */
  occFilter: GlanceOccFilter;
  onOccFilterChange: (next: GlanceOccFilter) => void;
}

export default function NowGlancePanel({
  total,
  used,
  left,
  vacantRooms,
  onVacantChip,
  typeStock,
  lowThreshold,
  onTypeStock,
  buildings,
  onRoomBlock,
  open,
  onOpenChange,
  occFilter,
  onOccFilterChange,
}: Props) {
  const [roomsExpand, setRoomsExpand] = useState(false);

  const roomHidden =
    !roomsExpand && vacantRooms.length > GLANCE_ROOM_CHIP_CAP
      ? vacantRooms.length - GLANCE_ROOM_CHIP_CAP
      : 0;
  const roomsShown = roomHidden ? vacantRooms.slice(0, GLANCE_ROOM_CHIP_CAP) : vacantRooms;

  const toggle = () => onOpenChange(!open);

  /** 사용/남음 = 토글 · 총(또는 활성 재탭) = 해제 */
  const tapOcc = (next: GlanceOccFilter) => {
    if (next === null || occFilter === next) onOccFilterChange(null);
    else onOccFilterChange(next);
  };

  const occChips = (
    <div className="board-glance-occ" role="group" aria-label="점유 필터">
      <button
        type="button"
        className={`now-vacancy-stat${occFilter === null ? " on" : ""}`}
        aria-pressed={occFilter === null}
        title="전체 보기"
        onClick={() => tapOcc(null)}
      >
        총 <span className="num">{total}</span>
      </button>
      <button
        type="button"
        className={`now-vacancy-stat${occFilter === "used" ? " on" : ""}`}
        aria-pressed={occFilter === "used"}
        title="사용 중만 강조"
        onClick={() => tapOcc("used")}
      >
        사용 <span className="num">{used}</span>
      </button>
      <button
        type="button"
        className={`now-vacancy-stat left${occFilter === "left" ? " on" : ""}`}
        aria-pressed={occFilter === "left"}
        title="남은 호수만 강조"
        onClick={() => tapOcc("left")}
      >
        남음 <span className="num">{left}</span>
      </button>
    </div>
  );

  const vacantRow =
    left > 0 ? (
      <div
        className={`now-vacancy-nos board-glance-nos${roomsExpand ? " open" : ""}${
          occFilter === "left" ? " filter-on" : ""
        }`}
      >
        {roomsShown.map((r) => (
          <button
            key={r.id}
            type="button"
            className="now-vacancy-no"
            title={`${r.label}로 이동`}
            onClick={() => onVacantChip(r.id)}
          >
            {r.label}
          </button>
        ))}
        {roomHidden ? (
          <button type="button" className="now-vacancy-more" onClick={() => setRoomsExpand(true)}>
            +{roomHidden}
          </button>
        ) : null}
        {roomsExpand && vacantRooms.length > GLANCE_ROOM_CHIP_CAP ? (
          <button type="button" className="now-vacancy-more" onClick={() => setRoomsExpand(false)}>
            접기
          </button>
        ) : null}
      </div>
    ) : (
      <span className="now-vacancy-none">남은 호수 없음</span>
    );

  let body: ReactNode = null;
  if (open) {
    body = (
      <div className="board-glance-body">
        <BoardStatusMinimap buildings={buildings} onRoomClick={onRoomBlock} occFilter={occFilter} />

        <div className="board-glance-rooms">{vacantRow}</div>

        {typeStock.length ? (
          <div className="now-vacancy-row now-vacancy-types">
            <div className="now-vacancy-typechips open" role="list">
              {typeStock.map(({ t, rem, total: tot, subSrc, subRelieved }) => {
                const remLab = rem < 0 ? `−${-rem}` : String(rem);
                const hint = rem < 0 || subRelieved ? "지정 대체 객실" : subSrc ? "대체로 사용 중" : "판매 캘린더";
                return (
                  <TypeStockChip
                    key={t.id}
                    t={t}
                    rem={rem}
                    total={tot}
                    lowThreshold={lowThreshold}
                    subSrc={subSrc}
                    subRelieved={subRelieved}
                    title={`${typeLabel(t)} 여유 ${remLab} · ${hint}`}
                    onClick={() => onTypeStock(t.id)}
                  />
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`board-glance${open ? " open" : " collapsed"}`} role="region" aria-label="미니맵">
      <div className={open ? "board-glance-head" : "board-glance-bar"} role="group" aria-label="미니맵 요약">
        <button type="button" className="board-glance-toggle" onClick={toggle} aria-expanded={open}>
          {open ? (
            <ChevronDown size={14} strokeWidth={2.4} aria-hidden />
          ) : (
            <ChevronRight size={14} strokeWidth={2.4} aria-hidden />
          )}
          미니맵
        </button>
        {occChips}
      </div>
      {body}
    </div>
  );
}
