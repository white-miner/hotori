// 객실 카드 검증 표 (docs/room-card-spec.md §7): 현황·배치가 같은 모델을 쓰고, 실제 렌더 결과(RoomCardFacts)까지 확인해요.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import RoomCardFacts from "./RoomCardFacts";
import { CARD_CASES, TODAY, type CardCase } from "../shared/roomCardCases";
import { roomCardModel } from "../shared/roomCard";
import { groupLeadChipLabel, groupPeerRoomItems } from "../shared/group";
import { nowRateText } from "../shared/nowCard";

const model = (c: CardCase, site: "now" | "board") =>
  roomCardModel({ b: c.b, plat: c.plat, bookings: c.bookings, info: c.info, view: site === "now" ? TODAY : c.view, today: TODAY, preferredLeadId: c.info?.leadBookingId ?? null });
const text = (html: string) => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").replace(/^\||\|$/g, "");

/** 배치 칸처럼 그리는 방식 (period = 이용기간 + 박수) */
const renderFacts = (m: ReturnType<typeof model>, slot: "top" | "who", withPeriod: boolean) =>
  renderToStaticMarkup(
    <RoomCardFacts
      slot={slot}
      rate={m.rate}
      payText={m.payText}
      payTitle={m.payTitle}
      tone={m.tone}
      due={m.due}
      company={m.company}
      viewLabel="10/28"
      openEnded={m.openEnded}
      period={withPeriod ? [m.period, m.progress].filter(Boolean).join(" · ") : undefined}
    />,
  );

for (const site of ["now", "board"] as const) {
  for (const c of CARD_CASES) {
    if (site === "now" && c.boardOnly) continue;
    test(`카드 ${site === "now" ? "현황" : "배치"} · ${c.id} ${c.name}`, () => {
      const m = model(c, site);
      const e = c.expect;
      if (e.line === "") {
        assert.equal(m.active, false, "취소 예약은 카드에 사실 줄을 만들지 않아요");
        return;
      }
      assert.equal([m.period, m.progress].filter(Boolean).join(" · "), e.line, "이용기간 + 박수");
      assert.equal(nowRateText(m.rate), e.rate, "박당 요금");
      if (e.varies != null) assert.equal(m.rate.varies, e.varies, "변동 표시");
      assert.equal(m.payText, e.pay, "결제 방식·금액");
      assert.equal(m.due, e.due, "받아야 할 돈");
      assert.equal(m.isLead, e.lead, "대표객실은 대표 카드에만");
      assert.equal(m.isMember, e.member === true);
      if (e.company !== undefined) assert.equal(m.company, e.company);

      // 실제 렌더: 순서(기간 → 결제 → 받을 돈 / 회사 → 박당 요금)와 색 클래스
      const top = renderFacts(m, "top", site === "board");
      const who = renderFacts(m, "who", false);
      if (site === "board") assert.ok(top.includes(e.line.split(" · ")[0]!), "배치 카드에도 이용기간 줄이 있어요");
      const iPeriod = top.indexOf("rc-period");
      const iPay = top.indexOf("rc-pay");
      const iDue = top.indexOf("rc-due");
      if (e.pay) {
        assert.match(top, /class="nowamt rc-pay amt-paid"/, "받은 돈=검정");
        assert.ok(top.includes(e.pay.split(" · ")[0]!));
        if (iPeriod >= 0) assert.ok(iPeriod < iPay, "이용기간이 결제보다 위");
      } else assert.equal(iPay, -1, "결제 줄 없음");
      if (e.due > 0) {
        assert.match(top, /class="nowamt rc-due amt-due"/, "받아야 할 돈=파랑");
        assert.ok(top.includes(e.due.toLocaleString("en-US")));
        if (iPay >= 0) assert.ok(iPay < iDue, "받을 돈은 결제 아래");
      } else assert.equal(iDue, -1);
      if (e.rate) {
        assert.match(who, /class="rc-rate amt-rate"/, "객실 가격=빨강");
        assert.ok(who.includes(e.rate));
        if (e.company) assert.ok(who.indexOf(e.company) < who.indexOf("rc-rate"), "회사가 박당 요금보다 위");
      } else assert.doesNotMatch(who, /rc-rate/, "요금을 모르면 비워요 (평균·추정 금지)");
      assert.equal(who.includes("변동"), e.varies === true);
      // 총액·평균·플랫폼 예약번호는 카드에 없어요
      assert.doesNotMatch(text(top + who), /예약번호|평균|추정|YN-/);
      assert.doesNotMatch(top + who, /대표객실/, "대표객실 글자는 머리줄에서만 (사실 줄에는 없어요)");
    });
  }
}

