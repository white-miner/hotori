import { ArrowRightLeft, Ban } from "lucide-react";
import { type RoomSwapPlan } from "../shared/ledger";
import { nowNightRange } from "../shared/nowboard";
import type { lookups } from "./ui";

type L = ReturnType<typeof lookups>;

/**
 * 활성 투숙끼리 방 맞교환 확인.
 * 맞교환(초록) · 취소(빨강). silent swap 금지.
 * 이타입은 호출측에서 AssignTypeConfirm 체인.
 */
export default function AssignSwapConfirm({
  L,
  plan,
  busy,
  onCancel,
  onConfirm,
}: {
  L: L;
  plan: RoomSwapPlan;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { a, b, fromRoomId, toRoomId } = plan;
  const fromLabel = L.roomLabel(fromRoomId) ?? fromRoomId;
  const toLabel = L.roomLabel(toRoomId) ?? toRoomId;

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="modal assign-type-modal assign-swap-modal"
        role="dialog"
        aria-label="객실 맞교환"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>객실을 맞교환할까요</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p>
            <b>{a.guestName || "손님"}</b> · {fromLabel}호 · {nowNightRange(a).label}
            <br />
            <span className="muted sm">↔</span>
            <br />
            <b>{b.guestName || "손님"}</b> · {toLabel}호 · {nowNightRange(b).label}
          </p>
          <p>
            맞교환 후: <b>{a.guestName || "손님"}</b> → <b>{toLabel}</b>호 · <b>{b.guestName || "손님"}</b> → <b>{fromLabel}</b>호
          </p>
        </div>
        <div className="mf assign-type-acts">
          <button type="button" className="btn red" disabled={busy} onClick={onCancel}>
            <Ban size={15} strokeWidth={2.2} aria-hidden />
            취소
          </button>
          <button type="button" className="btn green" disabled={busy} onClick={onConfirm} autoFocus>
            <ArrowRightLeft size={15} strokeWidth={2.2} aria-hidden />
            {busy ? "맞교환 중…" : "맞교환"}
          </button>
        </div>
      </div>
    </div>
  );
}
