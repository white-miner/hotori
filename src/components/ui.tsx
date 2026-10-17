import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { HOTORI_SWATCHES, SOFT_SWATCHES } from "../lib";

export function Mark() {
  return (
    <svg className="mark" viewBox="0 0 28 28" aria-hidden="true">
      <path
        d="M4 12.5 14 4.5l10 8V24H4z"
        fill="none"
        stroke="#1E3F8F"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M4 18h20" stroke="#1BA6DE" strokeWidth="1.6" />
      <rect x="8" y="13" width="4" height="3" rx=".6" fill="#D9381E" />
      <rect x="16" y="13" width="4" height="3" rx=".6" fill="#1BA6DE" />
      <rect x="8" y="19.8" width="4" height="2.6" rx=".6" fill="#1BA6DE" />
      <rect x="16" y="19.8" width="4" height="2.6" rx=".6" fill="#D9381E" />
    </svg>
  );
}
export function Brand({ sub }: { sub?: string }) {
  return (
    <span className="brand">
      <Mark />
      <span className="wm">HOTORI</span>
      <span className="seal" aria-label="호토리">
        호<br />토<br />리
      </span>
      {sub && <small>{sub}</small>}
    </span>
  );
}
export function Legend({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`legend ${compact ? "compact" : ""}`} aria-label="범례">
      <span>
        <i className="g use" />
        사용중
      </span>
      <span>
        <i className="g rsv" />
        예약
      </span>
      <span>
        <i className="g vac" />
        빈방
      </span>
      <span>
        <i className="g cln" />
        청소
      </span>
      <span>
        <i className="g chk" />
        점검
      </span>
    </div>
  );
}
export function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <div className="empty">
      <div className="wave" />
      <strong>{title}</strong>
      {text && <p>{text}</p>}
    </div>
  );
}

/** PC는 가운데 창, 휴대폰은 아래에서 올라오는 시트 */
export function Dialog({
  title,
  sub,
  children,
  onClose,
  busy,
  wide = false,
}: {
  title: string;
  sub?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  busy: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const node = ref.current;
    node?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
      if (e.key === "Tab") {
        const items = Array.from(
          node?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ) || [],
        );
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [busy]);
  return (
    <div
      className="dim"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={ref}
        className={`dialog ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="grab" />
        <div className="dialog-head">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button
            aria-label="닫기"
            className="icb"
            disabled={busy}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

export function Chips<T extends string | number>({
  value,
  options,
  onChange,
  label,
  solid = false,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  solid?: boolean;
}) {
  return (
    <div
      className={`chips ${solid ? "solid" : ""}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o.value === value}
          key={String(o.value)}
          className={`ch ${o.value === value ? "on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.value === value && <Check size={13} strokeWidth={2.6} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 호토리 색 + 부드러운 색 + 직접 고르기 */
export function ColorPicker({
  value,
  onChange,
  disabled,
  label,
}: {
  value?: string;
  onChange: (hex: string | null) => void;
  disabled?: boolean;
  label: string;
}) {
  const [custom, setCustom] = useState(value || "#1E3F8F");
  useEffect(() => {
    if (value) setCustom(value);
  }, [value]);
  const sw = (hex: string, name: string) => (
    <button
      type="button"
      key={hex}
      disabled={disabled}
      className={`swatch ${value?.toUpperCase() === hex ? "on" : ""}`}
      style={{ ["--sw" as string]: hex }}
      title={`${name} ${hex}`}
      aria-label={`${name} ${hex}`}
      aria-pressed={value?.toUpperCase() === hex}
      onClick={() => onChange(hex)}
    >
      {value?.toUpperCase() === hex && <Check size={13} strokeWidth={3} />}
    </button>
  );
  const valid = /^#[0-9a-fA-F]{6}$/.test(custom);
  return (
    <div className="picker" role="group" aria-label={label}>
      <div className="sw-row">
        <button
          type="button"
          disabled={disabled}
          className={`swatch none ${!value ? "on" : ""}`}
          aria-pressed={!value}
          title="기본 (색 없음)"
          aria-label="기본 (색 없음)"
          onClick={() => onChange(null)}
        />
        {HOTORI_SWATCHES.map((s) => sw(s.hex, s.name))}
      </div>
      <div className="sw-row">
        {SOFT_SWATCHES.map((s) => sw(s.hex, s.name))}
      </div>
      <div className="sw-custom">
        <input
          type="color"
          aria-label="직접 고르기"
          value={valid ? custom : "#1E3F8F"}
          disabled={disabled}
          onChange={(e) => setCustom(e.target.value.toUpperCase())}
        />
        <input
          className="hex"
          value={custom}
          maxLength={7}
          disabled={disabled}
          aria-label="색 코드"
          onChange={(e) => setCustom(e.target.value)}
        />
        <button
          type="button"
          className="btn sm"
          disabled={disabled || !valid || custom.toUpperCase() === value}
          onClick={() => onChange(custom.toUpperCase())}
        >
          이 색 쓰기
        </button>
      </div>
    </div>
  );
}
