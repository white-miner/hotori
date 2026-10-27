import { useMemo, useState } from "react";
import { type Booking, addDays, dayLabel, freeRooms, md, normalizeSegments, placementOf, won } from "../shared/ledger";
import { legCharges, moveDateRange, planScheduledMove, retargetLegRate } from "../shared/scheduledMove";
import { tableRows } from "../shared/nightTable";
import type { HotelData } from "./data";
import MiniFloorPlan, { type BuildingFilter } from "./MiniFloorPlan";
import RoomClashNote from "./RoomClashNote";
import { lookups } from "./ui";

/**
 * 객실 이동 예약 — "화요일에 입실한 511호 손님이 수요일에 608호로 옮기기로 했어요".
 *  ① 언제부터(이동일) ② 어느 객실로(어떤 호실이든) → 한 번 눌러 예약.
 *  예약은 하나로 이어지고 이동일부터 남은 밤만 새 객실 구간이 돼요. 결제·미수금은 그대로예요.
 *  겹치면 막지 않고 알려 줘요 (빈 방으로 바꾸기 · 퇴실 처리 한 번에).
 */
export default function MoveScheduleSheet({
  data,
  today,
  booking,
  onClose,
  onSaved,
}: {
  data: HotelData;
  today: string;
  booking: Booking;
  onClose: () => void;
  onSaved: (msg: string, undo?: () => void) => void;
}) {
  const s = data.hotel!.settings;
  const L = useMemo(() => lookups(s), [s]);
  const range = moveDateRange(booking);
  const first = range ? (range.min > today ? range.min : addDays(today, 1) > range.max ? range.min : addDays(today, 1)) : today;
  const [date, setDate] = useState(first);
  const [to, setTo] = useState<string>("");
  const [bf, setBf] = useState<BuildingFilter>("all");
  const [rateOn, setRateOn] = useState(false);
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const n = booking.nights ?? 0;
  const nightChoices = useMemo(() => {
    if (!range) return [];
    const out: string[] = [];
    for (let d = range.min; d <= range.max; d = addDays(d, 1)) out.push(d);
    return out;
  }, [range?.min, range?.max]);
  const remaining = range && date >= range.min && date <= range.max ? n - (nightChoices.indexOf(date) + 1) : 0;
  const probe = { id: booking.id, kind: "stay" as const, checkIn: date, nights: Math.max(1, remaining), startTime: null, endTime: null };
  const free = useMemo(() => freeRooms(s, data.bookings, probe), [s, data.bookings, date, remaining]);
  const plan = to ? planScheduledMove(s, data.bookings, booking, date, to, today) : null;
  const rows = tableRows(booking.checkIn, n, booking.nightRates ?? null, n ? Math.round(booking.price / n) : 0);
  const avgMoved = remaining ? Math.round(rows.filter((r) => r.date >= date).reduce((x, r) => x + r.amount, 0) / remaining) : 0;
  const perNight = rateOn && rate ? Number(rate.replace(/\D/g, "")) || null : null;
  const retarget = perNight != null && perNight !== avgMoved ? retargetLegRate(booking, date, perNight) : null;
  const preview = plan?.ok
    ? legCharges({ ...booking, segments: plan.segments, price: retarget?.price ?? booking.price, nightRates: retarget?.nightRates ?? booking.nightRates })
    : null;

  if (!range) {
    return (
      <div className="dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" role="dialog" aria-label="객실 이동 예약" onMouseDown={(e) => e.stopPropagation()}>
          <div className="mh">
            <h2>객실 이동 예약</h2>
            <button type="button" className="x" aria-label="닫기" onClick={onClose}>
              닫기
            </button>
          </div>
          <div className="mb">
            <p>2박 이상 묵는 예약만 중간에 옮길 수 있어요. 1박이면 「객실 이동」을 써 주세요.</p>
          </div>
        </div>
      </div>
    );
  }

  const save = async () => {
    if (!plan || !plan.ok || busy) {
      setErr(plan && !plan.ok ? plan.reason : "옮길 객실을 골라 주세요");
      return;
    }
    setBusy(true);
    setErr(null);
    const before = placementOf(booking);
    const beforeRates = { nightRates: booking.nightRates ?? null, price: booking.price };
    try {
      await data.setPlacement(booking.id, { roomId: plan.segments[0]!.roomId, segments: normalizeSegments(plan.segments) });
      if (retarget) await data.patchBooking(booking.id, { nightRates: retarget.nightRates, price: retarget.price });
      const fromNo = L.roomLabel(plan.fromRoomId) ?? "";
      const toNo = L.roomLabel(plan.toRoomId) ?? "";
      void data.logChange({
        kind: "room",
        summary: `객실 이동 예약 · ${fromNo}호 → ${toNo}호 (${md(plan.moveDate)}부터 ${plan.nightsMoved}박)${retarget ? ` · 이동 후 1박 ${won(perNight ?? 0)}원` : ""}`,
        groupId: booking.groupId ?? null,
        bookingId: booking.groupId ? null : booking.id,
        effectiveOn: plan.moveDate,
      });
      onSaved(`${md(plan.moveDate)} ${toNo}호로 이동을 예약했어요`, () => {
        void (async () => {
          await data.setPlacement(booking.id, before);
          if (retarget) await data.patchBooking(booking.id, beforeRates);
        })();
      });
    } catch {
      setErr("예약하지 못했어요. 다시 눌러 주세요.");
      setBusy(false);
    }
  };

  return (
    <div className="dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal mvs" role="dialog" aria-label="객실 이동 예약" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mh">
          <h2>객실 이동 예약</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p>
            <b>{L.roomLabel(booking.roomId)}호</b> · {booking.guestName} · {dayLabel(booking.checkIn)} 입실 {n}박
          </p>
          <div className="mvs-step">
            <div className="mvs-k">① 언제 옮기나요</div>
            <div className="mvs-dates" role="group" aria-label="이동일">
              {nightChoices.map((d) => (
                <button key={d} type="button" className={`chip${d === date ? " on" : ""}`} aria-pressed={d === date} onClick={() => setDate(d)}>
                  {dayLabel(d)}
                </button>
              ))}
            </div>
            <p className="muted sm">
              {md(date)}부터 퇴실까지 {remaining}박이 새 객실이에요 · 그 전 밤은 지금 객실 그대로
            </p>
          </div>
          <div className="mvs-step">
            <div className="mvs-k">② 어느 객실로 옮기나요 {to ? <b>· {L.roomLabel(to)}호</b> : null}</div>
            <MiniFloorPlan s={s} L={L} free={free} selectedIds={to ? [to] : []} buildingFilter={bf} onBuildingFilter={setBf} onToggle={(id) => setTo((cur) => (cur === id ? "" : id))} allowBusy />
            {to ? (
              <RoomClashNote
                data={data}
                today={today}
                picked={[to]}
                checkIn={date}
                nights={Math.max(1, remaining)}
                excludeIds={new Set([booking.id])}
                onSwap={(_from, next) => setTo(next)}
              />
            ) : null}
          </div>
          {plan && !plan.ok ? <div className="ferr">{plan.reason}</div> : null}
          {preview ? (
            <ul className="mvs-legs" aria-label="이동 후 구간">
              {preview.map((l) => (
                <li key={`${l.roomId}${l.checkIn}`}>
                  <b>{L.roomLabel(l.roomId)}호</b> {md(l.checkIn)}~{md(addDays(l.checkIn, l.nights))} · {l.nights}박 · {won(l.amount)}원
                </li>
              ))}
              <li className="muted sm">결제·미수금은 그대로 · 총액 {won(retarget?.price ?? booking.price)}원</li>
            </ul>
          ) : null}
          <details className="adv" onToggle={(e) => setRateOn(e.currentTarget.open)}>
            <summary>이동 후 요금 바꾸기 (선택)</summary>
            <div className="mvs-rate">
              <label>
                <span>{md(date)}부터 1박</span>
                <input className="num" inputMode="numeric" aria-label="이동 후 1박 요금" placeholder={won(avgMoved)} value={rate ? won(Number(rate.replace(/\D/g, ""))) : ""} onChange={(e) => setRate(e.target.value.replace(/\D/g, "").slice(0, 9))} />
                <span>원</span>
              </label>
              <p className="muted sm">비워 두면 지금 요금(1박 {won(avgMoved)}원)이 그대로 따라가요</p>
            </div>
          </details>
          {err ? <div className="ferr">{err}</div> : null}
        </div>
        <div className="mf">
          <button type="button" className="btn dark lg" disabled={busy || !plan?.ok} onClick={() => void save()}>
            {busy ? "예약 중…" : plan?.ok ? `${md(date)} ${L.roomLabel(to)}호로 이동 예약` : "객실을 골라 주세요"}
          </button>
        </div>
      </div>
    </div>
  );
}
