import { Ban, Check } from "lucide-react";
import { type Booking, dayLabel } from "../shared/ledger";
import { EXTEND_OVERLAP_TITLE } from "../shared/extend";

/**
 * 1박연장으로 새 밤이 다른 활성 예약과 겹칠 때.
 * 취소(빨강)=연장 안 함 · 승인(초록)=현장 판단으로 연장 저장. 침묵 연장 금지.
 */
export default function ExtendOverlapConfirm({
  extraNight,
  others,
  roomLabel,
  busy,
  onCancel,
  onApprove,
}: {
  extraNight: string;
  others: Booking[];
  roomLabel: string | null;
  busy?: boolean;
  onCancel: () => void;
  onApprove: () => void;
}) {
  const names = others.map((o) => o.guestName || "손님").join(", ");
  const when = dayLabel(extraNight);
  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="modal assign-type-modal"
        role="dialog"
        aria-label={EXTEND_OVERLAP_TITLE}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>{EXTEND_OVERLAP_TITLE}</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p>
            {when}
            {roomLabel ? ` · ${roomLabel}호` : ""}에 이미 <b>{names}</b> 예약이 있어요.
          </p>
          <p className="muted sm">퇴실 없이 연장하면 겹칩니다. 그래도 연장할까요? (현장 오버부킹 허용)</p>
        </div>
        <div className="mf assign-type-acts">
          <button type="button" className="btn red" disabled={busy} onClick={onCancel}>
            <Ban size={15} strokeWidth={2.2} aria-hidden />
            취소
          </button>
          <button type="button" className="btn green" disabled={busy} onClick={onApprove} autoFocus>
            <Check size={15} strokeWidth={2.2} aria-hidden />
            {busy ? "저장 중…" : "승인"}
          </button>
        </div>
      </div>
    </div>
  );
}
