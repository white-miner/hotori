/**
 * 현장·전화 생성 progressive 결제 UI (완납/후불/선금).
 * 간단 예약 · Entry create stay 공유 — Option A 원장(수정)과 별개.
 *
 * 잠금 순서: 완납/후불/선금(칩) → 결제수단(원형) → 판매금 → 수납/선금(수단 중복 없음).
 * 수단은 `part="method"` · 동일 `depMethod` 바인딩.
 */
import type { ReactNode } from "react";
import { won } from "../shared/ledger";
import {
  ONSITE_PAY_MODE_LABEL,
  ONSITE_PAY_MODES,
  type BookPayMethod,
  type OnsitePayMode,
} from "../shared/payment";
import { BookPayMethodCircles, Chip, ChipGroup, PriceInp, PriceRow } from "./primitives";

export type { OnsitePayMode };

interface Props {
  payMode: OnsitePayMode;
  onPayMode: (m: OnsitePayMode) => void;
  depAmt: string;
  onDepAmt: (v: string) => void;
  depMethod: BookPayMethod;
  onDepMethod: (m: BookPayMethod) => void;
  /** 금액미정이면 수납 줄 숨김 (간단) */
  priceUnset?: boolean;
  /** chips / method / take / both(=chips+method+take) */
  part?: "chips" | "method" | "take" | "both";
  /** 결제 섹션 안 · 칩 위 (숙박 판매: 판매가 병합 — 레거시; 새 화면은 method→금액 분리 권장) */
  beforeChips?: ReactNode;
  disabled?: boolean;
}

export default function OnsitePayModeFields({
  payMode,
  onPayMode,
  depAmt,
  onDepAmt,
  depMethod,
  onDepMethod,
  priceUnset = false,
  part = "both",
  beforeChips,
  disabled = false,
}: Props) {
  const chips = part === "chips" || part === "both";
  const method = part === "method" || part === "both";
  const take = part === "take" || part === "both";
  const showMethod = method && !priceUnset && payMode !== "postpaid";

  return (
    <>
      {chips ? (
        <div className="fld">
          <label>결제</label>
          <div>
            {beforeChips ? <div className="stay-sale-pay-price">{beforeChips}</div> : null}
            <ChipGroup>
              {ONSITE_PAY_MODES.map((k) => (
                <Chip key={k} active={payMode === k} disabled={disabled} onClick={() => onPayMode(k)}>
                  {ONSITE_PAY_MODE_LABEL[k]}
                </Chip>
              ))}
            </ChipGroup>
            {payMode === "postpaid" ? (
              <div className="muted sm" style={{ marginTop: "var(--space-chip)" }}>
                후불 · 퇴실(또는 나중에) 정산 · 결제 내역 없음
              </div>
            ) : null}
            {priceUnset ? (
              <div className="muted sm" style={{ marginTop: "var(--space-chip)" }}>
                금액미정 · 수납은 확정 후 Entry에서
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {showMethod ? (
        <div className="fld">
          <label>결제수단</label>
          <BookPayMethodCircles value={depMethod} onChange={onDepMethod} disabled={disabled} />
        </div>
      ) : null}

      {take && payMode === "prepaid" && !priceUnset ? (
        <div className="fld">
          <label>수납</label>
          <div className="muted sm">저장 시 판매금 전액을 수납(완납)으로 등록해요 · 위 결제수단 사용</div>
        </div>
      ) : null}

      {take && payMode === "deposit" && !priceUnset ? (
        <div className="fld">
          <label>선금 금액</label>
          <div>
            <div className="muted sm" style={{ marginBottom: "var(--space-chip)" }}>
              판매금과 별개 · 일부만 먼저 수납할 때 · 위 결제수단 사용
            </div>
            <PriceRow>
              <PriceInp sm>
                <input
                  className="num"
                  inputMode="numeric"
                  aria-label="선금 금액"
                  placeholder="선금"
                  disabled={disabled}
                  value={depAmt !== "" ? won(Number(depAmt)) : ""}
                  onChange={(e) => onDepAmt(e.target.value.replace(/\D/g, "").slice(0, 9))}
                />
              </PriceInp>
            </PriceRow>
          </div>
        </div>
      ) : null}
    </>
  );
}
