import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SMART_REGISTER_TEMPLATE_COLUMNS } from "../shared/smartRegister";
import PasteTemplatePanel from "./PasteTemplatePanel";

const sample = [
  "예약 번호",
  "1000000001",
  "확정된 예약",
  "투숙객",
  "Mina Park",
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
      templates={[{ platformId: "p1", profileId: "agoda", version: 1, labels: { guestName: "투숙객", checkIn: "체크인" } }]}
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
  const text = html.replace(/<[^>]+>/g, "\n");
  for (const col of SMART_REGISTER_TEMPLATE_COLUMNS) {
    assert.ok(text.includes(col.label), col.label);
  }
  assert.match(text, /이름[\s\S]*Mina Park/);
  assert.match(text, /입실[\s\S]*2026-11-07 16:00/);
  for (const gone of ["회사명", "인원", "호실", "빠른 입실", "늦은 퇴실"]) {
    assert.equal(text.includes(gone), false, gone);
  }
  assert.equal(saved, false);
});
