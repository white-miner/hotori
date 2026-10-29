import type { Booking } from "../shared/ledger";
import { smartImportInfo } from "../shared/smartRegister";

export default function BookingImportInfo({ booking }: { booking: Pick<Booking, "memo"> }) {
  const source = smartImportInfo(booking);
  if (!source) return null;
  return <div className="booking-import-info">
    <span className="smart-import-label">스마트등록</span>
    <span>원문 객실 타입</span>
    <strong>{source.rawType || "저장된 원문 없음"}</strong>
  </div>;
}
