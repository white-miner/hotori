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
  type TenderAmounts, BOOK_PAY_METHODS, BOOK_PAY_LABEL,
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
  tenders?: TenderAmounts | null;
  onTenders?: (v: TenderAmounts | null) => void;
  saleTotal?: number;
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
  tenders, onTenders, saleTotal = 0,
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
          <div className="tender-methods">
            {!tenders ? <BookPayMethodCircles value={depMethod} onChange={onDepMethod} disabled={disabled} /> : <span>카드 · 현금 · 이체 금액별 입력</span>}
            {onTenders ? <button type="button" className="btn sm line" aria-pressed={!!tenders} disabled={disabled} onClick={() => onTenders(tenders ? null : { [depMethod]: String(payMode === "deposit" ? Number(depAmt || 0) : saleTotal || "") })}>{tenders ? "단일결제로 전환" : "복합결제"}</button> : null}
          </div>
        </div>
      ) : null}

      {take && tenders && onTenders && payMode !== "postpaid" && !priceUnset ? <div className="fld"><label>수납 금액</label><div className="tender-fields">
        {BOOK_PAY_METHODS.map((m) => <div className="tender-row" key={m}><span>{BOOK_PAY_LABEL[m]}</span><PriceInp sm><input inputMode="numeric" className="num" aria-label={`${BOOK_PAY_LABEL[m]} 수납액`} disabled={disabled} placeholder="0" value={tenders[m] ? won(Number(tenders[m])) : ""} onChange={(e) => onTenders({ ...tenders, [m]: e.target.value.replace(/\D/g, "").slice(0, 9) })} /></PriceInp></div>)}
        <div className="tender-total" role="status">수납 합계 <b>{won(BOOK_PAY_METHODS.reduce((n, m) => n + Number(tenders[m] || 0), 0))}원</b><br />{saleTotal - BOOK_PAY_METHODS.reduce((n, m) => n + Number(tenders[m] || 0), 0) < 0 ? "초과 금액" : "등록 후 잔금"} <b>{won(Math.abs(saleTotal - BOOK_PAY_METHODS.reduce((n, m) => n + Number(tenders[m] || 0), 0)))}원</b></div>
        <span className="muted sm">실제로 받은 금액을 수단별로 기록합니다. 일부 수납은 선금을 선택해 주세요.</span>
      </div></div> : null}
      {take && !tenders && payMode === "prepaid" && !priceUnset ? (
        <div className="fld">
          <label>수납</label>
          <div className="muted sm">저장 시 판매금 전액을 수납(완납)으로 등록해요 · 위 결제수단 사용</div>
        </div>
      ) : null}

      {take && !tenders && payMode === "deposit" && !priceUnset ? (
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
