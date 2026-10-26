import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptySettings } from "./ledger.ts";
import { buildFloorPlanSections, floorPlanRoomCount } from "./floorPlanPrint.ts";

describe("floorPlanPrint", () => {
  it("empty settings → no sections", () => {
    const s = emptySettings();
    assert.deepEqual(buildFloorPlanSections(s), []);
    assert.equal(floorPlanRoomCount([]), 0);
  });

  it("single building floors → one section without label", () => {
    const s = emptySettings();
    const bid = s.buildings[0].id;
    s.floors = [
      {
        id: "f1",
        name: "6층",
        buildingId: bid,
        color: null,
        rooms: [
          { id: "r1", no: "601", typeId: null },
          { id: "r2", no: "602", typeId: null },
        ],
      },
    ];
    const sec = buildFloorPlanSections(s);
    assert.equal(sec.length, 1);
    assert.equal(sec[0].buildingLabel, "");
    assert.equal(sec[0].floors[0].rooms.map((r) => r.no).join(","), "601,602");
    assert.equal(floorPlanRoomCount(sec), 2);
  });

  it("multi building → labeled sections", () => {
    const s = emptySettings();
    s.buildings = [
      { id: "b1", name: "본관" },
      { id: "b2", name: "별관" },
    ];
    s.types = [{ id: "t1", name: "스탠다드디럭스" }];
    s.floors = [
      {
        id: "f1",
        name: "1층",
        buildingId: "b1",
        color: null,
        rooms: [{ id: "r1", no: "101", typeId: "t1" }],
      },
      {
        id: "f2",
        name: "1층",
        buildingId: "b2",
        color: null,
        rooms: [{ id: "r2", no: "201", typeId: null }],
      },
    ];
    const sec = buildFloorPlanSections(s);
    assert.equal(sec.length, 2);
    assert.equal(sec[0].buildingLabel, "본관");
    assert.equal(sec[0].floors[0].rooms[0].typeAbbr, "스탠다드");
    assert.equal(sec[1].buildingLabel, "별관");
  });
});
