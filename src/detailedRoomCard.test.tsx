import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { emptySettings, type Booking } from "../shared/ledger";
import { detailedStatus, detailedTimes, emptyRegistry, orderedGroupMembers, registerCardGroups, roomNumberColor, compactCardPeriod, compactCardPeriodParts, cardPaymentMethods } from "../shared/detailedRoomCard";
import { CARD_CASES, TODAY } from "../shared/roomCardCases";
import { roomCardModel } from "../shared/roomCard";
import { contrast } from "../shared/platform";
import NowRoomCard, { RoomCardDetails, type CardGroup } from "./NowRoomCard";

import ManagementRecords from "./ManagementRecords";
import type { RoomMemo } from "../shared/roomMemo";

const base = CARD_CASES[0]!.b;
const s = emptySettings();
const make = (patch: Partial<Booking> = {}): Booking => ({ ...base, ...patch });
const opts = (time: string) => ({ stayTimes: { ...s.stayTimes, checkInMode: "manual" as const }, clock: { wallDate: TODAY, time } });

test("확대 날짜: 날짜 범위와 박수만 분리하고 미정·대실의 실제 기간은 유지한다", () => {
  assert.deepEqual(compactCardPeriodParts(make({ checkIn: "2026-10-30", nights: 3 }), s), { range: "10/30(금) → 11/2(월)", duration: "3박" });
  assert.deepEqual(compactCardPeriodParts(make({ checkIn: "2026-10-30", openEnded: true }), s), { range: "10/30(금) → 미정", duration: null });
  assert.deepEqual(compactCardPeriodParts(make({ kind: "dayuse", startTime: "23:00", endTime: "02:00" }), s), { range: "23:00–02:00", duration: null });
});

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

function render(b: Booking | null, group: CardGroup | null = null, readOnly = false, details = false) {
  const Card = details ? RoomCardDetails : NowRoomCard;
  return renderToStaticMarkup(<Card onClose={() => {}} roomNo="실제 객실번호" roomType="실제 객실유형" color="#ffffff" booking={b} platform={CARD_CASES[0]!.plat as any} settings={s}
    model={b ? roomCardModel({ b, plat: CARD_CASES[0]!.plat, bookings: [b], info: null, view: TODAY, today: TODAY }) : null}
    status={detailedStatus(b, TODAY, opts("10:00"))} group={group} showGroup onDetail={() => {}} onQuick={() => {}} onMemo={() => {}} memoCount={0} readOnly={readOnly} />);
}
test("실제 카드 렌더: 빈 객실은 임의 손님·금액을 만들지 않고 모든 상세 항목과 두 업무 입구를 유지한다", () => {
  const html = render(null, null, false, true);
  for (const label of ["예약자", "예약 경로", "입실", "퇴실", "이용", "객실 요금", "결제 상태", "빠른 업무", "예약 없음"]) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /₩|김|뮤지컬|촬영팀/);
});
test("실제 카드 렌더: 단체 연결 객실도 자기 예약자와 가격을 숨기지 않는다", () => {
  const b = make({ guestName: "실제 구성원", price: 123456, priceUnset: false });
  const group: CardGroup = { id: "uuid", label: "G1", name: "실제 단체", color: "g1", count: 3, index: 2, lead: false, leadRoom: "본관 701호" };
  const html = render(b, group, false, true);
  for (const value of ["실제 구성원", "123,456", "실제 단체", "02/03", "대표 본관 701호"]) assert.ok(html.includes(value), value);
  assert.ok(render(b, { ...group, lead: true }, false, true).includes("실제 단체 · 대표"));
});

