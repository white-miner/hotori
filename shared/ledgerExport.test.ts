import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { test } from "node:test";
import type { Booking } from "./ledger";
import { ledgerExportRows, ledgerXlsxBytes } from "./ledgerExport";

function unzip(buf: Uint8Array) {
  const b = Buffer.from(buf);
  const files = new Map<string, string>();
  let p = 0;
  while (b.readUInt32LE(p) === 0x04034b50) {
    const method = b.readUInt16LE(p + 8);
    const size = b.readUInt32LE(p + 18);
    const nlen = b.readUInt16LE(p + 26);
    const xlen = b.readUInt16LE(p + 28);
    const name = b.subarray(p + 30, p + 30 + nlen).toString("utf8");
    const start = p + 30 + nlen + xlen;
    const raw = b.subarray(start, start + size);
    files.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString("utf8"));
    p = start + size;
  }
  return files;
}

const base: Booking = {
  id: "b1",
  kind: "stay",
  status: "active",
  platformId: "p1",
  typeId: "t1",
  roomId: "r1",
  guestName: "김손님",
  guestPhone: "010-1111-2222",
  checkIn: "2026-10-20",
  nights: 2,
  startTime: null,
  endTime: null,
  price: 120000,
  guests: 2,
  memo: "금연",
  arrived: false,
  cancelledAt: null,
  createdAt: "2026-10-19T00:00:00Z",
  updatedAt: "2026-10-19T00:00:00Z",
};

test("장부 엑셀 행: 헤더+예약 1건", () => {
  const rows = ledgerExportRows([base], {
    platformName: () => "야놀자",
    typeLabel: () => "스탠다드",
    roomLabel: () => "201",
  });
  assert.equal(rows[0]![0], "입실일");
  assert.deepEqual(rows[1]!.slice(0, 5), ["2026-10-20", "숙박", "야놀자", "김손님", "010-1111-2222"]);
  assert.equal(rows[1]![10], 120000);
  assert.equal(rows[1]![11], "금연");
});

test("장부 xlsx 바이트에 시트·한글", () => {
  const f = unzip(
    ledgerXlsxBytes([base], {
      platformName: () => "야놀자",
      typeLabel: () => "스탠다드",
      roomLabel: () => "201",
    }),
  );
  assert.ok(f.has("xl/worksheets/sheet1.xml"));
  assert.match(f.get("xl/workbook.xml")!, /name="장부"/);
  assert.match(f.get("xl/worksheets/sheet1.xml")!, /김손님/);
});
