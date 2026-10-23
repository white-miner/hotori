/**
 * 현장·전화 생성 progressive 결제 UI (완납/후불/선금).
 * 간단 예약 · Entry create stay 공유 — Option A 원장(수정)과 별개.
 */
import type { ReactNode } from "react";
import { won } from "../shared/ledger";
import {
  BOOK_PAY_LABEL,
  BOOK_PAY_METHODS,
  ONSITE_PAY_MODE_LABEL,
  ONSITE_PAY_MODES,
  type BookPayMethod,
  type OnsitePayMode,
} from "../shared/payment";
import { Chip, ChipGroup, PriceInp, PriceRow } from "./primitives";

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
  /** chips만 / 수납만 / 둘 다 (기본 both) */
  part?: "chips" | "take" | "both";
  /** 결제 섹션 안 · 칩 위 (숙박 판매: 판매가 병합) */
  beforeChips?: ReactNode;
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
}: Props) {
  const chips = part === "chips" || part === "both";
  const take = part === "take" || part === "both";

  return (
    <>
      {chips ? (
        <div className="fld">
          <label>결제</label>
          <div>
            {beforeChips ? <div className="stay-sale-pay-price">{beforeChips}</div> : null}
            <ChipGroup>
              {ONSITE_PAY_MODES.map((k) => (
                <Chip key={k} active={payMode === k} onClick={() => onPayMode(k)}>
                  {ONSITE_PAY_MODE_LABEL[k]}
                </Chip>
              ))}
            </ChipGroup>
            {payMode === "postpaid" ? (
              <div className="muted sm" style={{ marginTop: "var(--space-chip)" }}>
                후불 · 퇴실(또는 나중에) 정산 · 결제 줄 없음
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

      {take && payMode === "prepaid" && !priceUnset ? (
        <div className="fld">
          <label>수납</label>
          <div className="muted sm">
            저장 시 판매금만큼 받기(완납)로 적어요 · 방법
            <ChipGroup style={{ display: "inline-flex", marginLeft: "var(--space-3)" }}>
              {BOOK_PAY_METHODS.map((m) => (
                <Chip key={m} sm active={depMethod === m} onClick={() => onDepMethod(m)}>
                  {BOOK_PAY_LABEL[m]}
                </Chip>
              ))}
            </ChipGroup>
          </div>
        </div>
      ) : null}

      {take && payMode === "deposit" && !priceUnset ? (
        <div className="fld">
          <label>받을 선금</label>
          <div>
            <div className="muted sm" style={{ marginBottom: "var(--space-chip)" }}>
              판매금과 별개 · 일부만 먼저 받을 때
            </div>
            <PriceRow>
              <PriceInp sm>
                <input
                  className="num"
                  inputMode="numeric"
                  aria-label="받을 선금"
                  placeholder="선금"
                  value={depAmt !== "" ? won(Number(depAmt)) : ""}
                  onChange={(e) => onDepAmt(e.target.value.replace(/\D/g, "").slice(0, 9))}
                />
              </PriceInp>
              <ChipGroup>
                {BOOK_PAY_METHODS.map((m) => (
                  <Chip key={m} sm active={depMethod === m} onClick={() => onDepMethod(m)}>
                    {BOOK_PAY_LABEL[m]}
                  </Chip>
                ))}
              </ChipGroup>
            </PriceRow>
          </div>
        </div>
      ) : null}
    </>
  );
}
