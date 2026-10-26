/** 객실 배치도 A4 print helpers (Settings layout → print). P0 layout only. */

import {
  type Floor,
  type HotelSettings,
  type Room,
  buildingName,
  isMultiBuilding,
  orderedFloors,
  typeLabel,
} from "./ledger";

export type FloorPlanRoomCell = {
  id: string;
  no: string;
  typeAbbr: string;
};

export type FloorPlanFloorRow = {
  id: string;
  name: string;
  rooms: FloorPlanRoomCell[];
};

export type FloorPlanBuildingSection = {
  buildingId: string;
  buildingLabel: string;
  floors: FloorPlanFloorRow[];
};

function typeAbbr(s: HotelSettings, typeId: string | null): string {
  if (!typeId) return "";
  const t = s.types.find((x) => x.id === typeId);
  const name = typeLabel(t);
  if (!name) return "";
  return name.length <= 4 ? name : name.slice(0, 4);
}

function floorRow(s: HotelSettings, f: Floor): FloorPlanFloorRow {
  const rooms: FloorPlanRoomCell[] = f.rooms.map((r: Room) => ({
    id: r.id,
    no: r.no,
    typeAbbr: typeAbbr(s, r.typeId),
  }));
  return { id: f.id, name: f.name || "층", rooms };
}

/** Build print sections: one per building (multi) or a single unlabeled section. */
export function buildFloorPlanSections(s: HotelSettings): FloorPlanBuildingSection[] {
  const multi = isMultiBuilding(s);
  const floors = orderedFloors(s).filter((f) => f.rooms.length > 0);
  if (!floors.length) return [];
  if (!multi) {
    return [
      {
        buildingId: s.buildings[0]?.id ?? "default",
        buildingLabel: "",
        floors: floors.map((f) => floorRow(s, f)),
      },
    ];
  }
  const byB = new Map<string, Floor[]>();
  for (const f of floors) {
    const list = byB.get(f.buildingId) ?? [];
    list.push(f);
    byB.set(f.buildingId, list);
  }
  return s.buildings
    .map((b) => {
      const fl = byB.get(b.id);
      if (!fl?.length) return null;
      return {
        buildingId: b.id,
        buildingLabel: buildingName(s, b.id) || b.name || "건물",
        floors: fl.map((f) => floorRow(s, f)),
      } satisfies FloorPlanBuildingSection;
    })
    .filter((x): x is FloorPlanBuildingSection => !!x);
}

export function floorPlanRoomCount(sections: FloorPlanBuildingSection[]): number {
  return sections.reduce((n, b) => n + b.floors.reduce((m, f) => m + f.rooms.length, 0), 0);
}

export const FLOOR_PLAN_COPY = {
  title: "객실 배치도",
  print: "인쇄",
  pdf: "PDF",
  pdfHint: "인쇄 창에서「PDF로 저장」을 고르세요",
  close: "닫기",
  empty: "설정에 방이 없어요. 객실 배치에서 층을 먼저 만들어 주세요.",
  noteHint: "빈칸은 현장 메모용",
  roomCount: (n: number) => `총 ${n}실`,
} as const;
