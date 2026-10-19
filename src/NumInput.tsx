// 숫자 칸: 적는 동안 글자를 그대로 두고(범위 안이면 바로 저장), 칸을 벗어날 때만 범위를 맞춰요
import { useState } from "react";
import { type DraftOpts, cleanDraft, commitDraft, liveValue } from "../shared/numdraft";

interface Props extends DraftOpts {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  /** 비워 두면: true면 null(없음), 아니면 비우기 전 값으로 되돌려요 */
  allowEmpty?: boolean;
  /** 비어 있지 않을 때 보이는 모양 (기본: 쉼표) */
  format?: (n: number) => string;
  className?: string;
  placeholder?: string;
  "aria-label": string;
  title?: string;
}
const comma = (n: number) => n.toLocaleString("ko-KR");

export default function NumInput({ value, onChange, allowEmpty = false, format = comma, min, max, decimal, className = "num", placeholder, title, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const o = { min, max, decimal };
  const shown = draft ?? (value != null ? format(value) : "");
  const finish = () => {
    if (draft === null) return;
    const n = commitDraft(draft, o);
    setDraft(null);
    if (n === null) {
      if (allowEmpty && value != null) onChange(null);
      return; // 비우면 원래 값으로 되돌려요
    }
    if (n !== value) onChange(n);
  };
  return (
    <input
      className={className}
      inputMode={decimal ? "decimal" : "numeric"}
      aria-label={rest["aria-label"]}
      title={title}
      placeholder={placeholder}
      value={shown}
      onFocus={() => setDraft(value != null ? String(value) : "")}
      onChange={(e) => {
        const s = cleanDraft(e.target.value, decimal);
        setDraft(s);
        const n = liveValue(s, o);
        if (n !== null && n !== value) onChange(n);
        else if (s === "" && allowEmpty && value != null) onChange(null);
      }}
      onBlur={finish}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}
