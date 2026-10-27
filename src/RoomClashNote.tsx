import { useMemo, useState } from "react";
import { md } from "../shared/ledger";
import { clashLine, roomClashes, suggestFreeRoom } from "../shared/roomClash";
import type { HotelData } from "./data";
import { lookups } from "./ui";

/**
 * 고른 방이 다른 예약과 겹칠 때 — 막지 않고 알려 주고, 한 번에 풀 수 있는 길을 보여요.
 *  · 빈 방으로 바꾸기 (같은 타입 · 같은 층 먼저)
 *  · 퇴실 처리 (날짜가 지났는데 퇴실처리가 안 된 예약)
 *  · 그대로 두기 (겹쳐도 저장 — 확인 필요 함에서 다시 볼 수 있어요)
 */
export default function RoomClashNote({
  data,
  today,
  picked,
  checkIn,
  nights,
  excludeIds,
  onSwap,
}: {
  data: HotelData;
  today: string;
  picked: string[];
  checkIn: string;
  nights: number;
  /** 같은 단체 안에서 이미 빠지는 예약(수정 중인 줄)은 겹침에서 빼요 */
  excludeIds?: ReadonlySet<string>;
  onSwap: (from: string, to: string) => void;
}) {
  const s = data.hotel!.settings;
  const L = useMemo(() => lookups(s), [s]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rows = picked
    .map((id) => ({ id, clashes: roomClashes(s, data.bookings, id, checkIn, nights, today, excludeIds) }))
    .filter((r) => r.clashes.length);
  if (!rows.length) return null;
  const checkout = async (bookingId: string) => {
    setBusyId(bookingId);
    setErr(null);
    try {
      await data.patchBooking(bookingId, { checkedOutAt: new Date().toISOString(), arrived: true });
    } catch {
      setErr("퇴실 처리하지 못했어요. 다시 눌러 주세요.");
    } finally {
      setBusyId(null);
    }
  };
  return (
    <div className="rcn" role="status" aria-label="겹치는 예약 안내">
      <div className="rcn-h">겹치는 예약이 있어요 · 그대로 추가해도 돼요</div>
      {rows.map((r) => {
        const alt = suggestFreeRoom(s, data.bookings, r.id, checkIn, nights, new Set(picked));
        return (
          <div className="rcn-r" key={r.id}>
            <b>{L.roomLabel(r.id)}호</b>
            <ul>
              {r.clashes.map((c, i) => (
                <li key={`${c.bookingId ?? "h"}${i}`}>
                  <span>{clashLine(c, md)}</span>
                  {c.stale && c.bookingId ? (
                    <button type="button" className="chip sm" disabled={busyId === c.bookingId} onClick={() => void checkout(c.bookingId!)}>
                      {busyId === c.bookingId ? "처리 중…" : "퇴실 처리"}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {alt ? (
              <button type="button" className="chip sm" onClick={() => onSwap(r.id, alt)}>
                {L.roomLabel(alt)}호(빈 방)로 바꾸기
              </button>
            ) : null}
          </div>
        );
      })}
      {err ? <div className="ferr">{err}</div> : null}
    </div>
  );
}
