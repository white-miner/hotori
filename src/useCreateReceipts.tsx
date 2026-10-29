import { useEffect, useRef, useState } from "react";
import { BOOK_PAY_LABEL } from "../shared/payment";
import { won } from "../shared/ledger";
import type { ReceiptBatchLine } from "../shared/receiptBatch";

/** 예약 성공 이후에는 원래 폼을 다시 저장하지 않고 동일 UUID의 수납만 재시도한다. */
export function useCreateReceipts(save: (rows: ReceiptBatchLine[]) => Promise<unknown>, onClose: () => void) {
  const [pending, setPending] = useState<{ rows: ReceiptBatchLine[]; done: () => void } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pending) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); }
      if (e.key === "Tab") {
        const nodes = dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [pending]);
  const run = async (rows: ReceiptBatchLine[], done: () => void) => {
    if (lock.current || pending) return;
    if (!rows.length) { done(); return; }
    lock.current = true;
    try { await save(rows); done(); }
    catch (e) { setPending({ rows, done }); setError(e instanceof Error ? e.message : "저장 응답을 확인하지 못했어요."); }
    finally { lock.current = false; }
  };
  const retry = async () => {
    if (!pending || lock.current) return;
    lock.current = true; setBusy(true);
    try { await save(pending.rows); setPending(null); pending.done(); }
    catch (e) { setError(e instanceof Error ? e.message : "다시 확인해 주세요."); }
    finally { lock.current = false; setBusy(false); }
  };
  const recovery = pending ? <div className="dim receipt-recovery-dim" onMouseDown={(e) => e.stopPropagation()}>
    <div className="modal receipt-recovery" ref={dialog} role="dialog" aria-modal="true" aria-label="수납 저장 확인 필요">
      <h2>예약은 저장됐어요</h2><p>수납 저장을 확인하지 못했어요. 예약을 다시 만들지 않고 아래 수납만 재시도합니다.</p>
      <ul>{pending.rows.map((p) => <li key={p.id}>{BOOK_PAY_LABEL[p.method]} {won(p.amount)}원</li>)}</ul>
      <p role="alert" className="ferr">{error}</p>
      <div className="mf"><button type="button" className="btn line" disabled={busy} onClick={onClose}>닫고 수납 내역에서 확인</button><button type="button" className="btn dark" disabled={busy} autoFocus onClick={() => void retry()}>{busy ? "확인 중…" : "수납만 다시 저장"}</button></div>
    </div>
  </div> : null;
  return { run, pending: !!pending, recovery };
}
