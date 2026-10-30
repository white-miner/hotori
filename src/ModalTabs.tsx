import { useRef, type ReactNode } from "react";

/** 업무 목적 탭. 저장하지 않고 전환하며 패널은 hidden으로 유지해 입력값을 보존한다. */
export default function ModalTabs<T extends string>({ scope, label, tabs, value, onChange, disabled, actions }: {
  scope: string; label: string; tabs: readonly { id: T; label: string }[]; value: T;
  onChange: (id: T) => void; disabled?: boolean; actions?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const choose = (id: T) => {
    onChange(id);
    const body = root.current?.closest('.modal')?.querySelector<HTMLElement>('.modal-task-body');
    if (body && id !== value) body.scrollTop = 0;
  };
  return <div className="modal-task-nav">
    <div ref={root} className="modal-task-tabs" role="tablist" aria-label={label} onKeyDown={e => {
      if (disabled || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
      const at = buttons.indexOf(e.target as HTMLButtonElement);
      if (at < 0) return;
      e.preventDefault();
      const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      choose(tabs[next].id); buttons[next]?.focus();
    }}>{tabs.map(t => <button type="button" role="tab" key={t.id} id={`${scope}-tab-${t.id}`} aria-controls={`${scope}-panel-${t.id}`} aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} disabled={disabled} onClick={() => choose(t.id)}>{t.label}</button>)}</div>
    {actions ? <div className="modal-task-shortcuts" aria-label="바로 할 업무">{actions}</div> : null}
  </div>;
}

export function ModalTabPanel({ scope, id, active, children }: { scope: string; id: string; active: string; children: ReactNode }) {
  return <div className="modal-task-panel" role="tabpanel" id={`${scope}-panel-${id}`} aria-labelledby={`${scope}-tab-${id}`} hidden={active !== id} tabIndex={0}>{children}</div>;
}
