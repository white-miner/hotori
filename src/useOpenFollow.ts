import { useEffect, useRef } from "react";
import { extendSummary } from "../shared/changes";
import { type Booking } from "../shared/ledger";
import { planOpenFollow } from "../shared/extend";
import { lookups } from "./ui";
import type { HotelData } from "./data";
import type { ToastOpt } from "./App";

/**
 * 열린 숙박 자동 따라가기: 앱이 열려 있고 업무일(6시 컷)이 바뀌면, 입실 중인 열린 숙박의 박수를
 * "오늘 밤 + 방 보호 버퍼"까지 절대값으로 맞춰요. 여러 번·여러 사람이 실행해도 결과가 같아요.
 * 다른 예약과 겹치면 건드리지 않고 확인 필요(T12)가 알려 줘요. 결제는 따로예요.
 */
export function useOpenFollow(data: HotelData, today: string, notify: (m: string, o?: ToastOpt) => void, enabled: boolean) {
  const tried = useRef(new Set<string>());
  const busy = useRef(false);
  const dref = useRef(data);
  dref.current = data;
  useEffect(() => {
    const settings = data.hotel?.settings;
    if (!enabled || !settings || !data.syncedAt || busy.current) return;
    const list = data.bookings;
    const todo = list
      .map((b) => ({ b, f: planOpenFollow(b, list, today) }))
      .filter((x): x is { b: Booking; f: NonNullable<typeof x.f> } => !!x.f && !tried.current.has(`${x.b.id}|${today}|${x.b.nights}`));
    if (!todo.length) return;
    busy.current = true;
    const L = lookups(settings);
    void (async () => {
      const done: Booking[] = [];
      try {
        for (const { b, f } of todo) {
          tried.current.add(`${b.id}|${today}|${b.nights}`);
          try {
            await dref.current.saveBooking(
              { ...b, nights: f.plan.draft.nights, price: f.plan.draft.price, segments: f.plan.draft.segments, nightRates: f.plan.draft.nightRates ?? b.nightRates ?? null },
              false,
            );
            done.push(b);
            void dref.current.logChange({
              kind: "stay",
              groupId: b.groupId ?? null,
              bookingId: b.id,
              effectiveOn: f.plan.checkOut,
              summary: `${extendSummary({ roomNo: (b.roomId ? L.roomLabel(b.roomId) : "") ?? "?", fromNights: b.nights ?? 0, toNights: f.plan.draft.nights, throughDate: today })} · 열린 숙박 자동`,
            });
          } catch {
            /* 이 예약만 건너뛰어요. 다음에 앱을 열면 다시 시도해요 */
          }
        }
      } finally {
        busy.current = false;
      }
      if (done.length)
        notify(`열린 숙박 ${done.length}건을 오늘 밤까지 이어 놓았어요 · 결제는 결제 등록에서`, {
          ms: 9000,
          action: { label: "되돌리기", run: () => void Promise.all(done.map((b) => dref.current.saveBooking(b, false))) },
        });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.bookings, data.syncedAt, data.hotel?.settings, today, enabled]);
}
