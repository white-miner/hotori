import { useState } from "react";
import { Pin, PinOff } from "lucide-react";
import { CHANGE_FILTERS, type Change, type ChangeFilter, NOTE_MAX, atLabel, cleanNote, matchesFilter } from "../shared/changes";

/**
 * 메모 · 기록 — 위에는 한 줄 메모 입력(Enter로 저장)이 하나, 아래는 날짜순 기록.
 * 결제 등록·객실 추가·조기 퇴실 처리·연장은 앱이 알아서 한 줄씩 남겨요(사유를 묻지 않아요).
 */
export default function ChangeLogSheet({
  title,
  entries,
  readOnly,
  onAdd,
  onPin,
  onClose,
}: {
  title: string;
  entries: Change[];
  readOnly?: boolean;
  onAdd: (text: string) => Promise<boolean>;
  onPin: (id: string, pinned: boolean) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<ChangeFilter>("all");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shown = entries.filter((c) => matchesFilter(c, filter));
  const note = cleanNote(text);

  const save = async () => {
    if (!note || busy) return;
    setBusy(true);
    setErr(null);
    const ok = await onAdd(note);
    setBusy(false);
    if (ok) setText("");
    else setErr("메모를 저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.");
  };

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal assign-type-modal gpp-modal" role="dialog" aria-label="메모 · 기록" onMouseDown={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="mh">
          <h2>메모 · 기록</h2>
          <span className="muted sm gpp-gname">{title}</span>
          <button type="button" className="x" aria-label="닫기" onClick={onClose}>닫기</button>
        </div>
        <div className="mb">
          {!readOnly ? (
            <form
              className="chl-add"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <input
                className="chl-input"
                aria-label="메모"
                placeholder="한 줄 메모 (예: 602호 10/29부터 2인으로 변경 예정)"
                maxLength={NOTE_MAX}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button type="submit" className="btn dark chl-go" disabled={!note || busy}>
                {busy ? "저장 중…" : "메모 저장"}
              </button>
            </form>
          ) : null}
          {err ? <div className="ferr">{err}</div> : null}
          <div className="chips chl-filters">
            {CHANGE_FILTERS.map((f) => (
              <button key={f.id} type="button" className={`chip${filter === f.id ? " on" : ""}`} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          {shown.length ? (
            <ul className="chl-list">
              {shown.map((c) => (
                <li key={c.id} className={`chl-row ${c.kind}${c.pinned ? " pin" : ""}`}>
                  <span className="chl-at muted sm">{atLabel(c.at)}</span>
                  <span className="chl-sum">{c.kind === "note" ? <b className="chl-tag">메모</b> : null} {c.summary}</span>
                  {c.kind === "note" && !readOnly ? (
                    <button type="button" className="chl-pin" aria-label={c.pinned ? "고정 해제" : "맨 위에 고정"} onClick={() => onPin(c.id, !c.pinned)}>
                      {c.pinned ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted sm chl-empty">아직 기록이 없어요. 결제를 등록하거나 객실을 바꾸면 여기에 한 줄씩 남아요.</p>
          )}
        </div>
      </div>
    </div>
  );
}
