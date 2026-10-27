import type { ReactNode } from "react";
import type { RoomType } from "../../shared/ledger";
import { stockLevel } from "../../shared/ledger";
import { TypeBadge } from "../ui";

/** 판매 캘린더 `.sales-gchip` — 타입 배지 · 여유 수 · 총실. 현황 글랜스와 동일 시각. */
export function TypeStockChip({
  t,
  rem,
  total,
  lowThreshold,
  small,
  onClick,
  title,
  disabled,
  id,
  /** 대체 타입으로 여유 차감됨 */
  subSrc,
  /** 오버에 대체 지정됨 (완화 중) */
  subRelieved,
}: {
  t: RoomType;
  rem: number;
  total: number;
  lowThreshold: number;
  /** 기본 `{total}실` · 판매 글랜스는 `M/D · N실` (하룻밤만) */
  small?: ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  id?: string;
  subSrc?: boolean;
  subRelieved?: boolean;
}) {
  const lv = stockLevel(rem, total, lowThreshold);
  const remLab = rem < 0 ? `−${-rem}` : String(rem);
  const extra = [subSrc ? "sub-src" : "", subRelieved ? "sub-relieved" : ""].filter(Boolean).join(" ");
  return (
    <button
      id={id}
      type="button"
      className={`sales-gchip lv-${lv}${extra ? ` ${extra}` : ""}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      <TypeBadge t={t} />
      <b className="num">{remLab}</b>
      <small>{small ?? `${total}실`}</small>
    </button>
  );
}
