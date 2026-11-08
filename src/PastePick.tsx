import { useMemo, useState } from "react";
import { MousePointerClick } from "lucide-react";
import {
  PASTE_FIELD_LABELS,
  pickableForField,
  readPasteLines,
  ruleForPickedLine,
  type PasteFieldRule,
  type PasteTemplateField,
} from "../shared/pasteTemplate";

interface Props {
  text: string;
  field: PasteTemplateField;
  disabled?: boolean;
  /** 버튼 글자. 기본은 `원문에서 고르기`. */
  title?: string;
  onPick: (value: string, rule: PasteFieldRule | null) => void;
}

/** 미리보기 빈 칸 아래: 붙여넣은 글에서 이 칸에 맞는 값만 보여 주고, 누르면 채운다. */
export default function PastePick({ text, field, disabled, title = "원문에서 고르기", onPick }: Props) {
  const [open, setOpen] = useState(false);
  const choices = useMemo(() => {
    if (!open) return [];
    const lines = readPasteLines(text);
    const seen = new Set<string>();
    const out: { index: number; label: string; text: string }[] = [];
    lines.forEach((line, index) => {
      if (!pickableForField(line, field) || seen.has(line.text)) return;
      seen.add(line.text);
      out.push({ index, label: line.label === line.text ? "" : line.label, text: line.text });
    });
    return out.slice(0, 15).map((c) => ({ ...c, lines }));
  }, [open, text, field]);

  if (!text.trim()) return null;
  return (
    <div className="smart-reg-pick" data-pick={field}>
      <button
        type="button"
        className="smart-reg-pick-toggle"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MousePointerClick size={12} strokeWidth={2.2} aria-hidden />
        {title}
      </button>
      {open ? (
        <div className="smart-reg-pick-list" role="listbox" aria-label={`${PASTE_FIELD_LABELS[field]} 값 고르기`}>
          {choices.length ? (
            choices.map((c) => (
              <button
                key={c.index}
                type="button"
                role="option"
                aria-selected={false}
                className="smart-reg-pick-item"
                onClick={() => {
                  setOpen(false);
                  onPick(c.text, ruleForPickedLine(c.lines, c.index, field));
                }}
              >
                {c.label ? <span className="smart-reg-pick-label">{c.label}</span> : null}
                <span>{c.text}</span>
              </button>
            ))
          ) : (
            <div className="sub">이 칸에 맞는 값이 원문에 없어요</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
