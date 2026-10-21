import { typeLabel } from "../shared/ledger";
import type { lookups } from "./ui";

type L = ReturnType<typeof lookups>;

/** 예약 타입 ≠ 방 타입일 때: 취소(빨강) / 승인(초록) */
export default function AssignTypeConfirm({
  L,
  bookedTypeId,
  roomTypeId,
  roomLabel,
  guestName,
  onCancel,
  onApprove,
}: {
  L: L;
  bookedTypeId: string | null | undefined;
  roomTypeId: string | null | undefined;
  roomLabel: string;
  guestName: string;
  onCancel: () => void;
  onApprove: () => void;
}) {
  const booked = typeLabel(L.types.get(bookedTypeId ?? "")) || "미정";
  const room = typeLabel(L.types.get(roomTypeId ?? "")) || "미정";
  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal assign-type-modal" role="dialog" aria-label="객실 타입 다름" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mh">
          <h2>객실 타입이 다릅니다</h2>
          <button type="button" className="x" aria-label="닫기" onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p>
            <b>{guestName}</b> 예약은 <b>{booked}</b>인데, 고른 방 <b>{roomLabel}</b>은(는) <b>{room}</b>이에요.
          </p>
          <p className="muted sm">그래도 배정할까요? (현장 오버라이드 · 재고는 방 타입 기준으로 맞춰져요)</p>
        </div>
        <div className="mf assign-type-acts">
          <button type="button" className="btn red" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="btn green" onClick={onApprove}>
            승인
          </button>
        </div>
      </div>
    </div>
  );
}
