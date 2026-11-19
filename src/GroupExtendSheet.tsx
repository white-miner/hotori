import { useMemo, useState } from "react";
import { type Booking, type HotelSettings, addDays, md, won } from "../shared/ledger";
import {
  extendMemo,
  extendRoomChoices,
  extendWriteLines,
  inHouseMember,
  planGroupPeriodExtend,
  type ExtendMode,
  type ExtendWriteLine,
} from "../shared/groupExtend";

/**
 * 단체 기간 연장. 투숙 중 객실은 선택된 채로 열리고, 새 박 요금은 각 객실 직전 박 금액입니다.
 * 연장 박은 7열 표가 아니라 목록입니다. 겹치면 저장되지 않습니다.
 */
export default function GroupExtendSheet({
  settings,
  today,
  all,
  members,
  roomNo,
  busy,
  onClose,
  onSave,
}: {
  settings: HotelSettings;
  today: string;
  all: readonly Booking[];
  members: readonly Booking[];
  roomNo: (b: Booking) => string;
  busy?: boolean;
  onClose: () => void;
  onSave: (lines: ExtendWriteLine[], extensionCharge: number, memo: string) => Promise<void>;
}) {
  const defaults = useMemo(() => new Set(members.filter((b) => inHouseMember(b, today)).map((b) => b.id)), [members, today]);
  const [picked, setPicked] = useState<Set<string>>(defaults);
  const [mode, setMode] = useState<ExtendMode | null>(null);
  const [out, setOut] = useState("");
  const [edits, setEdits] = useState<Record<string, Record<string, number | null>>>({});
  const [rooms, setRooms] = useState<Record<string, string | null>>({});
  const [err, setErr] = useState<string | null>(null);

  const plan = useMemo(
    () =>
      mode
        ? planGroupPeriodExtend({ all, members, selected: picked, mode, today, edits, rooms })
        : null,
    [all, members, picked, mode, today, edits, rooms],
  );
  const chosen = plan?.rooms.filter((r) => picked.has(r.bookingId) && !r.lock) ?? [];
  const blocked = chosen.filter((r) => r.error || r.clashes.length);
  const canSave = !!plan && plan.ready.length > 0 && blocked.length === 0 && !busy;

  const setModeSafe = (next: ExtendMode) => {
    setMode(next);
    setErr(null);
  };

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal assign-type-modal gext" role="dialog" aria-label="기간 연장" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mh">
          <h2>기간 연장</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onClose}>닫기</button>
        </div>
        <div className="mb modal-task-body">
          <p className="muted sm">투숙 중인 객실이 선택돼 있습니다. 빼고 싶은 객실만 해제하세요. 새 박 요금은 그 객실의 직전 박 금액이고, 객실마다 따로 고칠 수 있습니다.</p>
          <div className="gext-modes" role="group" aria-label="새 퇴실일">
            <label>
              퇴실일
              <input type="date" aria-label="새 퇴실일" value={out} disabled={busy} onChange={(e) => { setOut(e.target.value); if (e.target.value) setModeSafe({ kind: "date", out: e.target.value }); }} />
            </label>
            <button type="button" className="btn line" disabled={busy} onClick={() => setModeSafe({ kind: "plus", add: 7 })}>+7박</button>
            <button type="button" className="btn line" disabled={busy} onClick={() => setModeSafe({ kind: "open" })}>퇴실 미정</button>
          </div>
          {!mode ? <p>퇴실일, +7박, 퇴실 미정 중에서 고르세요.</p> : null}
          <ul className="gext-rooms">
            {members.map((b) => {
              const row = plan?.rooms.find((r) => r.bookingId === b.id);
              const on = picked.has(b.id);
              const label = roomNo(b);
              const choices = row && on && row.clashes.length && !b.segments?.length ? extendRoomChoices(settings, all, row, b) : [];
              return (
                <li key={b.id} className={on ? "on" : ""}>
                  <label>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={busy || !!row?.lock}
                      onChange={(e) => setPicked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(b.id); else next.delete(b.id);
                        return next;
                      })}
                    />
                    <b>{label}</b>
                    <span className="muted sm">{b.guestName} · {row ? `${row.fromNights}박 → ${on && mode ? `${row.toNights}박` : `${row.fromNights}박`}` : ""}{row?.openEnded && on && mode?.kind === "open" ? " · 퇴실 미정" : ""}</span>
                  </label>
                  {row?.lock ? <small className="muted">{row.lock}</small> : null}
                  {on && mode && row && !row.lock ? (
                    <>
                      <ol className="gext-nights">
                        {row.lines.filter((l) => {
                          const start = row.lines[0]?.date ?? b.checkIn;
                          const oldLast = addDays(start, row.fromNights - 1);
                          return l.date > oldLast || l.amount == null;
                        }).map((l) => (
                          <li key={l.date}>
                            <span>{md(l.date)}{l.proposed ? " · 직전 박" : ""}</span>
                            <input
                              type="number"
                              aria-label={`${label} ${l.date} 요금`}
                              min={0}
                              max={100000000}
                              step={1000}
                              disabled={busy}
                              value={l.amount ?? ""}
                              onChange={(e) => {
                                const raw = e.target.value;
                                setEdits((prev) => ({ ...prev, [b.id]: { ...prev[b.id], [l.date]: raw === "" ? null : Number(raw) } }));
                              }}
                            />
                          </li>
                        ))}
                      </ol>
                      <p className="muted sm">이 객실 연장분 {won(row.extensionCharge)}원 · 객실 총액 {won(row.price)}원</p>
                      {row.error ? <p className="ferr">{row.error}</p> : null}
                      {row.clashes.length ? (
                        <div className="ferr" role="alert">
                          다른 예약과 겹칩니다: {row.clashes.slice(0, 3).map((c) => `${md(c.date)} ${c.otherName}`).join(", ")}. 이 객실을 빼거나 호실을 바꾸세요.
                          {choices.length ? (
                            <select
                              aria-label={`${label} 다른 호실`}
                              disabled={busy}
                              value={rooms[b.id] ?? ""}
                              onChange={(e) => setRooms((prev) => ({ ...prev, [b.id]: e.target.value || null }))}
                            >
                              <option value="">호실 유지</option>
                              {choices.map((c) => <option key={c.id} value={c.id}>{c.no}호</option>)}
                            </select>
                          ) : <span> 지금 비는 같은 타입 호실이 없습니다.</span>}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {plan ? <p>연장 청구 합계 <b>{won(plan.extensionCharge)}원</b> · 객실마다 더한 값입니다.</p> : null}
          {err ? <p className="ferr" role="alert">{err}</p> : null}
        </div>
        <div className="mf">
          <button type="button" className="btn line" disabled={busy} onClick={onClose}>닫기</button>
          <button
            type="button"
            className="btn dark"
            disabled={!canSave}
            onClick={() => {
              if (!plan) return;
              setErr(null);
              const lines = extendWriteLines(members, plan.ready);
              void onSave(lines, plan.extensionCharge, extendMemo(plan.ready)).catch((e: unknown) => {
                setErr(e instanceof Error ? e.message : "저장하지 못했습니다. 다시 열어 주세요.");
              });
            }}
          >
            {busy ? "저장 중…" : `${plan?.ready.length ?? 0}객실 연장 저장`}
          </button>
        </div>
      </div>
    </div>
  );
}
