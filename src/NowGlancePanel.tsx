/**
 * 점유 요약과 기존 지도/타입별 재고 연결.
 * compact는 요약·타입별 재고를 상시 표시하고 객실 지도만 필요할 때 연다.
 */
import { useId, useRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type GlanceOccFilter } from "../shared/boardGlance";
import type { RoomType } from "../shared/ledger";
import { typeLabel } from "../shared/ledger";
import BoardStatusMinimap, { type MinimapBuilding } from "./BoardStatusMinimap";
import { TypeStockChip } from "./primitives";
import "./NowGlancePanel.css";

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
  /** 현황의 세 번째 조작 행 + 상시 재고. open은 지도만 제어한다. */
  compact?: boolean;
}

export default function NowGlancePanel({
  total,
  used,
  left,
  typeStock,
  lowThreshold,
  onTypeStock,
  buildings,
  onRoomBlock,
  open,
  onOpenChange,
  occFilter,
  onOccFilterChange,
  compact = false,
}: Props) {
  const id = useId();
  const mapTriggerRef = useRef<HTMLButtonElement>(null);
  const toggle = () => onOpenChange(!open);
  const close = () => {
    onOpenChange(false);
    mapTriggerRef.current?.focus();
  };

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
        title="잔여 객실만 강조"
        onClick={() => tapOcc("left")}
      >
        잔여 <span className="num">{left}</span>
      </button>
    </div>
  );

  const map = <BoardStatusMinimap buildings={buildings} onRoomClick={onRoomBlock} occFilter={occFilter} />;
  const stock = typeStock.length ? (
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
  ) : null;

  if (compact) return (
    <section className={`board-glance now-glance-compact${open ? " open" : " collapsed"}`} aria-label="객실현황"
      onKeyDown={event => {
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
      }}>
      <div className="now-glance-summary">
        {occChips}
        <div className="now-glance-entrypoints" role="group" aria-label="객실현황 바로 보기">
          <button ref={mapTriggerRef} type="button" className="now-glance-details-toggle" onClick={toggle}
            aria-expanded={open} aria-controls={`${id}-map`}>
            객실 지도
            {open ? <ChevronDown size={17} aria-hidden /> : <ChevronRight size={17} aria-hidden />}
          </button>
        </div>
      </div>
      {typeStock.length ? <section className="now-glance-stock" aria-label="타입별 재고">
        <h2>타입별 재고</h2>
        {stock}
      </section> : null}
      {open ? <section className="now-glance-details" id={`${id}-map`} aria-label="객실 지도">
        <div className="now-glance-details-head">
          <h2>객실 지도</h2>
          <button type="button" className="now-glance-close" onClick={close}>닫기</button>
        </div>
        {map}
      </section> : null}
    </section>
  );

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
      {open ? <div className="board-glance-body">{map}{stock}</div> : null}
    </div>
  );
}
