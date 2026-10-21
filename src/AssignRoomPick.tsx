import { type HotelSettings, assignableRooms, typeLabel } from "../shared/ledger";
import type { lookups } from "./ui";

type L = ReturnType<typeof lookups>;

/**
 * 미배정 → 호실 칩. 본관·별관 **하나의 목록** (건물 탭/필터로 한쪽 숨김 금지).
 * 다건물이면 칩에 건물 접두어만 붙임. slice 상한 없음 — 패널 max-height 스크롤.
 */
export default function AssignRoomPick({
  s,
  L,
  free,
  typeId,
  multi,
  onPick,
  dense,
}: {
  s: HotelSettings;
  L: L;
  free: Set<string>;
  typeId: string | null | undefined;
  multi: boolean;
  onPick: (roomId: string) => void;
  /** 운영 패널 밀도용 (빈 상태 카피만) */
  dense?: boolean;
}) {
  const rooms = assignableRooms(s, free, typeId);
  if (!rooms.length) {
    return <span className={dense ? "muted sm" : "muted"}>그 기간에 빈 방이 없어요</span>;
  }

  return (
    <>
      {rooms.map((r) => (
        <button
          key={r.id}
          type="button"
          className={`rchip ${r.typeId !== typeId ? "other" : ""}`}
          title={L.roomLabel(r.id) ?? r.no}
          onClick={() => onPick(r.id)}
        >
          {multi ? <em className="bpre">{L.buildings.get(r.buildingId)?.name ?? ""}</em> : null}
          {r.no}
          {r.typeId !== typeId ? <i>{typeLabel(L.types.get(r.typeId ?? ""))}</i> : null}
        </button>
      ))}
    </>
  );
}
