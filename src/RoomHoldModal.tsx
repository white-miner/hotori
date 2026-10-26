import { useEffect, useMemo, useState } from "react";
import { dayLabel, md } from "../shared/ledger";
import {
  ROOM_HOLD_CREATE_CTA,
  ROOM_HOLD_NOTE_CHIPS,
  ROOM_HOLD_NOTE_MAX,
  planRoomHold,
  type RoomHold,
} from "../shared/roomHold";
import { Chip, ChipGroup, Stepper } from "./primitives";

/**
 * 객실 임시마감 생성 — selection-first · 기간+선택 노트.
 * 해제(취소 마감)는 askConfirm 경로 (이 모달 아님).
 */
export default function RoomHoldModal({
  roomLabel,
  boardDate,
  holds,
  roomId,
  busy,
  onCancel,
  onConfirm,
}: {
  roomLabel: string;
  boardDate: string;
  holds: readonly RoomHold[];
  roomId: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (hold: RoomHold) => void;
}) {
  const [from, setFrom] = useState(boardDate);
  const [nights, setNights] = useState(1);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setFrom(boardDate);
    setNights(1);
    setNote("");
    setErr(null);
  }, [boardDate, roomId]);

  const planned = useMemo(
    () => planRoomHold(holds, { roomId, from, nights, note }),
    [holds, roomId, from, nights, note],
  );

  const summary =
    "ok" in planned
      ? planned.ok.from === planned.ok.to
        ? `${dayLabel(planned.ok.from)} · 1박`
        : `${md(planned.ok.from)}~${md(planned.ok.to)} · ${nights}박`
      : null;

  const submit = () => {
    if (busy) return;
    const next = planRoomHold(holds, { roomId, from, nights, note });
    if ("err" in next) {
      setErr(next.err);
      return;
    }
    setErr(null);
    onConfirm(next.ok);
  };

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="modal assign-type-modal add-time-modal"
        role="dialog"
        aria-label={ROOM_HOLD_CREATE_CTA}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>{ROOM_HOLD_CREATE_CTA}</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p>
            <b>{roomLabel}</b> · 예비·상담용 마감
          </p>
          <p className="muted sm">게스트 예약이 아니에요 · 타입 판매중지와 달라요</p>
          <div className="fld">
            <span className="muted sm">시작 숙박일</span>
            <input
              type="date"
              className="inp"
              value={from}
              disabled={busy}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="시작 숙박일"
            />
          </div>
          <div className="fld">
            <span className="muted sm">박수</span>
            <Stepper value={nights} unit="박" min={1} max={90} onChange={setNights} />
          </div>
          <div className="fld">
            <span className="muted sm">사유 (선택)</span>
            <ChipGroup>
              {ROOM_HOLD_NOTE_CHIPS.map((c) => (
                <Chip key={c} sm active={note === c} disabled={busy} onClick={() => setNote(note === c ? "" : c)}>
                  {c}
                </Chip>
              ))}
            </ChipGroup>
            <input
              className="inp"
              maxLength={ROOM_HOLD_NOTE_MAX}
              placeholder="상담중 · 예비…"
              value={note}
              disabled={busy}
              onChange={(e) => setNote(e.target.value.slice(0, ROOM_HOLD_NOTE_MAX))}
              aria-label="마감 사유"
            />
          </div>
          {summary ? <p className="muted sm">{summary}</p> : null}
          {err ? <p className="muted sm" style={{ color: "var(--badge-danger)" }}>{err}</p> : null}
        </div>
        <div className="mf">
          <button type="button" className="btn line" disabled={busy} onClick={onCancel}>
            닫기
          </button>
          <button type="button" className="btn stop" disabled={busy || "err" in planned} onClick={submit}>
            {busy ? "저장 중…" : ROOM_HOLD_CREATE_CTA}
          </button>
        </div>
      </div>
    </div>
  );
}
