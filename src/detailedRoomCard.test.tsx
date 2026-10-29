import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { emptySettings, type Booking } from "../shared/ledger";
import { detailedStatus, detailedTimes, emptyRegistry, orderedGroupMembers, registerCardGroups } from "../shared/detailedRoomCard";
import { CARD_CASES, TODAY } from "../shared/roomCardCases";
import { roomCardModel } from "../shared/roomCard";
import { contrast, textOn } from "../shared/platform";
import NowRoomCard, { type CardGroup } from "./NowRoomCard";

const base = CARD_CASES[0]!.b;
const s = emptySettings();
const make = (patch: Partial<Booking> = {}): Booking => ({ ...base, ...patch });
const opts = (time: string) => ({ stayTimes: { ...s.stayTimes, checkInMode: "manual" as const }, clock: { wallDate: TODAY, time } });

test("상세 상태: 퇴실 날짜만으로 퇴실예정을 켜지 않고 기존 6시간 윈도우를 따른다", () => {
  const b = make({ checkIn: "2026-10-27", nights: 1, arrived: true, checkedOutAt: null });
  assert.equal(detailedStatus(b, TODAY, opts("05:59")).label, "투숙 중");
  assert.equal(detailedStatus(b, TODAY, opts("06:00")).label, "퇴실예정");
  assert.equal(detailedStatus({ ...b, lateOut: 3 }, TODAY, opts("08:59")).label, "투숙 중");
  assert.equal(detailedStatus({ ...b, lateOut: 3 }, TODAY, opts("09:00")).note, "늦은 퇴실");
});
test("상세 상태: 미입실·마감은 판매가능과 구분하고 청소 제외는 점유 판단을 바꾸지 않는다", () => {
  assert.equal(detailedStatus(null, TODAY, opts("10:00")).label, "판매가능");
  assert.equal(detailedStatus(null, TODAY, opts("10:00"), true).label, "판매중지");
  assert.equal(detailedStatus(make({ arrived: false }), TODAY, opts("10:00")).label, "입실예정");
  const b = make({ arrived: true, noClean: true });
  assert.equal(detailedStatus(b, TODAY, opts("10:00")).label, "투숙 중");
  assert.equal(detailedStatus(make({ kind: "dayuse" }), TODAY, opts("10:00")).label, "대실");
});
test("상세 날짜: 늦은 퇴실·빠른 입실과 자정 경계를 날짜에도 반영한다", () => {
  const setting = { stayTimes: { ...s.stayTimes, checkIn: "02:00", checkOut: "23:00" } };
  const b = make({ checkIn: "2026-10-28", nights: 1, earlyIn: 3, lateOut: 2 });
  const t = detailedTimes(b, setting);
  assert.deepEqual([t.inDate, t.inTime, t.outDate, t.outTime], ["2026-10-27", "23:00", "2026-10-30", "01:00"]);
  assert.equal(detailedTimes({ ...b, openEnded: true }, setting).outDate, null);
  const dayuse = detailedTimes(make({ kind: "dayuse", checkIn: "2026-10-28", startTime: "23:00", endTime: "02:00" }), s);
  assert.equal(dayuse.outDate, "2026-10-29");
});
test("단체 식별·순번: 방번호 이동·대표 변경·조회 순서가 표시 ID와 구성원 순서를 바꾸지 않는다", () => {
  const first = make({ id: "member-a", groupId: "group-one", roomId: "room-999", createdAt: "2026-10-20T00:00:00Z" });
  const second = make({ id: "member-b", groupId: "group-one", roomId: "room-101", createdAt: "2026-10-21T00:00:00Z" });
  const registry = registerCardGroups(emptyRegistry(), [second, first]);
  assert.deepEqual(orderedGroupMembers(registry, "group-one", [second, first]).map((b) => b.id), [first.id, second.id]);
  assert.equal(registerCardGroups(registry, [{ ...second, roomId: "room-701" }, { ...first, roomId: "room-201" }]), registry);
  const next = registerCardGroups(registry, [make({ id: "member-c", groupId: "group-two" })]);
  assert.equal(next.groups["group-one"]!.number, 1);
  assert.equal(next.groups["group-two"]!.number, 2);
  assert.equal(orderedGroupMembers(next, "group-one", [{ ...first, groupId: null }, second]).length, 1);
  assert.equal(second.roomId, "room-101");
});

function render(b: Booking | null, group: CardGroup | null = null, readOnly = false) {
  return renderToStaticMarkup(<NowRoomCard roomNo="실제 객실번호" roomType="실제 객실유형" color="#ffffff" booking={b} platform={CARD_CASES[0]!.plat as any} settings={s}
    model={b ? roomCardModel({ b, plat: CARD_CASES[0]!.plat, bookings: [b], info: null, view: TODAY, today: TODAY }) : null}
    status={detailedStatus(b, TODAY, opts("10:00"))} group={group} showGroup onDetail={() => {}} onQuick={() => {}} onMemo={() => {}} memoCount={0} readOnly={readOnly} />);
}
test("실제 카드 렌더: 빈 객실은 임의 손님·금액을 만들지 않고 모든 상세 항목과 두 업무 입구를 유지한다", () => {
  const html = render(null);
  for (const label of ["예약자", "예약 경로", "입실", "퇴실", "이용", "객실 요금", "결제 상태", "상세보기", "빠른 업무", "예약 없음"]) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /₩|김|뮤지컬|촬영팀/);
});
test("실제 카드 렌더: 단체 연결 객실도 자기 예약자와 가격을 숨기지 않는다", () => {
  const b = make({ guestName: "실제 구성원", price: 123456, priceUnset: false });
  const group: CardGroup = { id: "uuid", label: "G1", name: "실제 단체", color: "g1", count: 3, index: 2, lead: false, leadRoom: "본관 701호" };
  const html = render(b, group);
  for (const value of ["실제 구성원", "123,456", "실제 단체", "02/03", "대표 본관 701호"]) assert.ok(html.includes(value), value);
  assert.ok(render(b, { ...group, lead: true }).includes("실제 단체 · 대표"));
});
test("색 대비와 공유: 밝고 어두운 층 색 모두 대비를 확보하고 공유 화면에 금액을 노출하지 않는다", () => {
  for (const c of ["#ffffff", "#000000", "#ffcc00", "#3366ff"]) assert.ok(contrast(c, textOn(c)) >= 4.5);
  const html = render(make({ price: 123456 }), null, true);
  assert.doesNotMatch(html, /123,456|₩/);
  assert.match(html, /공유 비공개/);
});

test("단체 일부 결제는 오늘까지 미수가 있어도 미결제로 오표시하지 않는다", () => {
  const c = CARD_CASES.find((x) => x.id === "C10")!;
  const m = roomCardModel({ b: c.b, plat: c.plat, bookings: c.bookings, info: c.info, view: TODAY, today: TODAY, preferredLeadId: c.info?.leadBookingId });
  const html = renderToStaticMarkup(<NowRoomCard roomNo="대표실" roomType="스탠다드" color="#ffffff" booking={c.b} platform={c.plat as any} settings={s} model={m} status={detailedStatus(c.b, TODAY, opts("10:00"))}
    group={{ id: c.b.groupId!, label: "G1", name: "단체", color: "g1", index: 1, count: 2, lead: true, leadRoom: "대표실" }} showGroup onDetail={() => {}} onQuick={() => {}} onMemo={() => {}} memoCount={0} />);
  assert.match(html, /단체 일부 결제/);
  assert.doesNotMatch(html, /단체 미결제/);
});
