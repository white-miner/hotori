import { Ban, Check } from "lucide-react";

/**
 * 대실 구간이 당일 숙박 입실/점유와 겹칠 때.
 * 취소(빨강) · 계속(초록) — 방배정 타입 경고와 동일 톤.
 */
export default function DayuseStayOverlapConfirm({
  message,
  busy,
  onCancel,
  onContinue,
}: {
  message: string;
  busy?: boolean;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="modal assign-type-modal"
        role="dialog"
        aria-label="대실·숙박 겹침"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>대실 시간이 겹칩니다</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p>{message}</p>
        </div>
        <div className="mf assign-type-acts">
          <button type="button" className="btn red" disabled={busy} onClick={onCancel}>
            <Ban size={15} strokeWidth={2.2} aria-hidden />
            취소
          </button>
          <button type="button" className="btn green" disabled={busy} onClick={onContinue} autoFocus>
            <Check size={15} strokeWidth={2.2} aria-hidden />
            {busy ? "저장 중…" : "계속"}
          </button>
        </div>
      </div>
    </div>
  );
}
