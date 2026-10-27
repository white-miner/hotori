/** 확인 필요 함: 한 줄 설명 + 고치기 한 번 + 이대로 둠. 어떤 것도 막지 않아요. */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { Tangle } from "../shared/tangles";

interface Props {
  tangles: Tangle[];
  ignoredCount: number;
  onFix: (t: Tangle) => Promise<void>;
  /** 퇴실 미처리 여러 건 한 번에 */
  onFixMany: (list: Tangle[]) => Promise<void>;
  onIgnore: (list: Tangle[]) => void;
  onRestore: () => void;
  onClose: () => void;
}

const BULK_MIN = 4;

export default function TangleInbox({ tangles, ignoredCount, onFix, onFixMany, onIgnore, onRestore, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stale = useMemo(() => tangles.filter((t) => t.rule === "T01"), [tangles]);
  const bulk = stale.length >= BULK_MIN;
  const rows = useMemo(() => (bulk ? tangles.filter((t) => t.rule !== "T01") : tangles), [tangles, bulk]);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal tng-panel" role="dialog" aria-label="확인 필요">
        <div className="grab" />
        <div className="mh">
          <h2>
            <AlertTriangle size={18} strokeWidth={2.2} aria-hidden />
            확인 필요
            {tangles.length ? <span className="tag">{tangles.length}건</span> : null}
          </h2>
          <button type="button" className="x" onClick={onClose}>
            <X size={16} strokeWidth={2.2} aria-hidden />
            <kbd>Esc</kbd>닫기
          </button>
        </div>
        <p className="muted tng-note">알려 드리기만 해요. 저장·입실·퇴실·결제는 막지 않아요.</p>

        {!tangles.length ? <div className="lempty">지금 확인할 것이 없어요</div> : null}

        {bulk ? (
          <div className="tng-row bulk">
            <div className="tng-main">
              <div className="tng-title">퇴실일이 지났는데 퇴실 처리가 안 된 예약 {stale.length}건</div>
              <div className="tng-detail muted">과거 기록을 한꺼번에 넣었다면 한 번에 정리할 수 있어요. 계속 묵는 손님은 건너뛰세요.</div>
              {bulkOpen ? (
                <ul className="tng-preview">
                  {stale.slice(0, 8).map((t) => (
                    <li key={t.key}>{t.title}</li>
                  ))}
                  {stale.length > 8 ? <li className="muted">외 {stale.length - 8}건</li> : null}
                </ul>
              ) : null}
              <div className="tng-acts">
                {bulkOpen ? (
                  <>
                    <button type="button" className="btn dark" disabled={busy} onClick={() => void run(async () => { await onFixMany(stale); setBulkOpen(false); })}>
                      {stale.length}건 각자의 퇴실일로 처리
                    </button>
                    <button type="button" className="btn sm line" onClick={() => setBulkOpen(false)}>
                      취소
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn dark" disabled={busy} onClick={() => setBulkOpen(true)}>
                      한 번에 정리…
                    </button>
                    <button type="button" className="btn sm line" disabled={busy} onClick={() => onIgnore(stale)}>
                      전부 이대로 둠
                    </button>
                  </>
                )}
              </div>
              <div className="tng-hint muted">누르면 처리할 목록을 먼저 보여 드려요 · 처리 뒤 되돌릴 수 있어요</div>
            </div>
          </div>
        ) : null}

        {rows.map((t, i) => (
          <div key={t.key} className={`tng-row ${t.severity}`}>
            <div className="tng-main">
              <div className="tng-title">{t.title}</div>
              <div className="tng-detail muted">{t.detail}</div>
              <div className="tng-acts">
                {t.fix ? (
                  <button type="button" className={`btn ${i === 0 && !bulk ? "dark" : "line"}`} disabled={busy} onClick={() => void run(() => onFix(t))}>
                    {t.fix.label}
                  </button>
                ) : null}
                <button type="button" className="btn sm line" disabled={busy} onClick={() => onIgnore([t])}>
                  이대로 둠
                </button>
              </div>
              {t.fix ? <div className="tng-hint muted">누르면: {t.fix.hint}</div> : null}
            </div>
          </div>
        ))}

        {ignoredCount > 0 ? (
          <button type="button" className="tng-restore" onClick={onRestore}>
            이대로 둔 {ignoredCount}건 다시 보기
          </button>
        ) : null}
      </div>
    </div>
  );
}
