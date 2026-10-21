import { useMemo, useState } from "react";
import { ArrowRightLeft, Ban, Layers } from "lucide-react";
import {
  type Booking,
  type HotelSettings,
  assignableRooms,
  freeRooms,
  typeLabel,
} from "../shared/ledger";
import { nowNightRange } from "../shared/nowboard";
import type { lookups } from "./ui";

type L = ReturnType<typeof lookups>;
type Step = "choice" | "relocate";

function occupiedNightLabel(b: Booking): string {
  return nowNightRange(b).label;
}

/**
 * 퇴실처리된 숙박과만 겹칠 때: 덮어쓰기 · 퇴실 숙박 이동 · 취소.
 * 활성 투숙 겹침은 이 모달을 열지 않음 (하드 차단).
 */
export default function AssignCheckoutChoice({
  s,
  L,
  multi,
  booking,
  roomId,
  overlaps,
  bookings,
  busy,
  onCancel,
  onOverwrite,
  onRelocate,
}: {
  s: HotelSettings;
  L: L;
  multi: boolean;
  booking: Booking;
  roomId: string;
  overlaps: Booking[];
  bookings: Booking[];
  busy?: boolean;
  onCancel: () => void;
  onOverwrite: () => void;
  /** relocateTo = 방 id 또는 null(미배정) */
  onRelocate: (relocateTo: string | null) => void;
}) {
  const [step, setStep] = useState<Step>("choice");
  const roomLabel = L.roomLabel(roomId) ?? roomId;
  const primary = overlaps[0];
  const extra = overlaps.length > 1 ? overlaps.length - 1 : 0;

  const relocateFree = useMemo(() => {
    if (!primary) return new Set<string>();
    const free = freeRooms(s, bookings, primary);
    free.delete(roomId);
    return free;
  }, [s, bookings, primary, roomId]);

  const relocateRooms = useMemo(
    () => (primary ? assignableRooms(s, relocateFree, primary.typeId) : []),
    [s, relocateFree, primary],
  );

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="modal assign-type-modal assign-co-modal"
        role="dialog"
        aria-label={step === "choice" ? "퇴실 숙박과 겹침" : "퇴실 숙박 이동"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>{step === "choice" ? "퇴실 처리된 숙박이 있어요" : "퇴실 숙박을 어디로 옮길까요"}</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          {step === "choice" ? (
            <>
              <p>
                <b>{roomLabel}</b>호에 퇴실 완료된 <b>{primary?.guestName ?? "손님"}</b>
                {extra ? ` 외 ${extra}건` : ""} ({occupiedNightLabel(primary ?? booking)})이(가) 장부에 남아 있어요.
              </p>
              <p>
                새로 배정: <b>{booking.guestName}</b> · {occupiedNightLabel(booking)}
              </p>
              <p className="muted sm">
                덮어쓰면 옛 숙박은 장부·결제 그대로 두고 방만 새 손님에게 씁니다. 잘못 배정된 퇴실 건이면 다른 방·미배정으로 옮길 수 있어요.
              </p>
            </>
          ) : (
            <>
              <p>
                <b>{primary?.guestName ?? "손님"}</b> ({occupiedNightLabel(primary ?? booking)})을(를) 옮긴 뒤{" "}
                <b>{booking.guestName}</b> 님을 <b>{roomLabel}</b>호에 배정해요.
              </p>
              <p className="muted sm">활성 투숙이 있는 방은 고를 수 없어요 · 본관·별관 한 목록</p>
              <div className="rpick assign-co-relocate">
                <button type="button" className="rchip" disabled={busy} onClick={() => onRelocate(null)}>
                  미배정
                </button>
                {relocateRooms.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`rchip ${r.typeId !== primary?.typeId ? "other" : ""}`}
                    disabled={busy}
                    title={L.roomLabel(r.id) ?? r.no}
                    onClick={() => onRelocate(r.id)}
                  >
                    {multi ? <em className="bpre">{L.buildings.get(r.buildingId)?.name ?? ""}</em> : null}
                    {r.no}
                    {r.typeId !== primary?.typeId ? <i>{typeLabel(L.types.get(r.typeId ?? ""))}</i> : null}
                  </button>
                ))}
                {!relocateRooms.length ? (
                  <span className="muted sm">옮길 빈 방이 없어요 · 미배정을 고르거나 취소하세요</span>
                ) : null}
              </div>
            </>
          )}
        </div>
        {step === "choice" ? (
          <div className="mf assign-co-acts">
            <button type="button" className="btn red" disabled={busy} onClick={onCancel}>
              <Ban size={15} strokeWidth={2.2} aria-hidden />
              취소
            </button>
            <button type="button" className="btn line" disabled={busy || !primary} onClick={() => setStep("relocate")}>
              <ArrowRightLeft size={15} strokeWidth={2.2} aria-hidden />
              퇴실 숙박 이동
            </button>
            <button type="button" className="btn green" disabled={busy} onClick={onOverwrite} autoFocus>
              <Layers size={15} strokeWidth={2.2} aria-hidden />
              덮어쓰기
            </button>
          </div>
        ) : (
          <div className="mf assign-co-acts">
            <button type="button" className="btn red" disabled={busy} onClick={onCancel}>
              취소
            </button>
            <button type="button" className="btn line" disabled={busy} onClick={() => setStep("choice")}>
              뒤로
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
