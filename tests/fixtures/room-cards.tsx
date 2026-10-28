// Real Dashboard and styles; only the data source and action callbacks are fixtures.
import { createRoot } from "react-dom/client";
import Dashboard from "../../src/Dashboard";
import { normalizeSettings } from "../../shared/ledger";
import { CARD_CASES, TODAY, pay } from "../../shared/roomCardCases";
import type { HotelData } from "../../src/data";
import "../../src/styles.css";
import "../../src/room-card-frame.css";

const bookings = CARD_CASES.filter(c => !c.boardOnly).map(c => ({
  ...c.b, id: c.id, roomId: `room-${c.id}`, typeId: "t",
  platformId: c.plat?.onsite ? "onsite" : "ota",
  groupId: c.expect.lead || c.expect.member ? "fixture-group" : null,
  ...(c.id === "C09" ? {
    guestName: "Alexandria-Christine 김수현 山田太郎",
    company: "International Hospitality Corporation 국제호텔운영회사 아주 긴 회사명",
    payments: [pay("card", 50000), pay("cash", 60000), pay("transfer", 30000)],
  } : {}),
}));
const rooms = [...bookings.map((b, i) => ({ id: b.roomId!, no: String(701 + i), typeId: "t" })), { id: "empty", no: "801", typeId: "t" }];
const settings = normalizeSettings({
  types: [{ id: "t", name: "스탠다드 Standard Twin", abbr: "ST" }],
  platforms: [{ id: "onsite", name: "현장", abbr: "현", onsite: true }, { id: "ota", name: "Booking.com", abbr: "B", onsite: false }],
  floors: [
    { id: "f7", name: "7층", rooms: rooms.slice(0, 7) },
    { id: "f6", name: "6층", rooms: rooms.slice(7, 14) },
    { id: "f5", name: "5층", rooms: rooms.slice(14) },
  ],
});
const lead = CARD_CASES.find(c => c.expect.lead)!;
const state = {
  hotel: { id: "00000000-0000-0000-0000-000000000001", name: "Card QA", plan: "pro", settings },
  bookings, changes: [], groups: new Map([["fixture-group", { ...lead.info, id: "fixture-group", leadBookingId: "C10" }]]),
  stayCredits: [], syncedAt: 0, meId: "fixture-user",
};
const data = new Proxy(state, { get(target, key) {
  if (key in target) return Reflect.get(target, key);
  return async () => { throw new Error(`Fixture forbids data mutation: ${String(key)}`); };
} }) as unknown as HotelData;
const action = (message: string) => { document.getElementById("fixture-action")!.textContent = message; };
createRoot(document.getElementById("root")!).render(
  <Dashboard data={data} today={TODAY} selDate={TODAY} setSelDate={() => {}}
    onOpen={(b) => action(`open:${b.id}`)} onNew={() => action("new")}
    notify={() => {}} />,
);
