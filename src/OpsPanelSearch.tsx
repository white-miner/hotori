/**
 * 「현황」·「배치」운영/사이드 패널 공통 검색 입력.
 * 보드 guest-search와 같은 Lucide Search · Escape 지우기.
 */
import { Search, X } from "lucide-react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** 접근성 · placeholder */
  label?: string;
  placeholder?: string;
  id?: string;
}

export default function OpsPanelSearch({
  value,
  onChange,
  label = "목록 검색",
  placeholder = "이름·연락처·타입·플랫폼·예약번호",
  id,
}: Props) {
  return (
    <div className="ops-panel-search" role="search">
      <label className="search ls ops-panel-search-inp" htmlFor={id}>
        <Search size={15} strokeWidth={2.2} aria-hidden />
        <input
          id={id}
          value={value}
          placeholder={placeholder}
          aria-label={label}
          enterKeyHint="search"
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onChange("");
            }
          }}
        />
        {value ? (
          <button type="button" className="ops-panel-search-x" aria-label="검색 지우기" onClick={() => onChange("")}>
            <X size={14} strokeWidth={2.4} aria-hidden />
          </button>
        ) : null}
      </label>
    </div>
  );
}
