import { useMemo, useState } from "react";
import { type Booking, type HotelSettings, dayLabel, stayEnd, won } from "../shared/ledger";
import {
  CONNECT_ALIGN_WARN,
  CONNECT_STAY_COPY,
  CONNECT_STAY_TITLE,
  type ConnectCandidate,
  connectSummaryLine,
  listConnectCandidates,
  planConnect,
} from "../shared/succeedStay";
import { nowFlags } from "../shared/nowboard";

/**
 * 「현황」운영 · 이 투숙에 연결 — 미배정/연속 B를 prior A에 succeed.
 * selection-first · MiniFloorPlan 금지 · 결제 합치기 없음.
 */
export default function ConnectStayModal({
  today,
  s,
  prior,
  bookings,
  roomLabel,
  busy,
  nowOpts,
  onCancel,
  onConfirm,
}: {
  today: string;
  s: HotelSettings;
  prior: Booking;
  bookings: Booking[];
  roomLabel: string;
  busy?: boolean;
  nowOpts?: Parameters<typeof nowFlags>[2];
  onCancel: () => void;
  onConfirm: (next: Booking, opts: { alignCheckIn: boolean }) => void;
}) {
  const candidates = useMemo(() => listConnectCandidates(prior, bookings), [prior, bookings]);
  const [pickId, setPickId] = useState<string | null>(candidates[0]?.booking.id ?? null);
  const [err, setErr] = useState<string | null>(null);

  const picked: ConnectCandidate | null = candidates.find((c) => c.booking.id === pickId) ?? null;

  const preview = useMemo(() => {
    if (!picked) return null;
    return planConnect(s, bookings, prior, picked.booking, {
      alignCheckIn: !picked.continuous,
      today,
      nowOpts,
    });
  }, [picked, s, bookings, prior, today, nowOpts]);

  const submit = () => {
    if (busy || !picked) return;
    const align = !picked.continuous;
    const planned = planConnect(s, bookings, prior, picked.booking, {
      alignCheckIn: align,
      today,
      nowOpts,
    });
    if ("err" in planned) {
      setErr(planned.err);
      return;
    }
    setErr(null);
    onConfirm(picked.booking, { alignCheckIn: align });
  };

  const priorEnd = stayEnd(prior);

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="modal assign-type-modal add-time-modal connect-stay-modal"
        role="dialog"
        aria-label={CONNECT_STAY_TITLE}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>{CONNECT_STAY_TITLE}</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p>
            <b>{roomLabel}</b> · {prior.guestName} · {dayLabel(prior.checkIn)}~
            {dayLabel(priorEnd)} 퇴실
          </p>
          <p className="muted sm">다른 이름 예약을 같은 호실·연속 연박으로 연결해요 · 결제·예약번호는 각각 유지</p>

          {!candidates.length ? (
            <p className="ferr">연결할 숙박 예약이 없어요. 미배정(스마트 등록·간단 예약)을 먼저 올려 주세요.</p>
          ) : (
            <ul className="connect-stay-list" role="listbox" aria-label="연결할 예약">
              {candidates.map((c) => {
                const b = c.booking;
                const on = pickId === b.id;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      className={`connect-stay-row${on ? " on" : ""}`}
                      role="option"
                      aria-selected={on}
                      disabled={busy}
                      onClick={() => {
                        setPickId(b.id);
                        setErr(null);
                      }}
                    >
                      <span className="connect-stay-name">{b.guestName}</span>
                      <span className="connect-stay-meta muted">
                        {dayLabel(b.checkIn)} · {b.nights}박
                        {b.priceUnset ? "" : ` · ${won(b.price)}`}
                        {c.unassigned ? " · 미배정" : b.roomId ? " · 배정됨" : ""}
                        {c.continuous ? " · 연속" : " · 입실일 맞춤 필요"}
                        {c.relink ? " · 재연결" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {picked && !picked.continuous ? <p className="muted sm">{CONNECT_ALIGN_WARN}</p> : null}
          {picked && preview && !("err" in preview) ? (
            <p className="add-time-sum">{connectSummaryLine(prior, preview.draft.next)}</p>
          ) : null}
          {picked && preview && "err" in preview && preview.err !== CONNECT_ALIGN_WARN ? (
            <div className="ferr">{preview.err}</div>
          ) : null}
          {err ? <div className="ferr">{err}</div> : null}
        </div>
        <div className="mf assign-type-acts">
          <button type="button" className="btn line" disabled={busy} onClick={onCancel}>
            취소
          </button>
          <button
            type="button"
            className="btn dark"
            disabled={busy || !picked}
            onClick={submit}
            autoFocus
          >
            {busy ? "연결 중…" : CONNECT_STAY_COPY}
          </button>
        </div>
      </div>
    </div>
  );
}
