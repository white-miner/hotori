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
}: {
  t: RoomType;
  rem: number;
  total: number;
  lowThreshold: number;
  /** 기본 `{total}실` · 판매 글랜스는 `칸~ · N실` 등 */
  small?: ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  id?: string;
}) {
  const lv = stockLevel(rem, total, lowThreshold);
  const remLab = rem < 0 ? `−${-rem}` : String(rem);
  return (
    <button
      id={id}
      type="button"
      className={`sales-gchip lv-${lv}`}
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
