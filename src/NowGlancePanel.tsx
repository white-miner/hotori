/**
 * 「미니맵」— 공실 요약 · 타입 여유 · 상태 미니맵 단일 sticky 패널.
 * 펼침·접힌 얇은 바 모두 sticky (부모에 .board-glance 적용).
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { GLANCE_ROOM_CHIP_CAP } from "../shared/boardGlance";
import type { RoomType } from "../shared/ledger";
import { typeLabel } from "../shared/ledger";
import BoardStatusMinimap, { type MinimapBuilding } from "./BoardStatusMinimap";
import { TypeStockChip } from "./primitives";

export type GlanceVacantRoom = { id: string; label: string };

export type GlanceTypeStock = {
  t: RoomType;
  rem: number;
  total: number;
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
}: Props) {
  const [roomsExpand, setRoomsExpand] = useState(false);

  const roomHidden =
    !roomsExpand && vacantRooms.length > GLANCE_ROOM_CHIP_CAP
      ? vacantRooms.length - GLANCE_ROOM_CHIP_CAP
      : 0;
  const roomsShown = roomHidden ? vacantRooms.slice(0, GLANCE_ROOM_CHIP_CAP) : vacantRooms;

  /** 접힌 바: 여유 최소 타입 1개 (Q-A) */
  const tightType = typeStock.length
    ? [...typeStock].sort((a, b) => a.rem - b.rem || a.t.name.localeCompare(b.t.name, "ko"))[0]
    : null;

  const toggle = () => onOpenChange(!open);

  let body: ReactNode = null;
  if (open) {
    body = (
      <div className="board-glance-body">
        <div className="now-vacancy-sum board-glance-sum" role="list">
          <span className="now-vacancy-stat" role="listitem">
            총 <span className="num">{total}</span>
          </span>
          <span className="now-vacancy-stat" role="listitem">
            사용 <span className="num">{used}</span>
          </span>
          <span className="now-vacancy-stat left" role="listitem">
            남음 <span className="num">{left}</span>
          </span>
          {left > 0 ? (
            <div className={`now-vacancy-nos board-glance-nos ${roomsExpand ? "open" : ""}`}>
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
          )}
        </div>

        {typeStock.length ? (
          <div className="now-vacancy-row now-vacancy-types">
            <span className="now-vacancy-lab">타입 여유</span>
            <div className="now-vacancy-typechips open" role="list">
              {typeStock.map(({ t, rem, total: tot }) => {
                const remLab = rem < 0 ? `−${-rem}` : String(rem);
                return (
                  <TypeStockChip
                    key={t.id}
                    t={t}
                    rem={rem}
                    total={tot}
                    lowThreshold={lowThreshold}
                    title={`${typeLabel(t)} 여유 ${remLab} · 판매 캘린더`}
                    onClick={() => onTypeStock(t.id)}
                  />
                );
              })}
            </div>
          </div>
        ) : null}

        <BoardStatusMinimap buildings={buildings} onRoomClick={onRoomBlock} />
      </div>
    );
  } else {
    body = (
      <button type="button" className="board-glance-bar" onClick={toggle} aria-expanded={false}>
        <span className="board-glance-bar-lab">
          <ChevronRight size={14} strokeWidth={2.4} aria-hidden />
          미니맵
        </span>
        <span className="now-vacancy-stat left sm">
          남음 <span className="num">{left}</span>
        </span>
        {tightType ? (
          <span className="board-glance-bar-type" title={`${typeLabel(tightType.t)} 여유`}>
            {typeLabel(tightType.t)} {tightType.rem < 0 ? `−${-tightType.rem}` : tightType.rem}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div className={`board-glance${open ? " open" : " collapsed"}`} role="region" aria-label="미니맵">
      {open ? (
        <div className="board-glance-head">
          <button type="button" className="board-glance-toggle" onClick={toggle} aria-expanded>
            <ChevronDown size={14} strokeWidth={2.4} aria-hidden />
            미니맵
          </button>
        </div>
      ) : null}
      {body}
    </div>
  );
}
