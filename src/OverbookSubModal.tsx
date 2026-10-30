import { useEffect, useMemo, useState } from "react";
import { dayLabel, typeLabel, type HotelSettings, type RoomType } from "../shared/ledger";
import {
  OVERBOOK_SUB_CLEAR,
  OVERBOOK_SUB_SAVE,
  OVERBOOK_SUB_TITLE,
  clearSubsForNight,
  planOverbookSubs,
  qtyGivenTo,
  setSubsForNight,
  subsForNight,
  type OverbookSub,
  type OverbookSubAlloc,
} from "../shared/overbookSub";
import { Stepper } from "./primitives";

/**
 * 오버부킹 −N → 지정 대체 객실 (타입 여유 차감).
 * Geometry: 모달만 · 보드 칸 무변경.
 */
export default function OverbookSubModal({
  s,
  overType,
  date,
  /** remaining map for this night WITHOUT this overType's current night subs */
  spareByType,
  /** over type rem without this night's relief (typically negative) */
  overRem,
  subs,
  busy,
  onCancel,
  onSave,
}: {
  s: HotelSettings;
  overType: RoomType;
  date: string;
  spareByType: ReadonlyMap<string, number>;
  overRem: number;
  subs: readonly OverbookSub[];
  busy?: boolean;
  onCancel: () => void;
  onSave: (next: OverbookSub[]) => void;
}) {
  const need = Math.max(0, -overRem);
  const existing = useMemo(() => subsForNight(subs, overType.id, date), [subs, overType.id, date]);
  const had = existing.length > 0;
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);

  const candidates = useMemo(() => {
    return s.types.filter((t) => {
      if (t.id === overType.id) return false;
      const spare = spareByType.get(t.id) ?? 0;
      const prev = existing.find((x) => x.fromTypeId === t.id)?.qty ?? 0;
      return spare > 0 || prev > 0 || (qtyMap[t.id] ?? 0) > 0;
    });
  }, [s.types, overType.id, spareByType, existing, qtyMap]);

  useEffect(() => {
    const init: Record<string, number> = {};
    for (const t of s.types) {
      if (t.id === overType.id) continue;
      init[t.id] = existing.find((x) => x.fromTypeId === t.id)?.qty ?? 0;
    }
    setQtyMap(init);
    setErr(null);
    // 3초/10초 재조회로 배열 참조가 바뀌어도 편집 중인 수량을 초기화하지 않는다.
    // 날짜·대상 타입을 바꿨을 때만 새 저장값으로 시작한다.
  }, [overType.id, date]);

  const allocs: OverbookSubAlloc[] = useMemo(
    () =>
      Object.entries(qtyMap)
        .filter(([, q]) => q > 0)
        .map(([fromTypeId, qty]) => ({ fromTypeId, qty })),
    [qtyMap],
  );

  const total = allocs.reduce((n, a) => n + a.qty, 0);
  const left = Math.max(0, need - total);

  const setQty = (typeId: string, qty: number) => {
    const spare = spareByType.get(typeId) ?? 0;
    const max = need > 0 ? Math.min(spare, need) : spare;
    setQtyMap((m) => ({ ...m, [typeId]: Math.max(0, Math.min(max, qty)) }));
  };

  const submit = () => {
    if (busy) return;
    const planned = planOverbookSubs({
      overTypeId: overType.id,
      date,
      overRem,
      spareByType,
      allocs,
    });
    if ("err" in planned) {
      setErr(planned.err);
      return;
    }
    setErr(null);
    onSave(setSubsForNight(subs, overType.id, date, planned.ok));
  };

  const clear = () => {
    if (busy || !had) return;
    onSave(clearSubsForNight(subs, overType.id, date));
  };

  return (
    <div
      className="dim assign-type-dim"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
    >
      <div
        className="modal assign-type-modal add-time-modal overbook-sub-modal"
        role="dialog"
        aria-label={OVERBOOK_SUB_TITLE}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>{OVERBOOK_SUB_TITLE}</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p>
            <b>{typeLabel(overType)}</b> · {dayLabel(date)}
          </p>
          <p className="muted sm">
            {need > 0 ? (
              <>
                초과 <b className="num tred">−{need}</b>
                {had ? (
                  <>
                    {" "}
                    · 지정 중 <b className="num">{qtyGivenTo(subs, overType.id, date)}</b>
                  </>
                ) : null}
              </>
            ) : had ? (
              <>초과 해소됨 · 지정 유지 중</>
            ) : (
              <>초과 없음</>
            )}
          </p>
          {candidates.length === 0 ? (
            <p className="muted sm">여유 있는 다른 타입이 없어요</p>
          ) : (
            <ul className="overbook-sub-list">
              {candidates.map((t) => {
                const spare = spareByType.get(t.id) ?? 0;
                const q = qtyMap[t.id] ?? 0;
                const max = need > 0 ? Math.min(spare, need) : spare;
                return (
                  <li key={t.id} className="overbook-sub-row">
                    <div className="overbook-sub-meta">
                      <b>{typeLabel(t)}</b>
                      <span className="muted sm">여유 {spare}</span>
                    </div>
                    <Stepper
                      value={q}
                      unit="실"
                      min={0}
                      max={Math.max(0, max)}
                      disabled={busy}
                      onChange={(n) => setQty(t.id, n)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {need > 0 ? (
            <p className="muted sm">
              지정 {total} · 잔여 초과 {left}
            </p>
          ) : null}
          {err ? <p className="tred sm">{err}</p> : null}
        </div>
        <div className="mf">
          {had ? (
            <button type="button" className="btn stop" disabled={busy} onClick={clear}>
              {OVERBOOK_SUB_CLEAR}
            </button>
          ) : (
            <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>
              취소
            </button>
          )}
          <button type="button" className="btn green" disabled={busy || (total === 0 && !had)} onClick={submit}>
            {OVERBOOK_SUB_SAVE}
          </button>
        </div>
      </div>
    </div>
  );
}

/** spare map helper for modal — strip this over night's subs from settings first */
export function spareMapForOverNight(
  remByType: ReadonlyMap<string, number>,
  subs: readonly OverbookSub[],
  overTypeId: string,
  date: string,
): { spareByType: Map<string, number>; overRem: number } {
  const given = qtyGivenTo(subs, overTypeId, date);
  // rem already includes +given on over and −qty on froms for this night.
  // Undo this night's relief to get "raw" spare / over.
  const spareByType = new Map<string, number>();
  for (const [tid, rem] of remByType) {
    let v = rem;
    for (const x of subs) {
      if (x.date !== date || x.overTypeId !== overTypeId) continue;
      if (x.fromTypeId === tid) v += x.qty; // add back deducted spare
    }
    spareByType.set(tid, v);
  }
  const overRem = (remByType.get(overTypeId) ?? 0) - given;
  return { spareByType, overRem };
}