test("확대 요약은 대표 표식을 연결행에 유지하고 상세 객실번호와 같은 배경·흰 글씨를 쓴다", () => {
  const b = make({ guestName: "개별 예약자" });
  const group: CardGroup = { id: "uuid", label: "G1", name: "실제 단체", color: "g1", count: 3, index: 1, lead: true, leadRoom: "701" };
  const html = render(b, group);
  assert.match(html, /class="detail-guest-name"[^>]*>실제 단체<\/strong>/);
  assert.match(html, /detail-group-role/);
  assert.match(html, /detail-period-range/);
  const badge = /class="detail-number" style="([^"]+)"/.exec(html)?.[1];
  assert.ok(badge);
  assert.equal(/class="detail-number" style="([^"]+)"/.exec(render(b, group, false, true))?.[1], badge);
});
test("색 대비와 공유: 밝고 어두운 층 색 모두 대비를 확보하고 공유 화면에 금액을 노출하지 않는다", () => {
  for (const c of ["#ffffff", "#000000", "#ffcc00", "#3366ff"]) assert.ok(contrast(roomNumberColor(c), "#FFFFFF") >= 4.5);
  const html = render(make({ price: 123456, memo: "공유하면 안 되는 예약 메모" }), null, true, true);
  assert.doesNotMatch(html, /123,456|₩|공유하면 안 되는 예약 메모/);
  assert.match(html, /공유 비공개/);
});

test("단체 일부 결제는 오늘까지 미수가 있어도 미결제로 오표시하지 않는다", () => {
  const c = CARD_CASES.find((x) => x.id === "C10")!;
  const m = roomCardModel({ b: c.b, plat: c.plat, bookings: c.bookings, info: c.info, view: TODAY, today: TODAY, preferredLeadId: c.info?.leadBookingId });
  const html = renderToStaticMarkup(<RoomCardDetails onClose={() => {}} roomNo="대표실" roomType="스탠다드" color="#ffffff" booking={c.b} platform={c.plat as any} settings={s} model={m} status={detailedStatus(c.b, TODAY, opts("10:00"))}
    group={{ id: c.b.groupId!, label: "G1", name: "단체", color: "g1", index: 1, count: 2, lead: true, leadRoom: "대표실" }} showGroup onDetail={() => {}} onQuick={() => {}} onMemo={() => {}} memoCount={0} />);
  assert.match(html, /단체 일부 결제/);
  assert.doesNotMatch(html, /단체 미결제/);
});


