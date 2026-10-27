/** 「현황」객실 특이사항: 목록 · 추가 · 해결/미해결 · 수정 · 전달사항 */
import { useEffect, useRef, useState } from "react";
import {
  ROOM_MEMO_BODY_MAX,
  ROOM_MEMO_KIND_LABEL,
  ROOM_MEMO_STATUS_LABEL,
  memosForRoom,
  type RoomMemo,
  type RoomMemoKind,
  type RoomMemoStatus,
  validateRoomMemoDraft,
} from "../shared/roomMemo";
import { askConfirm } from "./ConfirmDialog";

interface Props {
  roomId: string;
  roomLabel: string;
  list: RoomMemo[];
  readOnly?: boolean;
  onClose: () => void;
  onSave: (d: { roomId: string; body: string; kind: RoomMemoKind; status?: RoomMemoStatus }, id?: string) => Promise<RoomMemo>;
  onSetStatus: (id: string, status: RoomMemoStatus) => Promise<RoomMemo>;
  onRemove: (id: string) => Promise<void>;
  notify: (m: string) => void;
}

export default function RoomMemoModal({ roomId, roomLabel, list, readOnly, onClose, onSave, onSetStatus, onRemove, notify }: Props) {
  const rows = memosForRoom(list, roomId);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<RoomMemoKind>("issue");
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!readOnly && !editId) inputRef.current?.focus();
  }, [readOnly, editId, roomId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (editId) {
        setEditId(null);
        setBody("");
        setKind("issue");
        setErr(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editId]);

  function startEdit(m: RoomMemo) {
    setEditId(m.id);
    setBody(m.body);
    setKind(m.kind);
    setErr(null);
    queueMicrotask(() => inputRef.current?.focus());
  }

  async function submit() {
    const d = { roomId, body, kind, status: (editId ? undefined : "open") as RoomMemoStatus | undefined };
    const v = validateRoomMemoDraft(d);
    if (v) return setErr(v);
    setBusy(true);
    setErr(null);
    try {
      await onSave({ roomId, body: body.trim(), kind }, editId ?? undefined);
      notify(editId ? "특이사항을 고쳤어요" : "특이사항을 적었어요");
      setBody("");
      setKind("issue");
      setEditId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장하지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(m: RoomMemo) {
    const next: RoomMemoStatus = m.status === "open" ? "resolved" : "open";
    setBusy(true);
    try {
      await onSetStatus(m.id, next);
      notify(next === "resolved" ? "해결로 표시했어요" : "미해결로 되돌렸어요");
    } catch (e) {
      notify(e instanceof Error ? e.message : "상태를 바꾸지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  async function erase(m: RoomMemo) {
    const ok = await askConfirm({
      title: "특이사항 삭제",
      body: `이 특이사항을 삭제할까요?\n${m.body}`,
      confirmLabel: "삭제",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await onRemove(m.id);
      if (editId === m.id) {
        setEditId(null);
        setBody("");
        setKind("issue");
      }
      notify("특이사항을 삭제했어요");
    } catch (e) {
      notify(e instanceof Error ? e.message : "삭제하지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  const openN = rows.filter((x) => x.status === "open").length;

  return (
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal room-memo-modal" role="dialog" aria-label={`${roomLabel} 메모`}>
        <div className="grab" />
        <div className="mh">
          <h2>
            {roomLabel} 메모
            {openN ? <span className="tag">{openN} 미해결</span> : null}
          </h2>
          <button type="button" className="x" onClick={onClose}>
            <kbd>Esc</kbd>닫기
          </button>
        </div>

        {!readOnly ? (
          <form
            className="rmemo-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="chips">
              <button type="button" className={`chip sm ${kind === "issue" ? "on" : ""}`} onClick={() => setKind("issue")}>
                특이사항
              </button>
              <button type="button" className={`chip sm ${kind === "delivery" ? "on" : ""}`} onClick={() => setKind("delivery")}>
                전달사항
              </button>
            </div>
            <div className="rmemo-row">
              <input
                ref={inputRef}
                className="inp"
                value={body}
                maxLength={ROOM_MEMO_BODY_MAX}
                placeholder={kind === "delivery" ? "예: 마우스 추가지급" : "예: 인터넷 안됨"}
                aria-label="특이사항 내용"
                onChange={(e) => setBody(e.target.value.slice(0, ROOM_MEMO_BODY_MAX))}
              />
              <button type="submit" className="btn red sm" disabled={busy}>
                {busy ? "…" : editId ? "수정" : "추가"}
              </button>
              {editId ? (
                <button
                  type="button"
                  className="btn line sm"
                  disabled={busy}
                  onClick={() => {
                    setEditId(null);
                    setBody("");
                    setKind("issue");
                    setErr(null);
                  }}
                >
                  취소
                </button>
              ) : null}
            </div>
            {err ? <div className="ferr">{err}</div> : null}
          </form>
        ) : null}

        <div className="rmemo-list">
          {!rows.length ? <div className="lempty">이 방 특이사항이 없어요 · 간단히 입력해 보세요</div> : null}
          {rows.map((m) => (
            <div key={m.id} className={`rmemo-item ${m.status === "resolved" ? "done" : ""}`}>
              <div className="rmemo-main">
                <span className={`rmemo-kind k-${m.kind}`}>{ROOM_MEMO_KIND_LABEL[m.kind]}</span>
                <span className="rmemo-body">{m.body}</span>
                <span className={`rmemo-st s-${m.status}`}>{ROOM_MEMO_STATUS_LABEL[m.status]}</span>
              </div>
              {!readOnly ? (
                <div className="rmemo-acts">
                  <button type="button" className="btn sm line" disabled={busy} onClick={() => void toggleStatus(m)}>
                    {m.status === "open" ? "해결" : "미해결"}
                  </button>
                  <button type="button" className="btn sm line" disabled={busy} onClick={() => startEdit(m)}>
                    수정
                  </button>
                  <button type="button" className="btn sm danger" disabled={busy} onClick={() => void erase(m)}>
                    삭제
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
