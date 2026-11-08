import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, { url: "http://127.0.0.1/" });
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  Node: dom.window.Node,
  navigator: dom.window.navigator,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

const { createElement, useRef, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { normalizeSettings } = await import("../shared/ledger.ts");
const { default: SmartRegister } = await import("./SmartRegister.tsx");

const FIRST = [
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

const SECOND = [
  "예약 번호",
  "2000000002",
  "확정된 예약",
  "투숙객",
  "Ari Stone",
  "성인",
  "3명",
  "연락처",
  "010-1111-2222",
  "객실 종류 및 혜택",
  "1 X 디럭스",
  "체크인",
  "2026년 12월 1일 15:00",
  "체크아웃",
  "2026년 12월 3일 11:00",
  "박수",
  "2",
  "기준 판매 요금(세금 및 수수료 포함)",
  "KRW 180,000",
].join("\n");

type Api = {
  refresh: () => void;
  emptyLate: () => void;
  failSave: { current: boolean };
  saves: { current: string[] };
  writes: { current: number };
};

function Host() {
  const [s, setS] = useState(() =>
    normalizeSettings({
      platforms: [{ id: "p-ag", name: "아고다", abbr: "아" }],
      types: [{ id: "std", name: "스탠다드" }],
      stayTimes: { checkIn: "16:00", checkOut: "12:00" },
    }),
  );
  const failSave = useRef(true);
  const saves = useRef<string[]>([]);
  const writes = useRef(0);
  const api: Api = {
    refresh() {
      setS((cur) => normalizeSettings({ ...cur, pasteTemplates: cur.pasteTemplates.map((t) => ({ ...t, labels: { ...t.labels } })) }));
    },
    emptyLate() {
      setS((cur) => normalizeSettings({ ...cur, pasteTemplates: [] }));
    },
    failSave,
    saves,
    writes,
  };
  (dom.window as unknown as { __hotori: Api }).__hotori = api;
  return createElement(SmartRegister, {
    data: {
      bookings: [],
      async saveHotel(input: { settings?: { pasteTemplates?: unknown } }) {
        if (failSave.current) throw new Error("저장 실패");
        saves.current.push(JSON.stringify(input.settings?.pasteTemplates ?? []));
        setS(normalizeSettings(input.settings ?? {}));
      },
      async saveBooking() {
        writes.current += 1;
        return {};
      },
    },
    s,
    today: "2026-11-08",
    tabs: null,
    banner: null,
    notify: () => {},
    onOpenBooking: () => {},
  } as never);
}

function bridge() {
  return (dom.window as unknown as { __hotori: Api }).__hotori;
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
}

function fieldButton(id: string) {
  const el = document.querySelector(`[data-field="${id}"]`);
  if (!el) throw new Error(`없는 칸 ${id}`);
  return el;
}

function lineButton(text: string) {
  const el = [...document.querySelectorAll(".paste-template-values button")].find((node) => node.querySelector("b")?.textContent === text);
  if (!el) throw new Error(`없는 줄 ${text} :: ${[...document.querySelectorAll(".paste-template-values b")].map((n) => n.textContent).join(" | ")}`);
  return el;
}

async function pick(id: string, line: string) {
  await click(fieldButton(id));
  await click(lineButton(line));
}

function fieldText() {
  return [...document.querySelectorAll("[data-field]")].map((el) => `${el.getAttribute("data-field")}:${el.textContent?.replace(/\s+/g, " ").trim()}`).join("\n");
}

async function paste(text: string) {
  const area = document.querySelector("textarea");
  if (!area) throw new Error("붙여넣기 칸 없음");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(area, text);
    area.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

test("스마트등록 화면에서 항목을 순서대로 지정해도 인원과 이전 값이 남는다", async () => {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  await act(async () => {
    root.render(createElement(Host));
  });
  const open = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
  if (!open) throw new Error("양식 설정 버튼 없음");
  await click(open);
  await paste(FIRST);

  await pick("adults", "2명");
  await pick("guestName", "Mina Park");
  await act(async () => {
    bridge().emptyLate();
  });
  await act(async () => {
    bridge().refresh();
  });
  let shown = fieldText();
  assert.match(shown, /adults:인원 · 2/);
  assert.match(shown, /guestName:이름 · Mina Park/);

  await pick("statusRaw", "확정된 예약");
  await pick("guestPhone", "010-0000-0000");
  await pick("typeRaw", "1 X 스탠다드");
  await pick("checkIn", "2026년 11월 7일 16:00");
  await pick("checkInTime", "2026년 11월 7일 16:00");
  await pick("checkOut", "2026년 11월 9일 12:00");
  await pick("checkOutTime", "2026년 11월 9일 12:00");
  await pick("nights", "2");
  await pick("salesTotal", "KRW 210,000");
  await pick("reservationId", "1000000001");
  await act(async () => {
    bridge().refresh();
  });
  shown = fieldText();
  for (const piece of [
    "adults:인원 · 2",
    "guestName:이름 · Mina Park",
    "statusRaw:상태 · 확정된 예약",
    "guestPhone:전화 · 010-0000-0000",
    "checkIn:입실 · 2026-11-07 16:00",
    "checkInTime:입실 시각 · 16:00",
    "salesTotal:판매금 · KRW 210000",
    "currency:통화",
    "reservationId:예약번호 · 1000000001",
  ]) {
    assert.ok(shown.includes(piece), `${piece}\n${shown}`);
  }

  const save = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "계정에 저장");
  if (!save) throw new Error("저장 버튼 없음");
  await click(save);
  assert.equal(bridge().saves.current.length, 0);
  assert.match(fieldText(), /guestName:이름 · Mina Park/);
  assert.match(fieldText(), /adults:인원 · 2/);

  bridge().failSave.current = false;
  await click(save);
  const stored = bridge().saves.current.at(-1) ?? "";
  assert.equal(stored.includes("Mina Park"), false);
  assert.equal(stored.includes("1000000001"), false);
  assert.equal(stored.includes("010-0000-0000"), false);
  assert.equal(stored.includes("210000"), false);
  assert.equal(stored.includes("2명"), false);
  assert.match(stored, /성인/);
  assert.match(stored, /투숙객/);
  assert.equal(bridge().writes.current, 0);

  const close = document.querySelector('[aria-label="닫기"]');
  if (!close) throw new Error("닫기 없음");
  await click(close);
  assert.equal(document.querySelector("[data-field]"), null);
  const reopen = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
  if (!reopen) throw new Error("다시 열기 없음");
  await click(reopen);
  shown = fieldText();
  assert.match(shown, /guestName:이름 · Mina Park/);
  assert.match(shown, /adults:인원 · 2/);

  await paste(SECOND);
  shown = fieldText();
  assert.match(shown, /guestName:이름 · Ari Stone/);
  assert.match(shown, /adults:인원 · 3/);
  assert.match(shown, /checkIn:입실 · 2026-12-01 15:00/);
  assert.match(shown, /salesTotal:판매금 · KRW 180000/);
  assert.match(shown, /reservationId:예약번호 · 2000000002/);
  assert.equal(bridge().writes.current, 0);

  await act(async () => {
    root.unmount();
  });
});

test("한글 이름과 객실명은 위 칸 이름으로 연결되고 다음 글의 값으로 바뀐다", async () => {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  await act(async () => {
    root.render(createElement(Host));
  });
  const open = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
  if (!open) throw new Error("양식 설정 버튼 없음");
  await click(open);
  const text = [
    "예약 번호",
    "HOTORI-UI-TEST-20261108",
    "투숙객 이름",
    "테스트손님",
    "성인",
    "2",
    "체크인",
    "2026년 12월 1일 (16:00)",
    "체크아웃",
    "2026년 12월 3일 (11:00)",
    "기준 판매 요금",
    "KRW 180,000",
    "객실 종류 및 혜택",
    "테스트 객실",
  ].join("\n");
  await paste(text);
  await pick("guestName", "테스트손님");
  await pick("typeRaw", "테스트 객실");
  await pick("adults", "2");
  await pick("salesTotal", "KRW 180,000");
  await pick("checkIn", "2026년 12월 1일 (16:00)");
  await pick("checkOut", "2026년 12월 3일 (11:00)");
  let shown = fieldText();
  assert.match(shown, /guestName:이름 · 테스트손님/);
  assert.match(shown, /typeRaw:타입 · 테스트 객실/);
  assert.match(shown, /adults:인원 · 2/);
  assert.match(shown, /salesTotal:판매금 · KRW 180000/);
  assert.equal(document.body.textContent?.includes("칸 이름이 없어요"), false);
  bridge().failSave.current = false;
  const save = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "계정에 저장");
  if (!save) throw new Error("저장 버튼 없음");
  await click(save);
  const stored = bridge().saves.current.at(-1) ?? "";
  assert.equal(stored.includes("테스트손님"), false);
  assert.equal(stored.includes("테스트 객실"), false);
  assert.match(stored, /투숙객 이름/);
  assert.match(stored, /객실 종류 및 혜택/);
  const next = text.replace("테스트손님", "다른손님").replace("테스트 객실", "다른 객실").replace("HOTORI-UI-TEST-20261108", "HOTORI-UI-TEST-NEXT").replace("180,000", "90,000").replace("성인\n2", "성인\n5");
  await paste(next);
  shown = fieldText();
  assert.match(shown, /guestName:이름 · 다른손님/);
  assert.match(shown, /typeRaw:타입 · 다른 객실/);
  assert.match(shown, /adults:인원 · 5/);
  assert.match(shown, /salesTotal:판매금 · KRW 90000/);
  assert.equal(bridge().writes.current, 0);
  await act(async () => {
    root.unmount();
  });
});

test("같은 줄의 일부 선택과 반복된 2는 고른 칸만 연결하고 다음 선택을 덮지 않는다", async () => {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  await act(async () => {
    root.render(createElement(Host));
  });
  const open = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
  if (!open) throw new Error("양식 설정 버튼 없음");
  await click(open);
  const text = ["예약자: 홍길동", "객실 종류: 디럭스 더블", "도착일: 2026-12-05", "판매가: KRW 90,000", "숙박 기간: 2", "성인: 2"].join("\n");
  await paste(text);
  const area = document.querySelector(".paste-template-sample textarea") as HTMLTextAreaElement;
  const select = async (needle: string, which: number) => {
    let from = 0;
    let at = -1;
    for (let n = 0; n <= which; n++) {
      at = area.value.indexOf(needle, from);
      from = at + needle.length;
    }
    area.focus();
    area.setSelectionRange(at, at + needle.length);
    area.dispatchEvent(new dom.window.Event("select", { bubbles: true }));
    area.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
  };
  const down = async (field: string) => {
    const el = document.querySelector(`[data-field="${field}"]`);
    if (!el) throw new Error(field);
    await act(async () => {
      el.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
    });
  };
  await select("홍길동", 0);
  await down("guestName");
  const adultMark = area.value.lastIndexOf("성인: ");
  area.focus();
  area.setSelectionRange(adultMark + "성인: ".length, adultMark + "성인: ".length + 1);
  area.dispatchEvent(new dom.window.Event("select", { bubbles: true }));
  area.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
  await down("adults");
  await down("typeRaw");
  let shown = fieldText();
  assert.match(shown, /guestName:이름 · 홍길동/);
  assert.match(shown, /adults:인원 · 2/);
  assert.equal(shown.includes("typeRaw:타입 ·"), false);
  await select("디럭스 더블", 0);
  const typeBtn = document.querySelector('[data-field="typeRaw"]');
  if (!typeBtn) throw new Error("타입 없음");
  await act(async () => {
    typeBtn.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await pick("checkIn", "2026-12-05");
  await pick("salesTotal", "KRW 90,000");
  shown = fieldText();
  assert.match(shown, /typeRaw:타입 · 디럭스 더블/);
  assert.match(shown, /checkIn:입실 · 2026-12-05/);
  assert.match(shown, /salesTotal:판매금 · KRW 90000/);
  bridge().failSave.current = true;
  const save = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "계정에 저장");
  if (!save) throw new Error("저장 없음");
  await click(save);
  assert.match(fieldText(), /guestName:이름 · 홍길동/);
  bridge().failSave.current = false;
  await click(save);
  const stored = bridge().saves.current.at(-1) ?? "";
  assert.equal(stored.includes("홍길동"), false);
  assert.equal(stored.includes("디럭스"), false);
  const close = document.querySelector('[aria-label="닫기"]');
  if (!close) throw new Error("닫기 없음");
  await click(close);
  const reopen = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
  if (!reopen) throw new Error("다시 열기 없음");
  await click(reopen);
  await paste(["예약자: 김테스트", "객실 종류: 온돌", "도착일: 2027-03-09", "판매가: KRW 70,000", "성인: 4"].join("\n"));
  shown = fieldText();
  assert.match(shown, /guestName:이름 · 김테스트/);
  assert.match(shown, /typeRaw:타입 · 온돌/);
  assert.match(shown, /checkIn:입실 · 2027-03-09/);
  assert.match(shown, /salesTotal:판매금 · KRW 70000/);
  assert.match(shown, /adults:인원 · 4/);
  assert.equal(bridge().writes.current, 0);
  await act(async () => {
    root.unmount();
  });
});
