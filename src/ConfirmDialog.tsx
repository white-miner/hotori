import { useEffect, useState } from "react";
import { Ban, Check } from "lucide-react";

/** Hotori FO 확인 모달 — `window.confirm` 대체. 위험 액션은 `danger` → `.btn.stop`. */
export type AskConfirmOpts = {
  title: string;
  /** `\n` → 단락 분리 */
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** true → 확인 버튼 `.btn.stop` (퇴실·삭제 등) */
  danger?: boolean;
};

type Pending = AskConfirmOpts & { resolve: (ok: boolean) => void };

let pending: Pending | null = null;
let bump: (() => void) | null = null;

/** Promise 기반 확인. ConfirmHost가 마운트되어 있어야 함. */
export function askConfirm(opts: AskConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    if (pending) pending.resolve(false);
    pending = { ...opts, resolve };
    bump?.();
  });
}

function takePending(): Pending | null {
  const p = pending;
  pending = null;
  return p;
}

/**
 * 앱 루트에 1회 마운트. askConfirm → 이 호스트가 모달 표시.
 * z-index 80으로 다른 `.dim`(50) 위에 쌓임.
 */
export function ConfirmHost() {
  const [tick, setTick] = useState(0);
  const [cur, setCur] = useState<Pending | null>(null);

  useEffect(() => {
    bump = () => setTick((n) => n + 1);
    return () => {
      bump = null;
    };
  }, []);

  useEffect(() => {
    if (!pending || cur) return;
    setCur(takePending());
  }, [tick, cur]);

  if (!cur) return null;

  const confirmLabel = cur.confirmLabel ?? "확인";
  const cancelLabel = cur.cancelLabel ?? "취소";
  const lines = cur.body.split("\n").filter((l) => l.length > 0);

  const close = (ok: boolean) => {
    cur.resolve(ok);
    setCur(null);
    // 대기열이 있으면 다음 틱에 오픈
    if (pending) setTick((n) => n + 1);
  };

  return (
    <div
      className="dim assign-type-dim confirm-dim"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && close(false)}
    >
      <div
        className="modal assign-type-modal"
        role="dialog"
        aria-label={cur.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>{cur.title}</h2>
          <button type="button" className="x" aria-label="닫기" onClick={() => close(false)}>
            닫기
          </button>
        </div>
        <div className="mb">
          {lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        <div className="mf assign-type-acts">
          <button type="button" className="btn red" onClick={() => close(false)}>
            <Ban size={15} strokeWidth={2.2} aria-hidden />
            {cancelLabel}
          </button>
          <button
            type="button"
            className={cur.danger ? "btn stop" : "btn green"}
            onClick={() => close(true)}
            autoFocus
          >
            <Check size={15} strokeWidth={2.2} aria-hidden />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
