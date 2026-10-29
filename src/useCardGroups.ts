import { useEffect, useMemo, useState } from "react";
import type { Booking } from "../shared/ledger";
import { emptyRegistry, registerCardGroups, type GroupRegistry } from "../shared/detailedRoomCard";

function readRegistry(key: string): GroupRegistry {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!v || !v.groups || typeof v.groups !== "object" || Array.isArray(v.groups)) return emptyRegistry();
    const entries = Object.entries(v.groups).filter(([, g]: [string, any]) => Number.isSafeInteger(g?.number) && g.number > 0 && Array.isArray(g.members) && g.members.every((id: unknown) => typeof id === "string"));
    if (new Set(entries.map(([, g]: [string, any]) => g.number)).size !== entries.length) return emptyRegistry();
    return { groups: Object.fromEntries(entries) } as GroupRegistry;
  } catch { return emptyRegistry(); }
}

/** 기존 기기별 UI 설정과 같은 localStorage. 예약의 정식 ID는 항상 DB의 UUID다. */
export function useCardGroups(hotelId: string, bookings: readonly Booking[]) {
  const key = `hotori.roomCards.groups.${hotelId}`;
  const [stored, setStored] = useState(() => ({ key, registry: readRegistry(key) }));
  const registry = useMemo(() => registerCardGroups(stored.key === key ? stored.registry : readRegistry(key), bookings), [stored, key, bookings]);
  useEffect(() => {
    if (stored.key !== key || registry !== stored.registry) {
      setStored({ key, registry });
      try { localStorage.setItem(key, JSON.stringify(registry)); } catch { /* 저장 불가 환경에서도 예약은 표시한다. */ }
    }
  }, [key, registry, stored]);
  return registry;
}
