/** 발급 CTA 공통 게이트 — hotelBiz 필수 미입력 시 askConfirm → Settings */
import { askConfirm } from "./ConfirmDialog";
import {
  HOTEL_BIZ_GATE_COPY,
  hotelBizIsReady,
  hotelBizMissingLabels,
  type HotelBiz,
} from "../shared/hotelBiz";

/** true = 발급 진행 OK. false = 막음(확인 시 Settings로 이동). */
export async function ensureHotelBizReady(biz: HotelBiz, hotelName: string): Promise<boolean> {
  if (hotelBizIsReady(biz, hotelName)) return true;
  const missing = hotelBizMissingLabels(biz, hotelName);
  const go = await askConfirm({
    title: HOTEL_BIZ_GATE_COPY.title,
    body: HOTEL_BIZ_GATE_COPY.body(missing),
    confirmLabel: HOTEL_BIZ_GATE_COPY.confirmLabel,
    cancelLabel: HOTEL_BIZ_GATE_COPY.cancelLabel,
  });
  if (go) location.hash = HOTEL_BIZ_GATE_COPY.settingsHash;
  return false;
}