test("요약은 단체 라벨 자리를 고정하고 흰색 번호·실제 예약 총액·업무 입구를 유지한다", () => {
  const html = render(make({ guestName: "실제 손님", price: 123456 }));
  assert.match(html, /실제 손님/);
  assert.match(html, /color:#FFFFFF/);
  assert.match(html, /123,456/);
  assert.match(html, /상세보기/);
  assert.match(html, /빠른 업무/);
  assert.match(html, /detail-group-slot/);
  assert.doesNotMatch(html, /<dt>|detail-facts/);
  const empty = render(null);
  assert.match(empty, /예약 없음/);
  assert.match(empty, /class="detail-group-slot"><\/div>/);
  assert.doesNotMatch(empty, /detail-money|class="detail-group |₩/);
});

test("요약 날짜는 달·연도 경계, 열린 숙박, 대실 자정 시간을 실제 데이터로 구분한다", () => {
  assert.equal(compactCardPeriod(make({ checkIn: "2026-10-26", nights: 4 }), s), "10/26(월) → 30(금) · 4박");
  assert.equal(compactCardPeriod(make({ checkIn: "2026-12-31", nights: 2 }), s), "12/31(목) → 1/2(토) · 2박");
  assert.equal(compactCardPeriod(make({ checkIn: "2026-10-26", openEnded: true, earlyOut: null }), s), "10/26(월) → 미정");
  assert.equal(compactCardPeriod(make({ kind: "dayuse", startTime: "23:00", endTime: "02:00" }), s), "23:00–02:00");
});


test("관리기록은 해결된 과거 기록을 보존하고 객실 특이사항·자동 경고와 구분한다", () => {
  const memo: RoomMemo = { id: "open", roomId: null, kind: "delivery", body: "저장된 호텔 기록", status: "open", createdAt: "2026-10-29T01:00:00Z", updatedAt: "2026-10-29T01:00:00Z", resolvedAt: null };
  const records: RoomMemo[] = [memo, { ...memo, id: "old", body: "해결된 과거 기록", status: "resolved", resolvedAt: memo.createdAt }, { ...memo, id: "issue", kind: "issue", roomId: "room-1", body: "별도 객실 특이사항" }];
  const before = JSON.stringify(records);
  const html = renderToStaticMarkup(<ManagementRecords records={records} settings={s} checkCount={122} checks={<span>자동 경고 내용</span>} onClose={() => {}} onSave={async () => memo} onSetStatus={async () => memo} notify={() => {}} />);
  assert.match(html, /저장된 호텔 기록/); assert.match(html, /해결된 과거 기록/);
  assert.match(html, /새 기록/); assert.match(html, /확인사항 122/);
  assert.doesNotMatch(html, /별도 객실 특이사항|자동 경고 내용/);
  assert.equal(JSON.stringify(records), before);
  const unavailable = renderToStaticMarkup(<ManagementRecords records={null} loadError="network" settings={s} checkCount={0} checks={null} onClose={() => {}} onSave={async () => memo} onSetStatus={async () => memo} notify={() => {}} />);
  assert.match(unavailable, /불러오지 못했어요/);
  assert.doesNotMatch(unavailable, /작성된 관리기록이 없어요/);
});


test("고액 요약은 금액을 보존하고 결제 상태를 수납수단 행에 표시한다", () => {
  const html = render(make({ price: 1234567890, priceUnset: false }));
  assert.match(html, /1,234,567,890/);
  assert.match(html, /detail-tenders[^]*detail-payment/);
  const money = html.split('class="detail-money"')[1]?.split('</div>')[0] ?? "";
  assert.doesNotMatch(money, /detail-payment/);
});

test("공유 요약은 예약 경로만 유지하고 실제 수납수단·금액·메모는 숨긴다", () => {
  const html = render(make({ price: 123456, memo: "비공개메모", payments: [{ id: "private-pay", bookingId: base.id, kind: "deposit", method: "transfer", amount: 123456, bizDate: TODAY, createdAt: "" }] }), null, true);
  assert.match(html, /title="예약 경로">현장<\/span>/);
  assert.doesNotMatch(html, /123,456|실제 수납|이체|비공개메모/);
});


test("실제 수납수단: 카드·현금·이체와 단체 공통 수납의 범위를 구분한다", () => {
  const p = (id: string, method: "card" | "cash" | "transfer", amount: number) => ({ id, method, amount, bookingId: base.id, kind: "deposit" as const, bizDate: TODAY, createdAt: "" });
  const b = make({ payments: [p("p1", "card", 30000), p("p2", "cash", 20000), p("p3", "transfer", 10000)] });
  assert.equal(cardPaymentMethods(b, null).label, "카드·현금·이체");
  assert.match(cardPaymentMethods(b, null).title, /카드30,000/);
  assert.equal(cardPaymentMethods(make({ payments: [] }), null).label, "수납 기록 없음");
  const c = CARD_CASES.find((x) => x.id === "C10")!;
  const model = roomCardModel({ b: c.b, plat: c.plat, bookings: c.bookings, info: c.info, view: TODAY, today: TODAY });
  const before = JSON.stringify(c);
  assert.match(cardPaymentMethods(c.b, model).label, /^단체 /);
  assert.equal(JSON.stringify(c), before);
});

test("인원은 객실의 기본값을 사용하고 저장된 인원은 우선하며 단체 라벨은 이름 위다", () => {
  const settings = { ...s, types: [{ id: "actual", name: "트윈", baseGuests: 3, maxGuests: 4 }] };
  const renderGuest = (guests: number | null) => renderToStaticMarkup(<NowRoomCard roomNo="602" roomType="트윈" roomTypeId="actual" color="#224488" booking={make({ guests, typeId: "sold" })} platform={{ id: "p", name: "에어비앤비", abbr: "에", onsite: false }} settings={settings} model={null} status={{label:"투숙 중",tone:"stay"}} group={null} showGroup onDetail={() => {}} onQuick={() => {}} onGuests={() => {}} onMemo={() => {}} memoCount={0}/>);
  assert.match(renderGuest(null), /602 인원 3명 · 조회·수정/);
  assert.match(renderGuest(2), /602 인원 2명 · 조회·수정/);
  assert.match(renderGuest(null), /에어비앤비 결제/);
  assert.doesNotMatch(renderGuest(null), />플랫폼<|detail-platform/);
  const group: CardGroup = { id: "g", label: "G1", name: "실제 단체", color: "g1", count: 2, index: 1, lead: true, leadRoom: "602" };
  const html = render(make(), group);
  assert.ok(html.indexOf('class="detail-group g1"') < html.indexOf('class="detail-guest-line"'));
});
