/** 탑바 Bell(특이사항) · Megaphone(인수인계) 패널: 목록 · 해결 · + 전달사항 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Megaphone, X } from "lucide-react";
import {
  ROOM_MEMO_BODY_MAX,
  ROOM_MEMO_KIND_LABEL,
  openForHandoff,
  type RoomMemo,
  type RoomMemoDraft,
  type RoomMemoStatus,
  validateRoomMemoDraft,
} from "../shared/roomMemo";
import { allRooms, type HotelSettings } from "../shared/ledger";
import { lookups } from "./ui";

export type AlertStream = "issues" | "deliveries";

interface Props {
  stream: AlertStream;
  list: RoomMemo[];
  settings: HotelSettings;
  onClose: () => void;
  onSave: (d: RoomMemoDraft, id?: string) => Promise<RoomMemo>;
  onSetStatus: (id: string, status: RoomMemoStatus) => Promise<RoomMemo>;
  notify: (m: string) => void;
}

export default function HandoverAlertsPanel({ stream, list, settings, onClose, onSave, onSetStatus, notify }: Props) {
  const L = lookups(settings);
  const { issues, deliveries } = useMemo(() => openForHandoff(list), [list]);
  const rows = stream === "issues" ? issues : deliveries;
  const title = stream === "issues" ? "특이사항" : "인수인계";
  const Icon = stream === "issues" ? Bell : Megaphone;
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState("");
  const [roomId, setRoomId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rooms = useMemo(() => allRooms(settings), [settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (composing) {
        setComposing(false);
        setBody("");
        setRoomId("");
        setErr(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, composing]);

  useEffect(() => {
    if (composing) inputRef.current?.focus();
  }, [composing]);

  async function resolve(m: RoomMemo) {
    setBusy(true);
    try {
      await onSetStatus(m.id, "resolved");
      notify(stream === "issues" ? "특이사항을 해결했어요" : "인수인계를 확인했어요");
    } catch (e) {
      notify(e instanceof Error ? e.message : "상태를 바꾸지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  async function submitDelivery() {
    const d: RoomMemoDraft = { body, kind: "delivery", roomId: roomId || null, status: "open" };
    const v = validateRoomMemoDraft(d);
    if (v) return setErr(v);
    setBusy(true);
    setErr(null);
    try {
      await onSave(d);
      notify("전달사항을 남겼어요");
      setBody("");
      setRoomId("");
      setComposing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장하지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal handover-alerts-panel" role="dialog" aria-label={title}>
        <div className="grab" />
        <div className="mh">
          <h2>
            <Icon size={18} strokeWidth={2.2} aria-hidden />
            {title}
            {rows.length ? <span className="tag">{rows.length} 미해결</span> : null}
          </h2>
          <button type="button" className="x" onClick={onClose}>
            <X size={16} strokeWidth={2.2} aria-hidden />
            <kbd>Esc</kbd>닫기
          </button>
        </div>

        {stream === "deliveries" ? (
          <div className="halert-create">
            {!composing ? (
              <button type="button" className="btn line sm" onClick={() => setComposing(true)}>
                + 전달사항
              </button>
            ) : (
              <form
                className="rmemo-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitDelivery();
                }}
              >
                <div className="rmemo-row">
                  <input
                    ref={inputRef}
                    className="inp"
                    value={body}
                    maxLength={ROOM_MEMO_BODY_MAX}
                    placeholder="예: 계란주문 · 청소기 고장 · 보일러 공기빼기"
                    aria-label="전달사항 내용"
                    onChange={(e) => setBody(e.target.value.slice(0, ROOM_MEMO_BODY_MAX))}
                  />
                  <button type="submit" className="btn red sm" disabled={busy}>
                    {busy ? "…" : "남기기"}
                  </button>
                  <button
                    type="button"
                    className="btn line sm"
                    disabled={busy}
                    onClick={() => {
                      setComposing(false);
                      setBody("");
                      setRoomId("");
                      setErr(null);
                    }}
                  >
                    취소
                  </button>
                </div>
                <label className="halert-room">
                  <span className="muted">호실(선택)</span>
                  <select className="inp sm" value={roomId} onChange={(e) => setRoomId(e.target.value)} aria-label="호실 선택">
                    <option value="">호텔 공용</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {L.roomLabel(r.id) ?? r.no}
                      </option>
                    ))}
                  </select>
                </label>
                {err ? <div className="ferr">{err}</div> : null}
              </form>
            )}
          </div>
        ) : (
          <p className="halert-hint muted">객실 칸 말풍선에서 특이사항을 남길 수 있어요</p>
        )}

        <div className="rmemo-list">
          {!rows.length ? (
            <div className="lempty">{stream === "issues" ? "미해결 특이사항이 없어요" : "미해결 인수인계가 없어요"}</div>
          ) : null}
          {rows.map((m) => {
            const label = m.roomId ? L.roomLabel(m.roomId) ?? m.roomId : null;
            return (
              <div key={m.id} className="rmemo-item">
                <div className="rmemo-main">
                  {label ? <span className="halert-room-tag">{label}</span> : <span className="halert-room-tag hotel">호텔</span>}
                  {stream === "deliveries" ? <span className={`rmemo-kind k-${m.kind}`}>{ROOM_MEMO_KIND_LABEL[m.kind]}</span> : null}
                  <span className="rmemo-body">{m.body}</span>
                </div>
                <div className="rmemo-acts">
                  <button type="button" className="btn sm line" disabled={busy} onClick={() => void resolve(m)}>
                    해결
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
