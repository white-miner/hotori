import { won } from "./ledger";
import { balanceLabel, type GroupLedger } from "./groupLedger";

export function groupEvidenceText(g: GroupLedger, roomLabel: (id: string) => string): string {
  return [
    g.prepaid > 0 ? `결제 ${won(g.paid)}원 − 전체 청구 ${won(g.due)}원 = 초과 수납 ${won(g.prepaid)}원` : g.owed > 0 ? `현재 청구 ${won(g.dueSoFar)}원 − 결제 ${won(g.paid)}원 = 미수금 ${won(g.owed)}원` : balanceLabel(g),
    `청구 ${won(g.due)}원 = 객실 ${won(g.roomCharges)}원 + 단체 추가 항목 ${won(g.extras)}원`,
    `결제 ${won(g.paid)}원 = 객실별 수납 ${won(g.paid - g.lump)}원 + 단체 수납 ${won(g.lump)}원`,
    ...g.rooms.map(r => `${roomLabel(r.bookingId)} · ${r.checkIn}~${r.checkOut}${r.openEnded ? " (퇴실 미정)" : ""} · ${won(r.subtotal)}원`),
    g.upcoming ? `이후 예정 청구 ${won(g.upcoming)}원은 현재 미수금에서 제외합니다.` : "",
    "클릭하면 날짜별 청구 근거·수납 기록과 수정 메뉴를 확인합니다.",
  ].filter(Boolean).join("\n");
}
