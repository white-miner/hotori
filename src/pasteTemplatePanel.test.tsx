import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import PasteTemplatePanel from "./PasteTemplatePanel";

const sample = [
  "예약 번호",
  "1000000001",
  "확정된 예약",
  "투숙객",
  "Mina Park",
  "성인",
  "2명",
  "연락처",
  "010-0000-0000",
  "객실 종류 및 혜택",
  "1 X 스탠다드",
  "체크인",
  "2026년 11월 7일 16:00",
  "체크아웃",
  "2026년 11월 9일 12:00",
  "박수",
  "2",
  "기준 판매 요금(세금 및 수수료 포함)",
  "KRW 210,000",
].join("\n");

test("양식 설정 화면은 기존 스마트등록 칸만 보여 준다", () => {
  let saved = false;
  const html = renderToStaticMarkup(
    <PasteTemplatePanel
      platforms={[{ id: "p1", name: "아고다", abbr: "아", onsite: false }]}
      drafts={{ p1: { labels: { guestName: "투숙객", adults: "성인", checkIn: "체크인" }, rules: { guestName: { label: "투숙객", occurrence: 0 }, adults: { label: "성인", occurrence: 0 }, checkIn: { label: "체크인", occurrence: 0 } } } }}
      onEdit={() => {}}
      sample={sample}
      onSample={() => {}}
      canSave
      onSave={() => {
        saved = true;
      }}
      onReset={() => {}}
      onClose={() => {}}
    />,
  );
  for (const id of ["guestName", "guestPhone", "typeRaw", "checkIn", "nights", "salesTotal", "reservationId"]) {
    assert.match(html, new RegExp(`data-field="${id}"`));
  }
  for (const id of ["adults", "statusRaw", "checkOut", "checkInTime", "checkOutTime", "currency"]) {
    assert.equal(html.includes(`data-field="${id}"`), false, id);
  }
  const text = html.replace(/<[^>]+>/g, "\n");
  assert.match(text, /이름[\s\S]*Mina Park/);
  assert.match(text, /입실[\s\S]*2026-11-07 16:00/);
  for (const gone of ["회사명", "호실", "빠른 입실", "늦은 퇴실"]) {
    assert.equal(text.includes(gone), false, gone);
  }
  assert.equal(saved, false);
});
