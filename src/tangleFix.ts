import type { Booking } from "../shared/ledger";
import { nightRatesFromTotal } from "../shared/nightrates";
import type { Tangle } from "../shared/tangles";
import type { HotelData } from "./data";
import type { ToastOpt } from "./App";

type Notify = (m: string, opt?: ToastOpt) => void;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const won = (n: number) => n.toLocaleString("ko-KR");
/** 퇴실일 11:00 (KST) — 그날 퇴실한 것으로 기록 */
const outAt = (date: string) => new Date(`${date}T11:00:00+09:00`).toISOString();

/** 확인 필요의 고치기 한 번 — 되돌릴 수 있는 것은 알림에 되돌리기를 붙여요. open이면 false(호출 쪽에서 예약 열기) */
export async function applyTangleFix(
  data: HotelData,
  t: Tangle,
  bookings: readonly Booking[],
  label: (id: string | null | undefined) => string,
  notify: Notify,
): Promise<boolean> {
  const fix = t.fix;
  const b = bookings.find((x) => x.id === t.ids[0]);
  if (!fix || fix.kind === "open" || !b) return false;
  const room = b.roomId ? `${label(b.roomId)}호 ` : "";
  if (fix.kind === "checkout") {
    await data.patchBooking(b.id, { checkedOutAt: outAt(fix.date) });
    void data.logChange({ kind: "stay", bookingId: b.id, groupId: b.groupId ?? null, effectiveOn: fix.date, summary: `${room}${md(fix.date)} 퇴실로 처리 (확인 필요)` });
    notify(`${room}${md(fix.date)} 퇴실로 처리했어요`, {
      ms: 7000,
      action: { label: "되돌리기", run: () => void data.patchBooking(b.id, { checkedOutAt: null }) },
    });
    return true;
  }
  const before = b;
  await data.saveBooking({ ...b, price: fix.total, nightRates: nightRatesFromTotal(b.checkIn, b.nights ?? 1, fix.total) }, false);
  void data.logChange({ kind: "rate", bookingId: b.id, groupId: b.groupId ?? null, summary: `${room}총액 ${won(b.price)}원 → ${won(fix.total)}원 (확인 필요)` });
  notify(`${room}총액을 ${won(fix.total)}원으로 고쳤어요`, {
    ms: 7000,
    action: { label: "되돌리기", run: () => void data.saveBooking(before, false) },
  });
  return true;
}

/** 퇴실 미처리 여러 건 — 각자의 퇴실일로 */
export async function applyCheckoutMany(
  data: HotelData,
  list: readonly Tangle[],
  notify: Notify,
): Promise<void> {
  const done: string[] = [];
  for (const t of list) {
    if (t.fix?.kind !== "checkout") continue;
    await data.patchBooking(t.ids[0]!, { checkedOutAt: outAt(t.fix.date) });
    done.push(t.ids[0]!);
  }
  void data.logChange({ kind: "stay", summary: `퇴실 미처리 ${done.length}건을 각자의 퇴실일로 처리 (확인 필요)` });
  notify(`${done.length}건을 퇴실로 처리했어요`, {
    ms: 9000,
    action: { label: "되돌리기", run: () => void Promise.all(done.map((id) => data.patchBooking(id, { checkedOutAt: null }))) },
  });
}
