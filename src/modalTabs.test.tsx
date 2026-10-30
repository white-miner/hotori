import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeSettings } from "../shared/ledger";
import { mk } from "../shared/roomCardCases";
import { emptyGroupInfo } from "../shared/settle";
import type { HotelData } from "./data";
import GroupEvidenceSheet from "./GroupEvidenceSheet";
import GroupReceiptSheet from "./GroupReceiptSheet";
import GroupScheduleSheet from "./GroupScheduleSheet";
import RecordSheet from "./RecordSheet";
import PaymentDeskModal from "./PaymentDeskModal";

const today = "2026-10-31", gid = "g";
const s = normalizeSettings({ types: [{ id: "std", name: "스탠다드" }], platforms: [{ id: "walk", name: "현장", onsite: true }], floors: [{ id: "f", name: "검증층", rooms: [{ id: "r", no: "검증101", typeId: "std" }] }] });
const booking = mk({ id: "b", kind: "stay", status: "active", platformId: "walk", roomId: "r", typeId: "std", guestName: "검증 단체", groupId: gid, groupName: "검증 단체", checkIn: "2026-10-29", nights: 3, price: 230000, nightRates: { nights: { "2026-10-29": 70000, "2026-10-30": 80000, "2026-10-31": 80000 } }, payments: [{ id: "p", bookingId: "b", amount: 50000, method: "card", kind: "balance", bizDate: "2026-10-29", createdAt: "2026-10-29T00:00:00Z" }] });
const info = { ...emptyGroupInfo(gid), payments: [{ id: "gp", bookingId: "", groupId: gid, amount: 100000, method: "transfer" as const, kind: "balance" as const, bizDate: "2026-10-30", createdAt: "2026-10-30T00:00:00Z" }] };
const data = { hotel: { settings: s }, bookings: [booking], groups: new Map([[gid, info]]), changes: [] } as unknown as HotelData;
const noWrite = () => { throw new Error("조회 렌더에서 쓰기 호출 금지"); };
const close = () => {};
const evidenceProps = { data, today, groupId: gid, onClose: close, onEditSchedule: noWrite, onEditPayments: noWrite, onPay: noWrite };
const receiptProps = { today, members: [booking], groupName: "검증 단체", groupLump: 100000, lumps: info.payments, leadId: "b", leadPinned: true, roomLabel: () => "검증101", onPay: async () => noWrite(), onUndo: async () => noWrite(), onSetLead: async () => noWrite(), onClose: close };

function tabContract(html: string, expected: number) {
  const tabs = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/g)].map(m => m[0]);
  assert.equal(tabs.length, expected);
  assert.equal(tabs.filter(t => t.includes('aria-selected="true"')).length, 1);
  for (const tab of tabs) {
    assert.match(tab, /type="button"/);
    const id = tab.match(/id="([^"]+)"/)![1], controls = tab.match(/aria-controls="([^"]+)"/)![1];
    assert.ok(html.includes(`id="${controls}"`), `패널 연결 없음: ${controls}`);
    assert.ok(html.includes(`aria-labelledby="${id}"`));
  }
  const panels = [...html.matchAll(/<div\b[^>]*role="tabpanel"[^>]*>/g)].map(m => m[0]);
  assert.equal(panels.filter(p => !p.includes('hidden=""')).length, 1);
}
function panel(html: string, key: string) {
  return html.split('<div class="modal-task-panel"').slice(1).find(p => p.includes(`-panel-${key}"`))!;
}

test("단체 조회는 5개 업무를 분리하고 결제 등록·수정 입구를 고정 내비게이션에 제공", () => {
  const before = JSON.stringify([booking, info]);
  const html = renderToStaticMarkup(<GroupEvidenceSheet {...evidenceProps} />);
  tabContract(html, 5);
  assert.match(panel(html, "charges"), /70,000원|80,000원/);
  assert.doesNotMatch(panel(html, "charges"), /단체 수납<small>/);
  assert.match(panel(html, "payments"), /100,000원/);
  assert.doesNotMatch(panel(html, "payments"), /저장된 박 요금/);
  assert.match(html.split('class="ge-body')[0], /결제 등록|일정·요금 수정|결제 기록 정정/);
  assert.equal(JSON.stringify([booking, info]), before);
});
test("단체 읽기 전용은 조회 탭을 유지하고 결제 등록·수정 바로가기 제거", () => {
  const html = renderToStaticMarkup(<GroupEvidenceSheet {...evidenceProps} readOnly />);
  tabContract(html, 5);
  assert.doesNotMatch(html, /modal-task-shortcuts|대표로 지정|대표 자동 지정/);
});
test("단체 결제 등록은 등록·청구·내역·객실 관리의 연결된 패널을 제공", () => {
  const html = renderToStaticMarkup(<GroupReceiptSheet {...receiptProps} />);
  tabContract(html, 4);
  assert.match(panel(html, "register"), /aria-label="결제 금액"/);
  assert.doesNotMatch(panel(html, "payments"), /aria-label="결제 금액"/);
  assert.match(panel(html, "payments"), /100,000원/);
  const ro = renderToStaticMarkup(<GroupReceiptSheet {...receiptProps} readOnly />);
  tabContract(ro, 3);
  assert.match(ro, /disabled=""/);
});
test("기록 정정은 결제와 일정 편집을 분리하고 객실 요금 직접 열기 목적을 유지", () => {
  const props = { data, today, members: [booking], groupId: gid, name: "검증 단체", onClose: close };
  const html = renderToStaticMarkup(<RecordSheet {...props} />);
  tabContract(html, 3);
  assert.match(panel(html, "payments"), /카드 50,000원/);
  assert.doesNotMatch(panel(html, "stay"), /결제 · 카드/);
  const focused = renderToStaticMarkup(<RecordSheet {...props} focusKey="in-b" />);
  assert.match(focused, /id="[^"]+-tab-stay"[^>]*aria-selected="true"/);
  assert.match(panel(focused, "stay"), /aria-label="객실 기간·요금 고치기"/);
});
test("단체 일정 편집은 일별 집계·저장 전 변경 확인을 독립적으로 조회하며 원본 유지", () => {
  const before = JSON.stringify(booking);
  const html = renderToStaticMarkup(<GroupScheduleSheet data={data} today={today} groupId={gid} onClose={close} onSaved={noWrite} />);
  tabContract(html, 3);
  assert.match(panel(html, "daily"), /날짜별 숙박 객실·요금/);
  assert.match(panel(html, "review"), /변경한 객실이 없습니다/);
  assert.equal(JSON.stringify(booking), before);
});
test("수납 데스크의 모든 업무 탭은 존재하는 패널과 연결되며 실제 금전 호출 없이 조회", () => {
  const html = renderToStaticMarkup(<PaymentDeskModal s={s} today={today} members={[{ ...booking, groupId: null }]} roomLabels={["검증101"]} onCancel={close} onPay={noWrite} onSurcharge={noWrite} />);
  tabContract(html, 3);
  assert.match(panel(html, "pay"), /aria-label="수납 금액"/);
  assert.match(panel(html, "surcharge"), /aria-label="할증 금액"/);
  assert.match(panel(html, "ledger"), /50,000/);
});
