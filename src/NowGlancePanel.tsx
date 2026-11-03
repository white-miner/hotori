/**
 * 점유 요약과 기존 지도/타입별 재고 연결.
 * compact는 현황의 상시 요약 행과 지도/재고 탭을 제공하고 기본 모양은 보존한다.
 */
import { useId, useRef, useState, type KeyboardEvent } from "react";
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
  /** 현황의 세 번째 행: 상시 요약 + 지도/재고 중 하나만 펼친다. */
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
  const [detailTab, setDetailTab] = useState<"map" | "stock">("map");
  const id = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const mapTabRef = useRef<HTMLButtonElement>(null);
  const stockTabRef = useRef<HTMLButtonElement>(null);
  const toggle = () => onOpenChange(!open);
  const close = () => {
    onOpenChange(false);
    toggleRef.current?.focus();
  };
  const tabKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "map" : event.key === "End" ? "stock" : detailTab === "map" ? "stock" : "map";
    setDetailTab(next);
    (next === "map" ? mapTabRef : stockTabRef).current?.focus();
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
        <button ref={toggleRef} type="button" className="now-glance-details-toggle" onClick={toggle}
          aria-expanded={open} aria-controls={`${id}-details`}>
          객실현황 {open ? "접기" : "펼치기"}
          {open ? <ChevronDown size={17} aria-hidden /> : <ChevronRight size={17} aria-hidden />}
        </button>
      </div>
      {open ? <div className="now-glance-details" id={`${id}-details`}>
        <div className="now-glance-details-head">
          <div role="tablist" aria-label="객실현황 상세 보기" className="now-glance-tabs">
            <button ref={mapTabRef} type="button" role="tab" id={`${id}-map-tab`} aria-controls={`${id}-map-panel`}
              aria-selected={detailTab === "map"} tabIndex={detailTab === "map" ? 0 : -1}
              onClick={() => setDetailTab("map")} onKeyDown={tabKeys}>객실 지도</button>
            <button ref={stockTabRef} type="button" role="tab" id={`${id}-stock-tab`} aria-controls={`${id}-stock-panel`}
              aria-selected={detailTab === "stock"} tabIndex={detailTab === "stock" ? 0 : -1}
              onClick={() => setDetailTab("stock")} onKeyDown={tabKeys}>타입별 재고</button>
          </div>
          <button type="button" className="now-glance-close" onClick={close}>닫기</button>
        </div>
        <div role="tabpanel" id={`${id}-map-panel`} aria-labelledby={`${id}-map-tab`} hidden={detailTab !== "map"}>
          {detailTab === "map" ? map : null}
        </div>
        <div role="tabpanel" id={`${id}-stock-panel`} aria-labelledby={`${id}-stock-tab`} hidden={detailTab !== "stock"}>
          {detailTab === "stock" ? stock : null}
        </div>
      </div> : null}
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
