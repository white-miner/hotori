import type { Booking } from "./ledger";
import { stayInOutLabel, stayStatusLabel } from "./ledger";
import { xlsx, type Cell } from "./xlsx";

export type LedgerExportLabels = {
  platformName: (platformId: string) => string;
  typeLabel: (typeId: string) => string;
  roomLabel: (b: Booking) => string;
};

/** 장부 이용내역 표 → 엑셀 행 (헤더 포함). 화면 필터된 목록 그대로. */
export function ledgerExportRows(bookings: readonly Booking[], L: LedgerExportLabels): Cell[][] {
  const rows: Cell[][] = [["입실일", "종류", "플랫폼", "이름", "연락처", "상태", "입–퇴", "인원", "타입", "방", "가격", "메모"]];
  for (const b of bookings) {
    rows.push([
      b.checkIn,
      b.kind === "stay" ? "숙박" : "대실",
      L.platformName(b.platformId),
      b.guestName,
      b.guestPhone?.trim() || "",
      stayStatusLabel(b),
      stayInOutLabel(b),
      b.guests ?? "",
      L.typeLabel(b.typeId),
      L.roomLabel(b),
      b.price,
      b.memo?.trim() || "",
    ]);
  }
  return rows;
}

export function ledgerXlsxBytes(bookings: readonly Booking[], L: LedgerExportLabels): Uint8Array {
  return xlsx("장부", ledgerExportRows(bookings, L), [12, 8, 12, 14, 14, 10, 14, 8, 12, 10, 12, 28]);
}

export function downloadLedgerXlsx(bookings: readonly Booking[], L: LedgerExportLabels, fileName: string): void {
  const bytes = ledgerXlsxBytes(bookings, L);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