test("카드 · 퇴실 미정은 `10/25 ~` · 단체 대표객실의 단체 결제는 대표 카드에만", () => {
  const open = CARD_CASES.find((c) => c.id === "C15")!;
  assert.equal(model(open, "now").period, "10/25 ~");
  assert.match(renderFacts(model(open, "board"), "top", true), /10\/25 ~ · 4박째/);
  const lead = CARD_CASES.filter((c) => c.expect.lead).map((c) => c.id);
  assert.deepEqual(lead, ["C10"]);
  for (const c of CARD_CASES.filter((x) => x.expect.member)) assert.equal(model(c, "now").due, 0);
});

test("카드 · 건물 이름은 다른 객실을 가리킬 때만 (구성원 카드의 대표객실 표시 · 대표객실 연동 목록)", () => {
  const lead = { id: "a", roomId: "r602" };
  const label = (id: string) => (id === "r602" ? "본관 602" : "별관 301");
  assert.equal(groupLeadChipLabel("b", lead, label), "본관 602호", "구성원 카드는 대표객실을 건물+호수로 가리켜요");
  assert.equal(groupLeadChipLabel("a", lead, label), "대표객실", "대표객실 카드는 글자만");
  const mk = (id: string, roomId: string) => ({ id, roomId, payments: [], createdAt: "2026-10-25T00:00:00Z" });
  const items = groupPeerRoomItems([mk("a", "r602"), mk("b", "r301")], label, { preferredId: "a" });
  assert.deepEqual(items, [{ no: "별관 301", lead: false }, { no: "본관 602", lead: true }], "연동 객실 목록도 건물+호수");
  const src = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /rc-bld|bldTag/, "일반 카드 머리줄에는 건물 이름을 붙이지 않아요");
  assert.match(src, /groupPeerRoomItems\(groupStayPeers\(bookings, b\.groupId\), \(id\) => L\.roomLabel\(id\)/, "연동 목록은 roomLabel(건물+호수)");
  assert.match(src, /groupLeadChipLabel\(b\.id, lead, \(id\) => L\.roomLabel\(id\)/, "구성원 칩은 roomLabel");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /rc-bld/);
});

test("카드 · 현황과 배치는 같은 모델을 쓰고, 그림 순서는 이름 위에 기간·결제 → 이름 → 회사·박당 요금", () => {
  const src = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");
  assert.equal((src.match(/cardModelOf\(/g) ?? []).length, 2, "현황 1 + 배치 1");
  assert.doesNotMatch(src, /nownights-acc/, "배치 아래쪽에 따로 박수 칩을 두지 않아요 (이용기간 줄에 합침)");
  // 배치: factsEl("top") → .nm → factsEl("who")
  const board = src.slice(src.indexOf('id={`rooms-room-${r.id}`}'));
  assert.ok(board.indexOf('factsEl("top")') < board.indexOf('className="nm"'));
  assert.ok(board.indexOf('className="nm"') < board.indexOf('factsEl("who")'));
  // 현황
  const now = src.slice(src.indexOf('id={`now-room-${r.id}`}', src.indexOf("const f = nowFlags(b, today")));
  assert.ok(now.indexOf('slot="top"') < now.indexOf('className="nm"'));
  assert.ok(now.indexOf('className="nm"') < now.indexOf('slot="who"'));
  // 대표객실 글자는 leadTag(isLeadRoom)만
  assert.equal((src.match(/>\s*대표객실\s*</g) ?? []).length, 1);
});

test("카드 · 이름 바꾸기: 화면에는 `룸 타임라인`이 남지 않아요 (월간 예약)", () => {
  for (const f of ["Dashboard.tsx", "RoomCalendar.tsx", "Settings.tsx"]) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /룸 타임라인/, f);
  }
  assert.match(readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8"), /<h1>월간 예약<\/h1>/);
});
