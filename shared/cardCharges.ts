import { type Booking, type Platform } from "./ledger";
import { occupiedNightDates } from "./nightrates";
import { groupLedger } from "./groupLedger";
import type { RoomCardModel } from "./roomCard";
import { payState } from "./payment";

/** 약정 단가는 실제 저장된 밤 셀만 표시한다. 장부의 총액 분할 값을 계약 단가로 쓰지 않는다. */
export function cardCharges(b: Booking, model: RoomCardModel | null, platform: Platform | undefined, today: string) {
  const nights = b.kind === "stay" && b.stayMode !== "long_stay" ? occupiedNightDates(b.checkIn, b.nights ?? 0).map(date => ({ date, amount: b.nightRates?.nights?.[date] ?? null })) : [];
  const ctx = model?.groupCtx;
  const group = ctx ? groupLedger(ctx.members, (ctx.info?.payments ?? []).reduce((n, p) => n + p.amount, 0), today, { extras: (ctx.info?.extras ?? []).reduce((n, x) => n + x.amount, 0) }) : null;
  const snap = payState(b, platform);
  return {
    nights,
    needsPrice: !!b.priceUnset || (b.kind === "stay" && b.stayMode !== "long_stay" && b.price === 0 && nights.some(n => n.amount == null)),
    due: group ? group.owed : snap.tracked ? Math.max(0, snap.left) : 0,
    scope: group ? "단체 미수" : "받을 돈",
  };
}
