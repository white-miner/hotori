import { type Booking, type Platform } from "./ledger";
import { occupiedNightDates } from "./nightrates";
import { groupFolio, groupExtrasTotal } from "./folio";
import type { RoomCardModel } from "./roomCard";
import { isOnsite, payState } from "./payment";
import { shopChargesTotal } from "./shop";

/** 약정 단가는 실제 저장된 밤 셀만 표시한다. 장부의 총액 분할 값을 계약 단가로 쓰지 않는다.
 * 받을 돈 = 예약 전체 청구 − 받은 결제 (결제 등록·단체 머리글과 같은 shared/folio 기준). */
export function cardCharges(b: Booking, model: RoomCardModel | null, platform: Platform | undefined, today: string) {
  const nights = b.kind === "stay" && b.stayMode !== "long_stay" ? occupiedNightDates(b.checkIn, b.nights ?? 0).map(date => ({ date, amount: b.nightRates?.nights?.[date] ?? null })) : [];
  const ctx = model?.groupCtx;
  const group = ctx
    ? groupFolio(
        ctx.members,
        (ctx.info?.payments ?? []).reduce((n, p) => n + p.amount, 0),
        groupExtrasTotal(ctx.info),
        { onsite: platform ? isOnsite(platform) : null, payMode: ctx.info?.payMode ?? null },
        today,
      )
    : null;
  const snap = payState(b, platform, today);
  // 요금 미등록 박은 한 줄로 접어요 (박마다 ‘요금 미등록’을 늘어놓지 않아요 · 총액을 박에 나누지도 않아요)
  const unset = nights.filter((n) => n.amount == null);
  return {
    nights,
    setNights: nights.filter((n) => n.amount != null),
    unsetCount: unset.length,
    unsetFrom: unset[0]?.date ?? null,
    unsetTo: unset[unset.length - 1]?.date ?? null,
    needsPrice: !!b.priceUnset || (b.kind === "stay" && b.stayMode !== "long_stay" && b.price === 0 && nights.some(n => n.amount == null)),
    due: group ? group.owed : snap.tracked ? Math.max(0, snap.left) : 0,
    scope: group ? "단체 미수금" : "받을 돈",
    /** 받을 돈 중 매점 객실 외상 (장부 청구. 단체면 단체 장부 전체) */
    shopTab: ctx
      ? shopChargesTotal(ctx.info?.shopCharges) + ctx.members.reduce((n, m) => n + (m.status === "cancelled" ? 0 : shopChargesTotal(m.shopCharges)), 0)
      : shopChargesTotal(b.shopCharges),
  };
}
