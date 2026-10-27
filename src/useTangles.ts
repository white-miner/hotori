import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";
import { type Tangle, findTangles, newTangles, visibleTangles } from "../shared/tangles";
import { lookups } from "./ui";
import type { HotelData } from "./data";

/**
 * 확인 필요: 불러온 예약으로 계산하고, "이대로 둠"은 tangle_states에 기억해요 (표가 없으면 이 기기에서만).
 * 막는 일은 없어요. 겹침·중복이 새로 생기면 한 번 알려 줘요.
 */
export function useTangles(data: HotelData, hotelId: string, today: string, notify: (m: string) => void) {
  const settings = data.hotel?.settings ?? null;
  const [ignored, setIgnored] = useState<Map<string, string>>(new Map());
  const L = useMemo(() => (settings ? lookups(settings) : null), [settings]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await supabase.from("tangle_states").select("key,signature,state").eq("hotel_id", hotelId);
        if (!alive || r.error || !r.data) return;
        setIgnored(new Map(r.data.filter((x) => x.state === "ignored").map((x) => [x.key as string, x.signature as string])));
      } catch {
        /* 표가 없으면 이 화면에서만 기억해요 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [hotelId]);

  const all = useMemo(
    () =>
      L
        ? findTangles(data.bookings, {
            today,
            label: (id) => (id ? L.roomLabel(id) ?? id : "?"),
            plat: (id) => L.plats.get(id) ?? null,
            group: (id) => data.groups.get(id) ?? null,
          })
        : [],
    [data.bookings, data.groups, L, today],
  );
  const visible = useMemo(() => visibleTangles(all, ignored), [all, ignored]);

  // 겹침·중복이 새로 생겼을 때만 한 번 (처음 불러온 상태는 기준선)
  const base = useRef<Tangle[] | null>(null);
  useEffect(() => {
    const prev = base.current;
    base.current = all;
    if (!prev) return;
    const fresh = newTangles(prev, all).filter((t) => t.rule === "T08" || t.rule === "T11");
    if (fresh.length) notify(`${fresh[0]!.title}${fresh.length > 1 ? ` 외 ${fresh.length - 1}건` : ""} · 저장은 그대로 됐어요 · 확인 필요에서 볼 수 있어요`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

  const ignore = useCallback(
    async (list: readonly Tangle[]) => {
      if (!list.length) return;
      setIgnored((m) => {
        const n = new Map(m);
        for (const t of list) n.set(t.key, t.signature);
        return n;
      });
      try {
        await supabase
          .from("tangle_states")
          .upsert(list.map((t) => ({ hotel_id: hotelId, key: t.key, signature: t.signature, state: "ignored" })), { onConflict: "hotel_id,key" });
      } catch {
        /* 기억만 못 할 뿐 화면은 그대로 */
      }
    },
    [hotelId],
  );
  const restoreAll = useCallback(async () => {
    setIgnored(new Map());
    try {
      await supabase.from("tangle_states").delete().eq("hotel_id", hotelId);
    } catch {
      /* ignore */
    }
  }, [hotelId]);

  const ignoredCount = all.length - visible.length;
  return { visible, ignoredCount, ignore, restoreAll };
}
