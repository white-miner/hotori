import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ClipboardList, Plus, X } from "lucide-react";
import { allRooms, type HotelSettings } from "../shared/ledger";
import { ROOM_MEMO_BODY_MAX, validateRoomMemoDraft, type RoomMemo, type RoomMemoDraft, type RoomMemoStatus } from "../shared/roomMemo";
import { lookups } from "./ui";

export interface ManagementRecordsProps {
  records: RoomMemo[] | null; loadError?: string | null; onRefresh?: () => Promise<void>; settings: HotelSettings; checkCount: number; checks: ReactNode;
  onClose: () => void; onSave: (draft: RoomMemoDraft) => Promise<RoomMemo>;
  onSetStatus: (id: string, status: RoomMemoStatus) => Promise<RoomMemo>;
  notify: (text: string) => void;
}

/** 호텔 공용 기록은 기존 delivery 저장·구독을 공유한다. 자동 경고와 직원 작성 기록을 섞지 않는다. */
export default function ManagementRecords(p: ManagementRecordsProps) {
  const [tab, setTab] = useState<"records" | "checks">("records");
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState("");
  const [roomId, setRoomId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | RoomMemoStatus>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const closeHandler = useRef(p.onClose);
  const saving = useRef(busy);
  closeHandler.current = p.onClose;
  saving.current = busy;
  const L = lookups(p.settings);
  const records = useMemo(() => (p.records ?? []).filter((r) => r.kind === "delivery").sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [p.records]);
  const shown = records.filter((r) => (filter === "all" || r.status === filter) && `${r.body} ${r.roomId ? L.roomLabel(r.roomId) : "호텔 공용"}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); if (!saving.current) closeHandler.current(); }
      if (e.key === "Tab") {
        const nodes = root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, [tabindex="0"]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("keydown", key, true); previous?.focus(); };
  }, []);
  useEffect(() => { if (composing && tab === "records") input.current?.focus(); }, [composing, tab]);
  const save = async () => {
    if (busy) return;
    const draft: RoomMemoDraft = { body: body.trim(), kind: "delivery", roomId: roomId || null, status: "open" };
    const invalid = validateRoomMemoDraft(draft);
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError(null);
    try {
      await p.onSave(draft);
      setBody(""); setRoomId(""); setComposing(false); setFilter("all"); setQuery("");
      p.notify("관리기록을 저장했어요");
    } catch (e) { setError(e instanceof Error ? e.message : "기록을 저장하지 못했어요. 입력 내용은 유지됩니다."); }
    finally { setBusy(false); }
  };
  const status = async (r: RoomMemo) => {
    setBusy(true); setError(null);
    try { await p.onSetStatus(r.id, r.status === "open" ? "resolved" : "open"); }
    catch (e) { setError(e instanceof Error ? e.message : "상태를 저장하지 못했어요"); }
    finally { setBusy(false); }
  };
  return <div className="dim management-records-dim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) p.onClose(); }}>
    <div className="modal management-records" role="dialog" aria-modal="true" aria-label="관리기록" ref={root}>
      <div className="mh"><h2><ClipboardList size={20} />관리기록</h2><button type="button" className="x" aria-label="닫기" ref={close} disabled={busy} onClick={p.onClose}><X size={18} /></button></div>
      <div className="management-tabs" role="tablist" aria-label="관리기록 분류">
        <button type="button" role="tab" id="management-records-tab" aria-controls="management-records-list" aria-selected={tab === "records"} onClick={() => setTab("records")}>기록 목록 {records.length}</button>
        <button type="button" role="tab" id="management-checks-tab" aria-controls="management-checks-list" aria-selected={tab === "checks"} onClick={() => setTab("checks")}>확인사항 {p.checkCount}</button>
      </div>
      <div className="management-content">
        {tab === "records" ? <section role="tabpanel" id="management-records-list" aria-labelledby="management-records-tab">
          <div className="management-toolbar"><label>기록 검색<input className="inp" aria-label="관리기록 검색" placeholder="내용·객실 검색" value={query} onChange={(e) => setQuery(e.target.value)} /></label><label>상태<select className="inp" aria-label="관리기록 상태" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">전체 기록</option><option value="open">미해결</option><option value="resolved">해결됨</option></select></label><button type="button" className="btn dark" onClick={() => { setComposing(true); setError(null); }}><Plus size={17} />새 기록</button></div>
          <p className="management-hint">호텔 공용 기록과 인수인계 내용을 함께 확인합니다. 해결한 기록도 목록에 보관됩니다.</p>
          {p.loadError ? <p role="alert" className="ferr">관리기록을 불러오지 못했어요. {p.onRefresh ? <button type="button" className="btn line" onClick={() => void p.onRefresh?.()}>다시 불러오기</button> : null}</p> : p.records === null ? <p role="status">관리기록을 불러오는 중…</p> : null}
          {composing ? <form className="management-compose" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <label>기록 내용<textarea className="inp" ref={input} aria-label="관리기록 내용" value={body} maxLength={ROOM_MEMO_BODY_MAX} onChange={(e) => setBody(e.target.value)} rows={3} required /></label>
            <label>관련 객실<select className="inp" aria-label="관리기록 관련 객실" value={roomId} onChange={(e) => setRoomId(e.target.value)}><option value="">호텔 공용</option>{allRooms(p.settings).map((r) => <option key={r.id} value={r.id}>{L.roomLabel(r.id)}</option>)}</select></label>
            <div><span>{body.trim().length}/{ROOM_MEMO_BODY_MAX}</span><button type="button" className="btn line" disabled={busy} onClick={() => setComposing(false)}>취소</button><button type="submit" className="btn dark" disabled={busy || !body.trim()}>{busy ? "저장 중…" : "기록 저장"}</button></div>
          </form> : null}
          {error ? <p role="alert" className="ferr">{error}</p> : null}
          <div className="management-list" aria-label="저장된 관리기록">
            {!shown.length && p.records !== null && !p.loadError ? <p className="lempty">{records.length ? "검색 조건에 맞는 기록이 없어요" : "작성된 관리기록이 없어요"}</p> : null}
            {shown.map((r) => <article key={r.id} className={`management-entry ${r.status}`}><header><strong>{r.roomId ? L.roomLabel(r.roomId) ?? "객실" : "호텔 공용"}</strong><span>{r.status === "open" ? "미해결" : "해결됨"}</span><time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time></header><p>{r.body}</p><button type="button" className="btn line" disabled={busy} onClick={() => void status(r)}>{r.status === "open" ? "해결 처리" : "다시 열기"}</button></article>)}
          </div>
        </section> : <section role="tabpanel" id="management-checks-list" aria-labelledby="management-checks-tab">{p.checks}</section>}
      </div>
    </div>
  </div>;
}
