import { useEffect, useState } from "react";
import { FLOOR_PALETTE } from "../shared/floorColor";
import { HEX } from "../shared/platform";

export default function FloorColorPicker({ name, color, onPreview, onSave }: { name: string; color: string; onPreview: (color: string) => void; onSave: (color: string) => Promise<void> }) {
  const [draft, setDraft] = useState(color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setDraft(color), [color]);
  const choose = (c: string) => { setDraft(c); onPreview(c); setError(""); };
  return <details className="floor-color-picker">
    <summary aria-label={`${name} 객실번호 색상 설정`} title="층 색상 설정"><span style={{ background: color }} /><span>색상</span></summary>
    <div className="floor-color-pop">
      <b>{name} 객실번호 색상</b>
      <div className="floor-color-swatches">{FLOOR_PALETTE.map((p) => <button key={p.value} type="button" disabled={busy} aria-label={`${name} ${p.name}`} aria-pressed={draft.toUpperCase() === p.value.toUpperCase()} style={{ background: p.value }} onClick={() => choose(p.value)} />)}</div>
      <label>직접 선택<input type="color" aria-label={`${name} 직접 색상 선택`} value={HEX.test(draft) ? draft : color} disabled={busy} onChange={(e) => choose(e.target.value)} /></label>
      <label>색상 코드<input type="text" aria-label={`${name} 색상 코드`} value={draft} maxLength={7} disabled={busy} onChange={(e) => { setDraft(e.target.value); if (HEX.test(e.target.value)) onPreview(e.target.value); }} /></label>
      <button type="button" className="btn line" disabled={busy || !HEX.test(draft)} onClick={async (e) => {
        const detail = e.currentTarget.closest("details");
        setBusy(true); setError("");
        try { await onSave(draft); if (detail) detail.open = false; }
        catch { setError("저장하지 못했어요. 다시 시도해 주세요."); }
        finally { setBusy(false); }
      }}>{busy ? "저장 중…" : "저장"}</button>
      <small>선택한 색은 미리보기입니다. 저장하면 새로고침 후에도 유지됩니다.</small>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  </details>;
}
