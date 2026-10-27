/** 발급 모달 이전/다음 · 페이지 점 — 긴 미리보기를 뷰포트에 맞춤 */
import { ChevronLeft, ChevronRight } from "lucide-react";

export type IssuancePagerLabels = {
  prev: string;
  next: string;
  pageAria: string;
};

export const ISS_PAGER_KO: IssuancePagerLabels = {
  prev: "이전",
  next: "다음",
  pageAria: "페이지",
};

export const ISS_PAGER_EN: IssuancePagerLabels = {
  prev: "Prev",
  next: "Next",
  pageAria: "Page",
};

interface Props {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  labels?: IssuancePagerLabels;
  className?: string;
}

export default function IssuancePager({
  page,
  pageCount,
  onChange,
  labels = ISS_PAGER_KO,
  className = "",
}: Props) {
  if (pageCount <= 1) return null;
  const safe = Math.max(0, Math.min(pageCount - 1, page));
  return (
    <div className={`iss-pager ${className}`.trim()} role="navigation" aria-label={labels.pageAria}>
      <button
        type="button"
        className="btn line sm iss-pager-nav"
        disabled={safe <= 0}
        onClick={() => onChange(safe - 1)}
        aria-label={labels.prev}
      >
        <ChevronLeft size={14} /> {labels.prev}
      </button>
      <div className="iss-pager-dots" role="tablist" aria-label={labels.pageAria}>
        {Array.from({ length: pageCount }, (_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === safe}
            aria-label={`${labels.pageAria} ${i + 1}`}
            className={`iss-pager-dot${i === safe ? " on" : ""}`}
            onClick={() => onChange(i)}
          />
        ))}
      </div>
      <span className="iss-pager-num muted sm">
        {safe + 1} / {pageCount}
      </span>
      <button
        type="button"
        className="btn line sm iss-pager-nav"
        disabled={safe >= pageCount - 1}
        onClick={() => onChange(safe + 1)}
        aria-label={labels.next}
      >
        {labels.next} <ChevronRight size={14} />
      </button>
    </div>
  );
}
