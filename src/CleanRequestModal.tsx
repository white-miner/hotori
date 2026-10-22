import { Ban, Check } from "lucide-react";
import {
  CLEAN_REQUEST_OPTIONS,
  CLEAN_REQUEST_TITLE,
  type CleanRequestChoice,
} from "../shared/cleanRequest";

/**
 * 「현황」청소 요청: 청소 함 / 안 함 → 확정 시에만 noClean patch.
 */
export default function CleanRequestModal({
  guestName,
  roomLabel,
  currentNoClean,
  busy,
  onCancel,
  onConfirm,
}: {
  guestName: string;
  roomLabel: string;
  currentNoClean: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (choice: CleanRequestChoice) => void;
}) {
  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="modal assign-type-modal clean-request-modal"
        role="dialog"
        aria-label={CLEAN_REQUEST_TITLE}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>{CLEAN_REQUEST_TITLE}</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p>
            <b>{roomLabel}</b> · {guestName}
          </p>
          <p className="muted sm">지금: {currentNoClean ? "청소 안 함(청소X)" : "청소 함"}</p>
        </div>
        <div className="mf assign-type-acts clean-request-acts">
          {CLEAN_REQUEST_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`btn ${o.noClean ? "line" : "dark"}`}
              disabled={busy}
              autoFocus={!o.noClean}
              onClick={() => onConfirm(o.id)}
            >
              {o.noClean ? <Ban size={15} strokeWidth={2.2} aria-hidden /> : <Check size={15} strokeWidth={2.2} aria-hidden />}
              {busy ? "저장 중…" : o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
