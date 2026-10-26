/**
 * 결제수단 원형 버튼 — 카드 · 현금 · 이체.
 * Entry / 간단 / StaySale / Option A 수납이 한 컨트롤을 공유.
 */
import {
  BOOK_PAY_LABEL,
  BOOK_PAY_METHODS,
  type BookPayMethod,
} from "../../shared/payment";

type Props = {
  value: BookPayMethod;
  onChange: (m: BookPayMethod) => void;
  disabled?: boolean;
  /** 접근성 그룹 라벨 */
  "aria-label"?: string;
  className?: string;
};

export function BookPayMethodCircles({
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel = "결제수단",
  className,
}: Props) {
  const cls = ["pay-method-circles", className].filter(Boolean).join(" ");
  return (
    <div className={cls} role="group" aria-label={ariaLabel}>
      {BOOK_PAY_METHODS.map((m) => (
        <button
          type="button"
          key={m}
          className={`pay-method-circle${value === m ? " on" : ""}`}
          aria-pressed={value === m}
          disabled={disabled}
          onClick={() => onChange(m)}
        >
          {BOOK_PAY_LABEL[m]}
        </button>
      ))}
    </div>
  );
}
