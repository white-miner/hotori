import { useEffect, useMemo, useState } from "react";
import { type Booking, type HotelSettings, allRooms, freeRooms } from "../shared/ledger";
import { type AutoAssignItem, planAutoAssign } from "../shared/autoAssign";
import { type lookups, TypeBadge, PlatBadge } from "./ui";

type L = ReturnType<typeof lookups>;
const md = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;

/**
 * 자동 배정 미리보기 — 아직 아무것도 저장하지 않아요.
 * 같은 타입 빈 방에만 넣고, 줄마다 방을 바꾸거나 빼 둘 수 있어요. 「배정하기」를 눌러야 저장돼요.
 */
export default function AutoAssignModal({
  s,
  L,
  bookings,
  targets,
  busy,
  onClose,
  onApply,
}: {
  s: HotelSettings;
  L: L;
  bookings: Booking[];
  targets: Booking[];
  busy: boolean;
  onClose: () => void;
  onApply: (items: AutoAssignItem[]) => void;
}) {
  const [allowSplit, setAllowSplit] = useState(false);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [over, setOver] = useState<Map<string, string>>(new Map());
  const plan = useMemo(() => planAutoAssign(s, bookings, targets, { allowSplit }), [s, bookings, targets, allowSplit]);
  useEffect(() => {
    setOff(new Set());
    setOver(new Map());
  }, [allowSplit]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const byId = useMemo(() => new Map(bookings.map((b) => [b.id, b])), [bookings]);
  const rows = useMemo(
    () =>
      plan.items.map((it) => {
        const o = over.get(it.bookingId);
        return o ? { ...it, roomId: o, segments: null } : it;
      }),
    [plan, over],
  );
  const active = rows.filter((r) => !off.has(r.bookingId));
  /** 줄마다: 다른 줄이 가져간 방·막힌 방은 고를 수 없게 */
  const free = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of active) {
      const b = byId.get(r.bookingId);
      if (!b) continue;
      const others = new Map(active.filter((x) => x.bookingId !== r.bookingId).map((x) => [x.bookingId, x]));
      const virt = bookings.map((x) => {
        const p = others.get(x.id);
        return p ? { ...x, roomId: p.roomId, segments: p.segments } : x;
      });
      m.set(r.bookingId, freeRooms(s, virt, b));
    }
    return m;
  }, [active, bookings, byId, s]);
  const bad = (r: AutoAssignItem) => {
    const f = free.get(r.bookingId);
    if (!f) return false;
    if (r.segments) return false; // 구간 배정은 계획 단계에서 검증됨
    return !f.has(r.roomId);
  };
  const okCount = active.filter((r) => !bad(r)).length;
  const scatteredN = active.filter((r) => r.scattered).length;

  const typeRooms = (typeId: string) => allRooms(s).filter((r) => r.typeId === typeId);

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal aa-modal" role="dialog" aria-label="자동 배정 미리보기" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mh">
          <h2>자동 배정 미리보기</h2>
          <button type="button" className="x" aria-label="닫기" onClick={onClose} disabled={busy}>
            닫기
          </button>
        </div>
        <p className="aa-lead">
          같은 타입 빈 방에만 넣어요. 이미 배정된 예약은 그대로예요. <b>「배정하기」</b>를 누르기 전에는 아무것도 바뀌지 않아요.
        </p>
        <label className="aa-opt">
          <input type="checkbox" checked={allowSplit} onChange={(e) => setAllowSplit(e.target.checked)} />
          <span>
            <b>방 나눠 배정 허용</b> · 연박이 한 방에 안 들어가면 중간에 방을 옮겨 이어 줘요 (최대 3구간)
          </span>
        </label>
        <div className="aa-sum" aria-live="polite">
          <span>
            배정 <b>{okCount}</b>건
          </span>
          <span className={plan.skipped.length ? "warn" : ""}>
            못 넣음 <b>{plan.skipped.length}</b>건
          </span>
          {scatteredN ? <span className="warn">단체 흩어짐 {scatteredN}건</span> : null}
        </div>

        <div className="aa-list" role="list">
          {rows.map((r) => {
            const b = byId.get(r.bookingId);
            if (!b) return null;
            const on = !off.has(r.bookingId);
            const isBad = on && bad(r);
            return (
              <div key={r.bookingId} role="listitem" className={`aa-row ${on ? "" : "off"} ${isBad ? "bad" : ""}`}>
                <input
                  type="checkbox"
                  className="aa-ck"
                  checked={on}
                  aria-label={`${b.guestName} 배정 포함`}
                  onChange={() =>
                    setOff((p) => {
                      const n = new Set(p);
                      if (n.has(r.bookingId)) n.delete(r.bookingId);
                      else n.add(r.bookingId);
                      return n;
                    })
                  }
                />
                <div className="aa-who">
                  <b>
                    <TypeBadge t={L.types.get(b.typeId)} />
                    <PlatBadge p={L.plats.get(b.platformId)} />
                    <span className="gn">{b.guestName}</span>
                    {b.groupId ? <em className="aa-grp">단체</em> : null}
                  </b>
                  <span>
                    {md(b.checkIn)} 입실 · {b.nights}박
                    {r.scattered ? <i className="aa-warn"> · 같은 층에 못 모았어요</i> : null}
                    {isBad ? <i className="aa-warn"> · 방이 겹쳐요 — 다른 방을 고르세요</i> : null}
                  </span>
                </div>
                <span className="aa-arrow" aria-hidden>
                  →
                </span>
                {r.segments ? (
                  <div className="aa-segs" title="방 나눠 배정">
                    {r.segments.map((x, i) => (
                      <span key={i}>
                        {L.roomLabel(x.roomId)}호 {x.nights}박
                      </span>
                    ))}
                  </div>
                ) : (
                  <select
                    className="aa-sel"
                    value={r.roomId}
                    disabled={!on || busy}
                    aria-label={`${b.guestName} 배정 방`}
                    onChange={(e) => setOver((p) => new Map(p).set(r.bookingId, e.target.value))}
                  >
                    {typeRooms(b.typeId).map((rm) => {
                      const f = free.get(r.bookingId);
                      const dis = !!f && !f.has(rm.id) && rm.id !== r.roomId;
                      return (
                        <option key={rm.id} value={rm.id} disabled={dis}>
                          {L.roomLabel(rm.id)}호{dis ? " (사용 중)" : ""}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>
            );
          })}
        </div>

        {plan.skipped.length ? (
          <div className="aa-skip">
            <h3>배정하지 못하는 예약 {plan.skipped.length}건</h3>
            <p className="muted sm">다른 타입 방에는 자동으로 넣지 않아요. 직접 「방배정」으로 골라 주세요.</p>
            {plan.skipped.map((x) => {
              const b = byId.get(x.bookingId);
              if (!b) return null;
              return (
                <div key={x.bookingId} className="aa-skrow">
                  <span>
                    <TypeBadge t={L.types.get(b.typeId)} /> <b>{b.guestName}</b> · {md(b.checkIn)} {b.nights ?? "?"}박
                  </span>
                  <i>{x.detail}</i>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="mf assign-type-acts">
          <button type="button" className="btn line" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button type="button" className="btn" disabled={busy || okCount === 0} onClick={() => onApply(active.filter((r) => !bad(r)))}>
            {busy ? "배정 중…" : `${okCount}건 배정하기`}
          </button>
        </div>
      </div>
    </div>
  );
}

